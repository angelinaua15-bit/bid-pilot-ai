/**
 * telegram-mtproto.service.ts
 *
 * Stable GramJS wrapper for:
 * 1. sendTelegramCode
 * 2. resendTelegramCode
 * 3. signInWithCode
 * 4. sendMessageMTProto
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram/tl/index.js';
import { Logger, LogLevel } from 'telegram/extensions/Logger.js';

// connect() + sendCode() are chained into a single Promise covered by one outer timeout.
// This avoids two competing timers racing each other on cold starts.
const SEND_CODE_TIMEOUT = 55_000;  // single outer timeout covering connect + sendCode per attempt
const SIGN_IN_TIMEOUT = 30_000;
const MESSAGE_TIMEOUT = 30_000;
const MAX_ATTEMPTS = 2;             // 2 × 55s = 110s < maxDuration:120

type SentCodeLike = Api.auth.SentCode & {
  nextType?: { className?: string };
  timeout?: number;
};

export interface SendCodeResult {
  phoneHash: string;
  isCodeViaApp: boolean;
  sessionString: string;
  codeType: string;
  nextType?: string;
  timeout?: number;
}

export interface ResendCodeResult extends SendCodeResult {
  typeChanged: boolean;
}

export interface SignInResult {
  sessionString: string;
  telegramId?: string;
  username?: string;
  firstName?: string;
}

function getCredentials(): { apiId: number; apiHash: string } {
  const rawApiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;

  const apiIdSet = Boolean(rawApiId);
  const apiHashSet = Boolean(apiHash);

  console.log(
    `[telegram] credentials — apiIdSet:${apiIdSet} apiHashSet:${apiHashSet}`
  );

  if (!rawApiId || !apiHash) {
    throw new Error('TELEGRAM_ENV_MISSING');
  }

  const apiId = Number(rawApiId);

  if (!Number.isFinite(apiId) || apiId <= 0) {
    throw new Error(`API_ID_INVALID: TELEGRAM_API_ID="${rawApiId}"`);
  }

  return { apiId, apiHash };
}

function normalizePhone(phone: string): string {
  const normalized = phone.trim().replace(/\s+/g, '');

  if (!normalized.startsWith('+')) {
    throw new Error('PHONE_NUMBER_INVALID: phone must start with +');
  }

  return normalized;
}

// Vercel and most cloud providers block outbound raw TCP to Telegram's MTProto IPs.
// useWSS: true routes through WebSocket over HTTPS (port 443) which is always allowed.
// useWSS: false (raw TCP) causes "auth.SendCode timed out after 60000ms" on Vercel.
const USE_WSS = true;

function createClient(
  apiId: number,
  apiHash: string,
  sessionString = ''
): TelegramClient {
  const session = new StringSession(sessionString);
  const logger = new Logger(LogLevel.ERROR);

  return new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,  // GramJS retries at socket level — more chances within the 55s window
    retryDelay: 1_000,
    useWSS: USE_WSS,
    baseLogger: logger,
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`[telegram] ${label} timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseSentCode(result: SentCodeLike, sessionString: string): SendCodeResult {
  const typeClass = result.type?.className ?? '';
  const typeId = (result.type as unknown as { CONSTRUCTOR_ID?: number })?.CONSTRUCTOR_ID;

  const isCodeViaApp =
    typeClass === 'auth.SentCodeTypeApp' ||
    typeClass.includes('SentCodeTypeApp') ||
    typeId === 0x3dbb5986;

  const nextType = result.nextType?.className;
  const timeout = typeof result.timeout === 'number' ? result.timeout : undefined;

let codeType: string = typeClass;

  if (isCodeViaApp) {
    codeType = 'app';
  } else if (typeClass.toLowerCase().includes('sms')) {
    codeType = 'sms';
  } else if (typeClass.toLowerCase().includes('call')) {
    codeType = 'call';
  }

  if (!result.phoneCodeHash) {
    throw new Error('PHONE_CODE_HASH_MISSING');
  }

  return {
    phoneHash: result.phoneCodeHash,
    isCodeViaApp,
    sessionString,
    codeType,
    nextType,
    timeout,
  };
}

async function safeDisconnect(client: TelegramClient) {
  try {
    await client.disconnect();
  } catch {
    // ignore disconnect errors
  }
}

async function connectClient(client: TelegramClient, label: string) {
  console.log(`[telegram] ${label} CONNECT_START`);
  await withTimeout(client.connect(), SIGN_IN_TIMEOUT, `${label}/connect`);
  console.log(`[telegram] ${label} CONNECT_OK`);
}

export async function sendTelegramCode(phoneNumber: string): Promise<SendCodeResult> {
  const phone = normalizePhone(phoneNumber);
  const { apiId, apiHash } = getCredentials();

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // Fresh client + empty StringSession on every attempt
    const client = createClient(apiId, apiHash);
    console.log(`SEND_CODE_ATTEMPT:${attempt}/${MAX_ATTEMPTS} phone:${phone}`);

    try {
      // GramJS does NOT auto-connect inside sendCode() — explicit connect() is required.
      // We chain connect().then(sendCode()) into a single Promise so there is only one
      // outer timeout covering the full operation (no two competing timeouts).
      console.log(`SEND_CODE_CALLING — attempt:${attempt} phone:${phone}`);
      const result = await withTimeout(
        client.connect().then(() => {
          console.log(`CONNECTED — attempt:${attempt}`);
          return client.sendCode({ apiId, apiHash }, phone);
        }),
        SEND_CODE_TIMEOUT,
        'auth.SendCode'
      );

      if (!result?.phoneCodeHash) {
        throw new Error('PHONE_CODE_HASH_MISSING');
      }

      const sessionString = client.session.save() as unknown as string;
      const isCodeViaApp = result.isCodeViaApp;
      const codeType = isCodeViaApp ? 'app' : 'sms';

      console.log(`SEND_CODE_SUCCESS phone:${phone} codeType:${codeType} hashPrefix:${result.phoneCodeHash.slice(0, 8)}`);

      return {
        phoneHash: result.phoneCodeHash,
        isCodeViaApp,
        sessionString,
        codeType,
        nextType: undefined,
        timeout: undefined,
      };
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`SEND_CODE_ATTEMPT:${attempt} FAILED reason:${message}`);

      // Permanent Telegram errors — never retry
      if (/PHONE_NUMBER_INVALID|PHONE_NUMBER_BANNED|API_ID_INVALID|FLOOD_WAIT_\d|TELEGRAM_ENV_MISSING/i.test(message)) {
        throw err;
      }

      // Retry transient errors (timeout, network, DC migration failures)
      if (attempt < MAX_ATTEMPTS) {
        const delay = attempt * 2_000; // 2s, 4s
        console.log(`SEND_CODE_RETRY in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } finally {
      await safeDisconnect(client);
    }
  }

  const finalMessage = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`SEND_CODE_FAILED: ${finalMessage}`);
}

export async function resendTelegramCode(
  phoneNumber: string,
  phoneHash: string,
  sessionString: string
): Promise<ResendCodeResult> {
  const phone = normalizePhone(phoneNumber);
  const { apiId, apiHash } = getCredentials();
  const client = createClient(apiId, apiHash, sessionString);

  try {
    console.log(
      `[telegram/resendCode] START phone:${phone} hashPrefix:${phoneHash.slice(0, 8)}`
    );

    await connectClient(client, 'resendCode');

    const result = (await withTimeout(
      client.invoke(
        new Api.auth.ResendCode({
          phoneNumber: phone,
          phoneCodeHash: phoneHash,
        })
      ),
      SEND_CODE_TIMEOUT,
      'auth.ResendCode'
    )) as SentCodeLike;

    const newSessionString = client.session.save() as unknown as string;
    const parsed = parseSentCode(result, newSessionString);

    console.log(
      `[telegram/resendCode] SUCCESS phone:${phone} type:${parsed.codeType} newHash:${parsed.phoneHash.slice(
        0,
        8
      )}`
    );

    return {
      ...parsed,
      typeChanged: parsed.phoneHash !== phoneHash,
    };
  } finally {
    await safeDisconnect(client);
  }
}

export async function signInWithCode(
  phoneNumber: string,
  phoneHash: string,
  code: string,
  password?: string,
  existingSession?: string
): Promise<SignInResult> {
  const phone = normalizePhone(phoneNumber);
  const { apiId, apiHash } = getCredentials();
  const client = createClient(apiId, apiHash, existingSession ?? '');

  try {
    console.log(
      `[telegram/signIn] START phone:${phone} hashPrefix:${phoneHash.slice(
        0,
        8
      )} hasSession:${Boolean(existingSession)}`
    );

    await connectClient(client, 'signIn');

    try {
      await withTimeout(
        client.invoke(
          new Api.auth.SignIn({
            phoneNumber: phone,
            phoneCodeHash: phoneHash,
            phoneCode: code.trim(),
          })
        ),
        SIGN_IN_TIMEOUT,
        'auth.SignIn'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (!message.includes('SESSION_PASSWORD_NEEDED')) {
        throw err;
      }

      if (!password) {
        throw new Error('SESSION_PASSWORD_NEEDED');
      }

      console.log('[telegram/signIn] 2FA_REQUIRED');

      const srpParams = await withTimeout(
        client.invoke(new Api.account.GetPassword()),
        SIGN_IN_TIMEOUT,
        'account.GetPassword'
      );

      const { computeCheck } = await import('telegram/Password.js');
      const srpCheck = await computeCheck(srpParams, password);

      await withTimeout(
        client.invoke(new Api.auth.CheckPassword({ password: srpCheck })),
        SIGN_IN_TIMEOUT,
        'auth.CheckPassword'
      );
    }

    const sessionString = client.session.save() as unknown as string;

    let telegramId: string | undefined;
    let username: string | undefined;
    let firstName: string | undefined;

    try {
      const users = (await withTimeout(
        client.invoke(
          new Api.users.GetUsers({
            id: [new Api.InputUserSelf()],
          })
        ),
        10_000,
        'users.GetUsers/self'
      )) as Api.User[];

      const me = users?.[0];

      if (me) {
        telegramId = String(me.id);
        username = me.username ?? undefined;
        firstName = me.firstName ?? undefined;
      }
    } catch (err) {
      console.warn(
        '[telegram/signIn] getMe failed:',
        err instanceof Error ? err.message : String(err)
      );
    }

    console.log(`[telegram/signIn] SUCCESS phone:${phone}`);

    return {
      sessionString,
      telegramId,
      username,
      firstName,
    };
  } finally {
    await safeDisconnect(client);
  }
}

export async function sendMessageMTProto(
  sessionString: string,
  peer: string,
  text: string
): Promise<void> {
  const { apiId, apiHash } = getCredentials();
  const client = createClient(apiId, apiHash, sessionString);

  try {
    await connectClient(client, 'sendMessage');

    await withTimeout(
      client.sendMessage(peer, {
        message: text,
        parseMode: 'html',
      }),
      MESSAGE_TIMEOUT,
      'sendMessage'
    );

    console.log(`[telegram/sendMessage] SUCCESS peer:${peer}`);
  } finally {
    await safeDisconnect(client);
  }
}
