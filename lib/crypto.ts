/**
 * lib/crypto.ts
 * AES-256-GCM encryption/decryption for storing sensitive tokens (e.g. Freelancehunt API keys).
 * Uses Node.js built-in `crypto` module — no external dependencies.
 *
 * Requires: ENCRYPTION_KEY environment variable (32-byte hex string).
 * Generate with: openssl rand -hex 32
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96 bits — recommended for GCM
const TAG_LENGTH = 16;  // 128 bits auth tag

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // In dev/demo mode without ENCRYPTION_KEY, use a deterministic fallback.
    // NEVER use this in production — always set ENCRYPTION_KEY.
    console.warn('[crypto] ENCRYPTION_KEY not set — using insecure dev fallback');
    return Buffer.from('dev_fallback_key_32bytes_not_safe', 'utf8').subarray(0, 32);
  }
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars)');
  return buf;
}

/**
 * Encrypt a plaintext string. Returns a base64 string: iv:tag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: base64(iv):base64(tag):base64(ciphertext)
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a string produced by `encrypt()`. Returns the original plaintext.
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');

  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
