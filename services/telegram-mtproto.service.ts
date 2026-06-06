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

  const logger = new Logger(LogLevel.ERROR)

  return new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
    retryDelay:        1000,
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
}

export interface SignInResult {
  sessionString: string
}

// ---------------------------------------------------------------------------
// 1. sendTelegramCode
// ---------------------------------------------------------------------------

export async function sendTelegramCode(phoneNumber: string): Promise<SendCodeResult> {
  const { apiId, apiHash } = getCredentials()
  const client = makeClient(apiId, apiHash)

  console.log('[telegram/sendCode] connecting for', phoneNumber)

  await withTimeout(client.connect(), 20_000, 'connect')

  console.log('[telegram/sendCode] connected, invoking auth.SendCode')

  try {
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
      20_000,
      'auth.SendCode',
    ) as Api.auth.SentCode

    const sessionString = (client.session.save() as unknown) as string

    console.log('[telegram/sendCode] success — isCodeViaApp:', result.type?.className === 'auth.SentCodeTypeApp')

    return {
      phoneHash:    result.phoneCodeHash,
      isCodeViaApp: result.type?.className === 'auth.SentCodeTypeApp',
      sessionString,
    }
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
    console.log('[telegram/signIn] sign-in successful for', phoneNumber)
    return { sessionString }
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

  await withTimeout(client.connect(), 20_000, 'connect')
  try {
    await withTimeout(
      client.sendMessage(peer, { message: text, parseMode: 'html' }),
      30_000,
      'sendMessage',
    )
  } finally {
    client.disconnect().catch(() => {})
  }
}
