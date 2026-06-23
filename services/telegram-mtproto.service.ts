/**
 * telegram-mtproto.service.ts
 *
 * Wraps GramJS (TelegramClient) for three operations:
 *  1. sendTelegramCode    — send OTP via MTProto, returns phoneHash + sessionString
 *  2. signInWithCode      — verify OTP (+ optional 2FA), returns final sessionString
 *  3. sendMessageMTProto  — send a message using an existing session
 *
 * Design notes for serverless (Next.js API routes):
 * - Each function creates its own fresh TelegramClient.
 * - connect() is called before every invoke; disconnect() in finally.
 * - A 30-second timeout wraps the whole operation to prevent hanging.
 * - All GramJS errors are re-thrown with their original message so callers
 *   can map them to friendly error strings.
 */

import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { Api } from 'telegram/tl/index.js'
import { Logger, LogLevel } from 'telegram/extensions/Logger.js'

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

function getCredentials(): { apiId: number; apiHash: string } {
  const apiId   = Number(process.env.TELEGRAM_API_ID ?? 0)
  const apiHash = process.env.TELEGRAM_API_HASH ?? ''
  if (!apiId || !apiHash) {
    throw new Error('TELEGRAM_API_ID or TELEGRAM_API_HASH env var is missing')
  }
  return { apiId, apiHash }
}

// ---------------------------------------------------------------------------
// Helper: build a silent client
// ---------------------------------------------------------------------------

function makeClient(apiId: number, apiHash: string, sessionStr = ''): TelegramClient {
  const session = new StringSession(sessionStr)
  const logger  = new Logger(LogLevel.ERROR)

  return new TelegramClient(session, apiId, apiHash, {
    // useWSS: true — CRITICAL for Vercel/Railway: raw TCP port 443 is blocked
    // by most cloud providers; WSS (WebSocket over HTTPS) works through all firewalls.
    // useWSS: false causes silent hangs/timeouts and codes are never delivered.
    connectionRetries: 1,
    retryDelay:        500,
    useWSS:            true,
    baseLogger:        logger,
  })
}

