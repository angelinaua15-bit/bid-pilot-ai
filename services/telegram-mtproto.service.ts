/**
 * telegram-mtproto.service.ts
 *
 * Wraps GramJS (TelegramClient) to:
 *  1. sendCode   — send OTP to a phone number, returns phoneHash
 *  2. signIn     — confirm OTP (+ optional 2FA password), returns StringSession
 *  3. disconnect — gracefully close the client
 *
 * Each operation creates a fresh short-lived TelegramClient using a StringSession.
 * Persistent session strings are stored in the DB by the caller (worker/server.ts).
 */

import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { Api } from 'telegram/tl/index.js'

const API_ID   = Number(process.env.TELEGRAM_API_ID   ?? 0)
const API_HASH =        process.env.TELEGRAM_API_HASH  ?? ''

export interface SendCodeResult {
  phoneHash:  string
  isCodeViaApp: boolean
}

export interface SignInResult {
  sessionString: string
}

/**
 * Send a login code to the phone number via Telegram's MTProto API.
 * Returns the phoneHash needed for signIn.
 */
export async function sendTelegramCode(phoneNumber: string): Promise<SendCodeResult> {
  if (!API_ID || !API_HASH) {
    throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH must be set')
  }

  const session = new StringSession('')
  const client  = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 3,
    useWSS: false,
  })

  await client.connect()
  try {
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber,
        apiId:   API_ID,
        apiHash: API_HASH,
        settings: new Api.CodeSettings({
          allowFlashcall: false,
          currentNumber:  true,
          allowAppHash:   true,
        }),
      })
    )
    return {
      phoneHash:    (result as Api.auth.SentCode).phoneCodeHash,
      isCodeViaApp: (result as Api.auth.SentCode).type?.className === 'auth.SentCodeTypeApp',
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
  if (!API_ID || !API_HASH) {
    throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH must be set')
  }

  const session = new StringSession(sessionString)
  const client  = new TelegramClient(session, API_ID, API_HASH, {
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
 * Confirm the OTP (and optional 2FA cloud password), returns the StringSession.
 */
export async function signInWithCode(
  phoneNumber: string,
  phoneHash:   string,
  code:        string,
  password?:   string
): Promise<SignInResult> {
  if (!API_ID || !API_HASH) {
    throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH must be set')
  }

  const session = new StringSession('')
  const client  = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 3,
    useWSS: false,
  })

  await client.connect()
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
      // 2FA required
      if (msg.includes('SESSION_PASSWORD_NEEDED')) {
        if (!password) {
          throw new Error('SESSION_PASSWORD_NEEDED')
        }
        // Fetch the SRP parameters and check password
        const srpResult = await client.invoke(new Api.account.GetPassword())
        const srpCheck  = await (await import('telegram/Password.js')).computeCheck(srpResult, password)
        await client.invoke(new Api.auth.CheckPassword({ password: srpCheck }))
      } else {
        throw signInErr
      }
    }

    return { sessionString: session.save() as unknown as string }
  } finally {
    await client.disconnect()
  }
}
