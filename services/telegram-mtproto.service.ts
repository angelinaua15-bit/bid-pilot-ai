/**
 * telegram-mtproto.service.ts
 *
 * Wraps GramJS (TelegramClient) for three operations:
 *  1. sendTelegramCode    — send OTP via MTProto, returns phoneHash + sessionString
 *  2. resendTelegramCode  — resend via auth.ResendCode (nextType fallback: SMS/call)
 *  3. signInWithCode      — verify OTP (+ optional 2FA), returns final sessionString
 *  4. sendMessageMTProto  — send a message using an existing session
 *
 * Design rules for serverless (Next.js / Vercel):
 * - Each function creates its own fresh TelegramClient — NO shared singleton.
 * - await client.connect() MUST be called before every invoke().
 * - client.disconnect() MUST be called in finally.
 * - A timeout wraps every network call to prevent Vercel function hangs.
 * - DO NOT use client.sendCode() — it does not exist in GramJS v2.
 * - Use client.invoke(Api.auth.SendCode) directly (original working pattern).
 */

import { TelegramClient } from 'telegram'
import { StringSession }  from 'telegram/sessions/index.js'
import { Api }            from 'telegram/tl/index.js'
import { Logger, LogLevel } from 'telegram/extensions/Logger.js'

// ---------------------------------------------------------------------------
// Credentials — validated once at call-time, never cached
// ---------------------------------------------------------------------------

function getCredentials(): { apiId: number; apiHash: string } {
  const rawApiId  = process.env.TELEGRAM_API_ID
  const apiHash   = process.env.TELEGRAM_API_HASH ?? ''
  const apiIdSet  = Boolean(rawApiId)
  const apiHashSet = Boolean(apiHash)

  console.log(`[telegram] getCredentials — apiIdSet:${apiIdSet} apiHashSet:${apiHashSet}`)

  if (!apiIdSet || !apiHashSet) {
    throw new Error('TELEGRAM_ENV_MISSING: TELEGRAM_API_ID or TELEGRAM_API_HASH is not set')
  }

  const apiId = Number(rawApiId)
  if (!Number.isFinite(apiId) || apiId <= 0) {
    throw new Error(`API_ID_INVALID: TELEGRAM_API_ID="${rawApiId}" is not a valid positive number`)
  }

  return { apiId, apiHash }
}

// ---------------------------------------------------------------------------
// Factory — always creates a fresh client with a clean (or restored) session
// ---------------------------------------------------------------------------

function makeClient(apiId: number, apiHash: string, sessionStr = ''): TelegramClient {
  const session = new StringSession(sessionStr)
  const logger  = new Logger(LogLevel.ERROR)

  return new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
    retryDelay:        1_000,
    useWSS:            false,   // raw TCP — original working setting; WSS breaks GramJS DC migration
    baseLogger:        logger,
  })
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`[telegram] ${label} timed out after ${ms}ms`)),
        ms,
      )
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
  /** "app" | "sms" | "call" | raw className */
  codeType:      string
  nextType?:     string
  timeout?:      number
}

export interface ResendCodeResult extends SendCodeResult {
  typeChanged: boolean
}

export interface SignInResult {
  sessionString: string
  telegramId?:   string
  username?:     string
  firstName?:    string
}

// ---------------------------------------------------------------------------
// 1. sendTelegramCode
//    Uses client.invoke(Api.auth.SendCode) — the original working pattern.
//    DO NOT replace with client.sendCode() — that method does not exist in GramJS v2.
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT    = 20_000   // 20 s
const SEND_CODE_TIMEOUT  = 20_000   // 20 s
const SIGN_IN_TIMEOUT    = 20_000   // 20 s