// ---------------------------------------------------------------------------
// Helper: abort after N ms
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[telegram-mtproto] ${label} timed out after ${ms}ms`)), ms)
    ),
  ])
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface SendCodeResult {
  phoneHash:     string
  isCodeViaApp:  boolean
  sessionString: string
  /** Raw Telegram type className, e.g. "auth.SentCodeTypeApp" or "auth.SentCodeTypeSms" */
  codeType:      string
  /** Next fallback type Telegram will use on resend, if provided */
  nextType?:     string
  /** Seconds until resend is allowed (Telegram FLOOD_WAIT equivalent for this code) */
  timeout?:      number
}

export interface SignInResult {
  sessionString: string
  telegramId?:   string
  username?:     string
  firstName?:    string
}

// ---------------------------------------------------------------------------
// 1. sendTelegramCode
// ---------------------------------------------------------------------------

// ── Timeout budgets designed for Vercel's 60-second function limit ──────────
// connect: 20s + SendCode: 25s = 45s max per attempt — leaves 15s buffer.
// Only 1 attempt on Vercel to avoid exceeding the 60s limit.
const SEND_CODE_MAX_ATTEMPTS    = 1
const SEND_CODE_CONNECT_TIMEOUT = 20_000
const SEND_CODE_INVOKE_TIMEOUT  = 25_000

export async function sendTelegramCode(phoneNumber: string): Promise<SendCodeResult> {
  const { apiId, apiHash } = getCredentials()

  let lastError: Error = new Error('sendTelegramCode: no attempts made')

  for (let attempt = 1; attempt <= SEND_CODE_MAX_ATTEMPTS; attempt++) {
    const client = makeClient(apiId, apiHash)

    console.log(`SEND_CODE_STARTED — attempt ${attempt}/${SEND_CODE_MAX_ATTEMPTS} phone:${phoneNumber} apiId:${apiId}`)

    try {
      await withTimeout(client.connect(), SEND_CODE_CONNECT_TIMEOUT, `connect (attempt ${attempt})`)

      console.log(`[telegram/sendCode] SEND_CODE_CONNECTED (attempt ${attempt}) — running InitConnection then auth.SendCode`)

      // Wrap auth.SendCode in invokeWithLayer + initConnection so Telegram's auth
      // server recognises the client on cloud IPs. Without this, cloud-hosted api_ids
      // can receive 401 UNAUTHORIZED on auth.SendCode even with valid credentials.
      const sendCodeRequest = new Api.auth.SendCode({
        phoneNumber,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({
          allowFlashcall: false,
          currentNumber:  false,
          allowAppHash:   true,
        }),
      })

      const wrappedRequest = new Api.InvokeWithLayer({
        layer: 167, // current TL schema layer
        query: new Api.InitConnection({
          apiId,
          deviceModel:    'Server',
          systemVersion:  'Linux',
          appVersion:     '1.0.0',
          langCode:       'en',
          langPack:       '',
          systemLangCode: 'en',
          query: sendCodeRequest,
        }),
      })

      const result = await withTimeout(
        client.invoke(wrappedRequest),
        SEND_CODE_INVOKE_TIMEOUT,
        `auth.SendCode (attempt ${attempt})`,
      ) as Api.auth.SentCode

      const sessionString = (client.session.save() as unknown) as string

      // GramJS v2: check both className and CONSTRUCTOR_ID for the app-code type
      const typeClass    = result.type?.className ?? ''
      const typeId       = (result.type as unknown as { CONSTRUCTOR_ID?: number })?.CONSTRUCTOR_ID
      const isCodeViaApp = typeClass === 'auth.SentCodeTypeApp' ||
                           typeClass.includes('SentCodeTypeApp') ||
                           typeId === 0x3dbb5986

      // Extract nextType and timeout from the SentCode result
      const nextTypeClass = (result as unknown as { nextType?: { className?: string } })?.nextType?.className
      const codeTimeout   = (result as unknown as { timeout?: number })?.timeout

      console.log(
        `SEND_CODE_SUCCESS — attempt:${attempt}` +
        ` type:${typeClass} typeId:${typeId} isCodeViaApp:${isCodeViaApp}` +
        ` nextType:${nextTypeClass ?? 'none'} timeout:${codeTimeout ?? 'none'}` +
        ` hashPrefix:${result.phoneCodeHash?.slice(0, 8)}`
      )

      return {
        phoneHash:    result.phoneCodeHash,
        isCodeViaApp,
        sessionString,
        codeType:     typeClass,
        nextType:     nextTypeClass,
        timeout:      typeof codeTimeout === 'number' ? codeTimeout : undefined,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.error(`SEND_CODE_FAILED — attempt:${attempt} error: ${lastError.message}`)

      // Do not retry permanent Telegram errors
      const msg = lastError.message
      if (/PHONE_NUMBER_INVALID|PHONE_NUMBER_BANNED|PHONE_NUMBER_FLOOD|API_ID_INVALID|PHONE_NUMBER_UNOCCUPIED|^Unauthorized$/.test(msg) ||
          msg === 'Unauthorized') {
        console.log('[telegram/sendCode] permanent error — not retrying:', msg)
        throw lastError
      }

      // For transient errors: still re-throw on last attempt
      if (attempt >= SEND_CODE_MAX_ATTEMPTS) {
        console.log(`[telegram/sendCode] max attempts (${SEND_CODE_MAX_ATTEMPTS}) reached, throwing`)
      }
    } finally {
      client.disconnect().catch(() => {})
    }
  }

  throw new Error(
    `SEND_CODE_FAILED — Telegram connection failed after ${SEND_CODE_MAX_ATTEMPTS} attempt(s). ` +
    `Last error: ${lastError.message}. ` +
    `Possible causes: cloud IP blocks, invalid api_id, or network timeout.`
  )
}

// ---------------------------------------------------------------------------
// 1b. resendTelegramCode  — calls auth.ResendCode with existing phoneHash
//     so Telegram delivers the code via the nextType method (e.g. SMS / call)
// ---------------------------------------------------------------------------

export interface ResendCodeResult extends SendCodeResult {
  /** true when resend succeeded; false if resend returned the same type (nothing changed) */
  typeChanged: boolean
}

export async function resendTelegramCode(
  phoneNumber:   string,
  phoneHash:     string,
  sessionString: string,
): Promise<ResendCodeResult> {
  const { apiId, apiHash } = getCredentials()
  const client = makeClient(apiId, apiHash, sessionString)

  console.log(`RESEND_CODE_STARTED — phone:${phoneNumber} hashPrefix:${phoneHash.slice(0, 8)}`)

  try {
    await withTimeout(client.connect(), SEND_CODE_CONNECT_TIMEOUT, 'resend/connect')

    const result = await withTimeout(
      client.invoke(
        new Api.auth.ResendCode({ phoneNumber, phoneCodeHash: phoneHash })
      ),
      SEND_CODE_INVOKE_TIMEOUT,
      'auth.ResendCode',
    ) as Api.auth.SentCode

    const newSessionString = (client.session.save() as unknown) as string

    const typeClass    = result.type?.className ?? ''
    const typeId       = (result.type as unknown as { CONSTRUCTOR_ID?: number })?.CONSTRUCTOR_ID
    const isCodeViaApp = typeClass === 'auth.SentCodeTypeApp' ||
                         typeClass.includes('SentCodeTypeApp') ||
                         typeId === 0x3dbb5986

    const nextTypeClass = (result as unknown as { nextType?: { className?: string } })?.nextType?.className
    const codeTimeout   = (result as unknown as { timeout?: number })?.timeout
    const newHash       = result.phoneCodeHash

    console.log(
      `RESEND_CODE_SUCCESS — phone:${phoneNumber}` +
      ` type:${typeClass} isCodeViaApp:${isCodeViaApp}` +
      ` nextType:${nextTypeClass ?? 'none'}` +
      ` timeout:${codeTimeout ?? 'none'}` +
      ` newHash:${newHash?.slice(0, 8)} oldHash:${phoneHash.slice(0, 8)}`
    )

    return {
      phoneHash:    newHash,
      isCodeViaApp,
      sessionString: newSessionString,
      codeType:     typeClass,
      nextType:     nextTypeClass,
      timeout:      typeof codeTimeout === 'number' ? codeTimeout : undefined,
      typeChanged:  typeClass !== (isCodeViaApp ? 'auth.SentCodeTypeApp' : ''),
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    console.error(`RESEND_CODE_FAILED — phone:${phoneNumber} error: ${error.message}`)
    throw error
  } finally {
    client.disconnect().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// 2. signInWithCode
// ---------------------------------------------------------------------------

export async function signInWithCode(
  phoneNumber:      string,
  phoneHash:        string,
  code:             string,
  password?:        string,
  existingSession?: string,
): Promise<SignInResult> {
  const { apiId, apiHash } = getCredentials()

  // Restore session so we reconnect to the same DC used during sendCode
  const client = makeClient(apiId, apiHash, existingSession ?? '')

  console.log('[telegram/signIn] connecting for', phoneNumber)
  await withTimeout(client.connect(), 20_000, 'connect')
  console.log('[telegram/signIn] connected, invoking auth.SignIn')

  try {
    try {
      await withTimeout(
        client.invoke(
          new Api.auth.SignIn({
            phoneNumber,
            phoneCodeHash: phoneHash,
            phoneCode:     code,
          })
        ),
        20_000,
        'auth.SignIn',
      )
    } catch (signInErr: unknown) {
      const msg = (signInErr as Error)?.message ?? ''

      if (msg.includes('SESSION_PASSWORD_NEEDED')) {
        if (!password) throw new Error('SESSION_PASSWORD_NEEDED')

        console.log('[telegram/signIn] 2FA required, checking password')
        const srpParams = await withTimeout(
          client.invoke(new Api.account.GetPassword()),
          15_000,
          'account.GetPassword',
        )
        const { computeCheck } = await import('telegram/Password.js')
        const srpCheck = await computeCheck(srpParams, password)
        await withTimeout(
          client.invoke(new Api.auth.CheckPassword({ password: srpCheck })),
          15_000,
          'auth.CheckPassword',
        )
      } else {
        throw signInErr
      }
    }

    const sessionString = (client.session.save() as unknown) as string
    console.log('[telegram/signIn] sign-in successful for', phoneNumber, '— calling getMe()')

    // Validate session immediately with getMe() — confirms the auth key works
    let telegramId: string | undefined
    let username:   string | undefined
    let firstName:  string | undefined
    try {
      const me = await withTimeout(
        client.invoke(new Api.users.GetUsers({ id: [new Api.InputUserSelf()] })),
        10_000,
        'getMe',
      ) as Api.User[]
      const user = me?.[0]
      if (user) {
        telegramId = String(user.id)
        username   = user.username ?? undefined
        firstName  = user.firstName ?? undefined
        console.log('[telegram/signIn] getMe OK — id:', telegramId, 'username:', username)
      }
    } catch (getMeErr) {
      // getMe failed but sign-in succeeded — session is probably valid, continue
      console.warn('[telegram/signIn] getMe failed (non-fatal):', (getMeErr as Error)?.message)
    }

    return { sessionString, telegramId, username, firstName }
  } finally {
    client.disconnect().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// 3. sendMessageMTProto
// ---------------------------------------------------------------------------

export async function sendMessageMTProto(
  sessionString: string,
  peer:          string,
  text:          string,
): Promise<void> {
  const { apiId, apiHash } = getCredentials()
  const client = makeClient(apiId, apiHash, sessionString)

  console.log('[telegram/sendMessage] connecting for peer', peer)
  await withTimeout(client.connect(), 25_000, 'connect')
  try {
    await withTimeout(
      client.sendMessage(peer, { message: text, parseMode: 'html' }),
      30_000,
      'sendMessage',
    )
    console.log('[telegram/sendMessage] sent to', peer)
  } finally {
    client.disconnect().catch(() => {})
  }
}
