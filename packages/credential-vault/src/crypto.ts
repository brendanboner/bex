import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96-bit IV recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Returns the 32-byte encryption key from the CREDENTIAL_VAULT_KEY env var.
 * The key must be a 64-character hex string (32 bytes).
 */
function getKey(): Buffer {
  const keyHex = process.env['CREDENTIAL_VAULT_KEY'];
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('CREDENTIAL_VAULT_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

export type EncryptedBlob = {
  encryptedValue: string; // base64
  iv: string;             // base64
  authTag: string;        // base64
};

/**
 * Encrypts a credential value object using AES-256-GCM.
 * The plaintext is a JSON-serialised Record<string, string>.
 */
export function encrypt(value: Record<string, string>): EncryptedBlob {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const plaintext = JSON.stringify(value);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypts an EncryptedBlob back to the original Record<string, string>.
 */
export function decrypt(blob: EncryptedBlob): Record<string, string> {
  const key = getKey();
  const iv = Buffer.from(blob.iv, 'base64');
  const authTag = Buffer.from(blob.authTag, 'base64');
  const encryptedBuffer = Buffer.from(blob.encryptedValue, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as Record<string, string>;
}

/**
 * Generates a new random 256-bit key (hex string).
 * Use once during provisioning: `node -e "require('./dist').generateKey()"`
 */
export function generateKey(): string {
  return randomBytes(KEY_LENGTH).toString('hex');
}
