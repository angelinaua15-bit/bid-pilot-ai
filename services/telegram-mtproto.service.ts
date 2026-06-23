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
    // useWSS: false — use raw TCP. GramJS handles DC migration and port selection
    // internally. Switching to WSS broke delivery because the handshake sequence
    // differs and GramJS's high-level methods are tested primarily with raw TCP.
    connectionRetries: 5,
    retryDelay:        1_000,
    useWSS:            false,
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
    console.log(`SEND_CODE_STARTED — attempt:${attempt} phone:${phoneNumber} apiId:${apiId}`)
    const client = makeClient(apiId, apiHash)

    try {
      // ── Use the GramJS high-level sendCode() — NOT client.invoke(Api.auth.SendCode) ──
      //
      // client.sendCode() handles DC migration automatically (PHONE_MIGRATE_X errors).
      // Low-level client.invoke(Api.auth.SendCode) on a fresh StringSession('') does NOT
      // handle DC migration, so the code silently fails to be delivered on the first
      // attempt for numbers that live on a non-default Telegram DC.
      //
      // client.connect() is called internally by sendCode(); no need to call it first.
      console.log(`SEND_CODE_CONNECTING — phone:${phoneNumber}`)
      const result = await withTimeout(
        client.sendCode({ apiId, apiHash }, phoneNumber),
        SEND_CODE_CONNECT_TIMEOUT + SEND_CODE_INVOKE_TIMEOUT,
        `sendCode (attempt ${attempt})`,
      )

      // Serialise session AFTER sendCode so DC routing data is preserved
      const sessionString = (client.session.save() as unknown) as string

      // client.sendCode() returns { phoneCodeHash, isCodeViaApp: boolean }
      // isCodeViaApp=true  → Telegram sent the code to the user's Telegram app
      // isCodeViaApp=false → Telegram sent the code via SMS
      const isCodeViaApp = result.isCodeViaApp
      const codeTypeRaw  = isCodeViaApp ? 'app' : 'sms'

      console.log(
        `TELEGRAM_SEND_CODE_RESPONSE — phone:${phoneNumber}` +
        ` phoneCodeHash:${result.phoneCodeHash}` +
        ` isCodeViaApp:${isCodeViaApp}` +
        ` codeType:${codeTypeRaw}` +
        ` hashPrefix:${result.phoneCodeHash?.slice(0, 8)}`
      )
      console.log(`SEND_CODE_SUCCESS — attempt:${attempt} codeType:${codeTypeRaw} isCodeViaApp:${isCodeViaApp}`)

      return {
        phoneHash:    result.phoneCodeHash,
        isCodeViaApp,
        sessionString,
        codeType:     codeTypeRaw,
        nextType:     undefined,
        timeout:      undefined,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.error(`SEND_CODE_FAILED — attempt:${attempt} error: ${lastError.message}`)

      const msg = lastError.message
      if (/PHONE_NUMBER_INVALID|PHONE_NUMBER_BANNED|PHONE_NUMBER_FLOOD|API_ID_INVALID|PHONE_NUMBER_UNOCCUPIED|^Unauthorized$/.test(msg) ||
          msg === 'Unauthorized') {
        console.log('[telegram/sendCode] permanent error — not retrying:', msg)
        throw lastError
      }

      if (attempt >= SEND_CODE_MAX_ATTEMPTS) {
        console.log(`[telegram/sendCode] max attempts reached`)
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

  console.log(`CONFIRM_CODE_STARTED — phone:${phoneNumber} hashPrefix:${phoneHash.slice(0, 8)} hasSession:${Boolean(existingSession)}`)

  await withTimeout(client.connect(), 25_000, 'connect')
  console.log('[telegram/signIn] connected, invoking auth.SignIn')

  try {
    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber,
          phoneCodeHash: phoneHash,
          phoneCode:     code,
        })
      )
    } catch (signInErr: unknown) {
      const msg = (signInErr as Error)?.message ?? ''

      if (msg.includes('SESSION_PASSWORD_NEEDED')) {
        if (!password) throw new Error('SESSION_PASSWORD_NEEDED')

        console.log('[telegram/signIn] 2FA required, checking password')
        const srpParams = await client.invoke(new Api.account.GetPassword())
        const { computeCheck } = await import('telegram/Password.js')
        const srpCheck = await computeCheck(srpParams, password)
        await client.invoke(new Api.auth.CheckPassword({ password: srpCheck }))
      } else {
        const signInErrMsg = (signInErr as Error)?.message ?? String(signInErr)
        console.error(`SIGN_IN_FAILED — phone:${phoneNumber} error:${signInErrMsg}`)
        throw signInErr
      }
    }

    const sessionString = (client.session.save() as unknown) as string
    console.log(`SIGN_IN_SUCCESS — phone:${phoneNumber}`)

    // Validate session with getMe() — confirms the auth key works
    let telegramId: string | undefined
    let username:   string | undefined
    let firstName:  string | undefined
    try {
      const me = await client.invoke(
        new Api.users.GetUsers({ id: [new Api.InputUserSelf()] })
      ) as Api.User[]
      const user = me?.[0]
      if (user) {
        telegramId = String(user.id)
        username   = user.username ?? undefined
        firstName  = user.firstName ?? undefined
        console.log('[telegram/signIn] getMe OK — id:', telegramId, 'username:', username)
      }
    } catch (getMeErr) {
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
