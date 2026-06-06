/**
 * telegram-mtproto.service.ts
 *
 * Wraps GramJS (TelegramClient) to:
 *  1. sendTelegramCode — send OTP to a phone number, returns phoneHash + sessionString
 *  2. signInWithCode   — confirm OTP (+ optional 2FA password), returns StringSession
 *  3. sendMessageMTProto — send a message using an existing session
 *
 * Each operation creates a fresh short-lived TelegramClient.
 * The session string after sendCode is stored in the DB so that signIn
 * can reuse the same DC connection data.
 */

import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { Api } from 'telegram/tl/index.js'

function getCredentials() {
  const apiId   = Number(process.env.TELEGRAM_API_ID ?? 0)
  const apiHash = process.env.TELEGRAM_API_HASH ?? ''
  console.log('[telegram-mtproto] TELEGRAM_API_ID present:', apiId > 0)
  console.log('[telegram-mtproto] TELEGRAM_API_HASH present:', apiHash.length > 0)
  if (!apiId || !apiHash) {
    throw new Error('TELEGRAM_API_ID or TELEGRAM_API_HASH missing')
  }
  return { apiId, apiHash }
}

export interface SendCodeResult {
  phoneHash:     string
  isCodeViaApp:  boolean
  /** Serialised session after DC resolution — pass back to signInWithCode */
  sessionString: string
}

export interface SignInResult {
  sessionString: string
}

/**
 * Send a login code to the phone number via Telegram MTProto.
 * Uses the high-level client.sendCode() which handles DC migration automatically.
 * Returns the phoneHash AND the session string (DC info) needed for signIn.
 */
export async function sendTelegramCode(phoneNumber: string): Promise<SendCodeResult> {
  const { apiId, apiHash } = getCredentials()

  const session = new StringSession('')
  const client  = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: false,
    baseLogger: { // suppress verbose GramJS logs
      levels: ['error'],
      trace: () => {}, debug: () => {}, info: () => {},
      warn:  () => {}, error: (msg: string) => console.error('[gramjs]', msg),
    } as never,
  })

  console.log('[telegram/send-code] connecting...')
  await client.connect()
  console.log('[telegram/send-code] connected, sending code to', phoneNumber)

  try {
    const result = await client.sendCode(
      { apiId, apiHash },
      phoneNumber,
    )

    // Serialise the session AFTER sendCode so DC routing data is preserved
    const sessionString = session.save() as unknown as string

    console.log('[telegram/send-code] code sent successfully')

    return {
      phoneHash:    result.phoneCodeHash,
      isCodeViaApp: result.isCodeViaApp ?? false,
      sessionString,
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Send a text message to a channel/group using an existing StringSession.
 * @param sessionString - saved StringSession from signInWithCode
 * @param peer          - channel username (@mychannel) or numeric peer id
 * @param text          - message text (HTML supported via parseMode)
 */
export async function sendMessageMTProto(
  sessionString: string,
  peer:          string,
  text:          string,
): Promise<void> {
  const { apiId, apiHash } = getCredentials()

  const session = new StringSession(sessionString)
  const client  = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
    useWSS: false,
  })

  await client.connect()
  try {
    await client.sendMessage(peer, { message: text, parseMode: 'html' })
  } finally {
    await client.disconnect()
  }
}

/**
 * Confirm the OTP (and optional 2FA cloud password), returns the final StringSession.
 * Pass the sessionString from sendTelegramCode so the client reconnects to the same DC.
 */
export async function signInWithCode(
  phoneNumber:        string,
  phoneHash:          string,
  code:               string,
  password?:          string,
  existingSession?:   string,
): Promise<SignInResult> {
  const { apiId, apiHash } = getCredentials()

  // Restore the session from sendCode if available — preserves DC routing
  const session = new StringSession(existingSession ?? '')
  const client  = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: false,
    baseLogger: {
      levels: ['error'],
      trace: () => {}, debug: () => {}, info: () => {},
      warn:  () => {}, error: (msg: string) => console.error('[gramjs]', msg),
    } as never,
  })

  console.log('[telegram/verify-code] connecting...')
  await client.connect()
  console.log('[telegram/verify-code] connected, signing in', phoneNumber)

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
        if (!password) {
          throw new Error('SESSION_PASSWORD_NEEDED')
        }
        console.log('[telegram/verify-code] 2FA required, checking password...')
        const srpResult = await client.invoke(new Api.account.GetPassword())
        const { computeCheck } = await import('telegram/Password.js')
        const srpCheck = await computeCheck(srpResult, password)
        await client.invoke(new Api.auth.CheckPassword({ password: srpCheck }))
      } else {
        throw signInErr
      }
    }

    const finalSession = session.save() as unknown as string
    console.log('[telegram/verify-code] sign-in successful')
    return { sessionString: finalSession }
  } finally {
    await client.disconnect()
  }
}