export async function sendTelegramCode(phoneNumber: string): Promise<SendCodeResult> {
  const { apiId, apiHash } = getCredentials()

  // Always create a brand-new client with an empty session for sendCode.
  // Never reuse a cached client — stale sessions cause DC mismatch failures.
  const client = makeClient(apiId, apiHash)

  console.log(`[telegram/sendCode] STARTED — phone:${phoneNumber} apiId:${apiId}`)

  try {
    // Step 1: connect — MUST be called before any invoke()
    console.log(`[telegram/sendCode] CONNECTING — phone:${phoneNumber}`)
    await withTimeout(client.connect(), CONNECT_TIMEOUT, 'sendCode/connect')
    console.log(`[telegram/sendCode] CONNECTED — phone:${phoneNumber}`)

    // Step 2: send code via MTProto
    // allowAppHash:true  → Telegram may deliver to the Telegram app (SentCodeTypeApp)
    // allowAppHash:false → Telegram forces SMS
    // We use true (original working setting) so Telegram picks the best method.
    // isCodeViaApp in the response tells the UI which channel was used.
    const result = await withTimeout(
      client.invoke(
        new Api.auth.SendCode({
          phoneNumber,
          apiId,
          apiHash,
          settings: new Api.CodeSettings({
            allowFlashcall: false,
            currentNumber:  false,
            allowAppHash:   true,
          }),
        })
      ),
      SEND_CODE_TIMEOUT,
      'auth.SendCode',
    ) as Api.auth.SentCode

    // Serialise session AFTER sendCode — DC routing data is now baked in
    const sessionString = (client.session.save() as unknown) as string

    const typeClass    = result.type?.className ?? ''
    const typeId       = (result.type as unknown as { CONSTRUCTOR_ID?: number })?.CONSTRUCTOR_ID
    const isCodeViaApp = typeClass === 'auth.SentCodeTypeApp' ||
                         typeClass.includes('SentCodeTypeApp') ||
                         typeId === 0x3dbb5986

    const nextTypeClass = (result as unknown as { nextType?: { className?: string } })?.nextType?.className
    const codeTimeout   = (result as unknown as { timeout?: number })?.timeout
    const codeType      = isCodeViaApp ? 'app' : (typeClass.toLowerCase().includes('sms') ? 'sms' : typeClass)

    console.log(
      `[telegram/sendCode] RESPONSE` +
      ` — phone:${phoneNumber}` +
      ` phoneCodeHash:${result.phoneCodeHash}` +
      ` type.className:${typeClass}` +
      ` nextType.className:${nextTypeClass ?? 'none'}` +
      ` timeout:${codeTimeout ?? 'none'}` +
      ` isCodeViaApp:${isCodeViaApp}`
    )
    console.log(`[telegram/sendCode] SUCCESS — codeType:${codeType} hashPrefix:${result.phoneCodeHash?.slice(0, 8)}`)

    return {
      phoneHash:    result.phoneCodeHash,
      isCodeViaApp,
      sessionString,
      codeType,
      nextType:  nextTypeClass,
      timeout:   typeof codeTimeout === 'number' ? codeTimeout : undefined,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[telegram/sendCode] FAILED — phone:${phoneNumber} error:${msg}`)
    throw err instanceof Error ? err : new Error(msg)
  } finally {
    client.disconnect().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// 2. resendTelegramCode
//    Calls auth.ResendCode with the existing phoneHash so Telegram delivers
//    via the nextType fallback (SMS or call instead of app notification).
//    Requires an existing session string from the previous sendCode call.
// ---------------------------------------------------------------------------

export async function resendTelegramCode(
  phoneNumber:   string,
  phoneHash:     string,
  sessionString: string,
): Promise<ResendCodeResult> {
  const { apiId, apiHash } = getCredentials()

  // Restore the existing session so we hit the same DC as the original sendCode
  const client = makeClient(apiId, apiHash, sessionString)

  console.log(`[telegram/resendCode] STARTED — phone:${phoneNumber} hashPrefix:${phoneHash.slice(0, 8)}`)

  try {
    console.log(`[telegram/resendCode] CONNECTING`)
    await withTimeout(client.connect(), CONNECT_TIMEOUT, 'resendCode/connect')
    console.log(`[telegram/resendCode] CONNECTED`)

    const result = await withTimeout(
      client.invoke(
        new Api.auth.ResendCode({ phoneNumber, phoneCodeHash: phoneHash })
      ),
      SEND_CODE_TIMEOUT,
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
    const codeType      = isCodeViaApp ? 'app' : (typeClass.toLowerCase().includes('sms') ? 'sms' : typeClass)

    console.log(
      `[telegram/resendCode] SUCCESS` +
      ` — phone:${phoneNumber}` +
      ` type:${typeClass} isCodeViaApp:${isCodeViaApp}` +
      ` nextType:${nextTypeClass ?? 'none'}` +
      ` timeout:${codeTimeout ?? 'none'}` +
      ` newHash:${newHash?.slice(0, 8)} oldHash:${phoneHash.slice(0, 8)}`
    )

    return {
      phoneHash:     newHash,
      isCodeViaApp,
      sessionString: newSessionString,
      codeType,
      nextType:     nextTypeClass,
      timeout:      typeof codeTimeout === 'number' ? codeTimeout : undefined,
      typeChanged:  newHash !== phoneHash,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[telegram/resendCode] FAILED — phone:${phoneNumber} error:${msg}`)
    throw err instanceof Error ? err : new Error(msg)
  } finally {
    client.disconnect().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// 3. signInWithCode
//    Verifies the OTP.  Restores the session from sendCode so we hit the same DC.
//    Handles SESSION_PASSWORD_NEEDED (2FA) transparently.
// ---------------------------------------------------------------------------

export async function signInWithCode(
  phoneNumber:      string,
  phoneHash:        string,
  code:             string,
  password?:        string,
  existingSession?: string,
): Promise<SignInResult> {
  const { apiId, apiHash } = getCredentials()

  // Restore the session so GramJS reconnects to the same DC used in sendCode.
  // If existingSession is empty, GramJS will re-negotiate the DC — slower but works.
  const client = makeClient(apiId, apiHash, existingSession ?? '')

  console.log(
    `[telegram/signIn] STARTED` +
    ` — phone:${phoneNumber}` +
    ` hashPrefix:${phoneHash.slice(0, 8)}` +
    ` hasSession:${Boolean(existingSession)}`
  )

  try {
    console.log(`[telegram/signIn] CONNECTING`)
    await withTimeout(client.connect(), CONNECT_TIMEOUT, 'signIn/connect')
    console.log(`[telegram/signIn] CONNECTED — invoking auth.SignIn`)

    try {
      await withTimeout(
        client.invoke(
          new Api.auth.SignIn({
            phoneNumber,
            phoneCodeHash: phoneHash,
            phoneCode:     code,
          })
        ),
        SIGN_IN_TIMEOUT,
        'auth.SignIn',
      )
    } catch (signInErr: unknown) {
      const msg = (signInErr as Error)?.message ?? ''

      if (msg.includes('SESSION_PASSWORD_NEEDED')) {
        if (!password) throw new Error('SESSION_PASSWORD_NEEDED')

        console.log('[telegram/signIn] 2FA required — checking password')
        const srpParams = await withTimeout(
          client.invoke(new Api.account.GetPassword()),
          SIGN_IN_TIMEOUT,
          'account.GetPassword',
        )
        const { computeCheck } = await import('telegram/Password.js')
        const srpCheck = await computeCheck(srpParams, password)
        await withTimeout(
          client.invoke(new Api.auth.CheckPassword({ password: srpCheck })),
          SIGN_IN_TIMEOUT,
          'auth.CheckPassword',
        )
      } else {
        console.error(`[telegram/signIn] FAILED — phone:${phoneNumber} error:${msg}`)
        throw signInErr
      }
    }

    const sessionString = (client.session.save() as unknown) as string
    console.log(`[telegram/signIn] SUCCESS — phone:${phoneNumber}`)

    // getMe() — confirms the auth key is valid; non-fatal if it fails
    let telegramId: string | undefined
    let username:   string | undefined
    let firstName:  string | undefined
    try {
      const me = await withTimeout(
        client.invoke(new Api.users.GetUsers({ id: [new Api.InputUserSelf()] })),
        10_000,
        'GetUsers/self',
      ) as Api.User[]
      const u = me?.[0]
      if (u) {
        telegramId = String(u.id)
        username   = u.username  ?? undefined
        firstName  = u.firstName ?? undefined
        console.log(`[telegram/signIn] getMe OK — id:${telegramId} username:${username}`)
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
// 4. sendMessageMTProto
// ---------------------------------------------------------------------------

export async function sendMessageMTProto(
  sessionString: string,
  peer:          string,
  text:          string,
): Promise<void> {
  const { apiId, apiHash } = getCredentials()
  const client = makeClient(apiId, apiHash, sessionString)

  console.log('[telegram/sendMessage] connecting for peer', peer)
  await withTimeout(client.connect(), CONNECT_TIMEOUT, 'sendMessage/connect')
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
