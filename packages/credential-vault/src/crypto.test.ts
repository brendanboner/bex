import { describe, expect, it, beforeEach } from 'vitest';

import { decrypt, encrypt, generateKey } from '../src/crypto.js';

describe('credential-vault crypto', () => {
  const key = generateKey();

  beforeEach(() => {
    process.env['CREDENTIAL_VAULT_KEY'] = key;
  });

  it('round-trips a simple credential', () => {
    const plaintext = { api_key: 'supersecret', username: 'admin' };
    const blob = encrypt(plaintext);

    expect(blob.encryptedValue).not.toBe('');
    expect(blob.iv).not.toBe('');
    expect(blob.authTag).not.toBe('');

    const decrypted = decrypt(blob);
    expect(decrypted).toEqual(plaintext);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = { token: 'abc123' };
    const blob1 = encrypt(plaintext);
    const blob2 = encrypt(plaintext);
    expect(blob1.encryptedValue).not.toBe(blob2.encryptedValue);
    expect(blob1.iv).not.toBe(blob2.iv);
  });

  it('throws when auth tag is tampered with', () => {
    const blob = encrypt({ token: 'abc' });
    const tampered = { ...blob, authTag: Buffer.from('tampered').toString('base64') };
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws with an invalid key', () => {
    process.env['CREDENTIAL_VAULT_KEY'] = 'tooshort';
    expect(() => encrypt({ token: 'abc' })).toThrow('CREDENTIAL_VAULT_KEY');
  });
});
