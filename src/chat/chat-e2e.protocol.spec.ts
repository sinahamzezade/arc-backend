import sodium from 'libsodium-wrappers';
import {
  CHAT_E2E_BODY_PREFIX,
  CHAT_MAX_E2E_BODY_CHARS,
  isE2eBody,
} from './chat.constants';

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

/**
 * Protocol parity with arc-app e2e (libsodium secretbox + box_seal).
 */
describe('chat e2e protocol', () => {
  beforeAll(async () => {
    await sodium.ready;
  });

  it('detects e2e envelopes', () => {
    expect(isE2eBody(`${CHAT_E2E_BODY_PREFIX}abc`)).toBe(true);
    expect(isE2eBody('hello')).toBe(false);
    expect(isE2eBody(null)).toBe(false);
    expect(CHAT_MAX_E2E_BODY_CHARS).toBeGreaterThan(4000);
  });

  it('round-trips message body with conversation key', () => {
    const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
    const plaintext = 'Salam — چطوری';
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const cipher = sodium.crypto_secretbox_easy(
      sodium.from_string(plaintext),
      nonce,
      key,
    );
    const packed = new Uint8Array(nonce.length + cipher.length);
    packed.set(nonce, 0);
    packed.set(cipher, nonce.length);
    const envelope = CHAT_E2E_BODY_PREFIX + toBase64Url(packed);

    expect(isE2eBody(envelope)).toBe(true);
    const raw = fromBase64Url(envelope.slice(CHAT_E2E_BODY_PREFIX.length));
    const n = raw.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
    const c = raw.subarray(sodium.crypto_secretbox_NONCEBYTES);
    const opened = sodium.crypto_secretbox_open_easy(c, n, key);
    expect(sodium.to_string(opened)).toBe(plaintext);
  });

  it('seals conversation key to peer identity', () => {
    const alice = sodium.crypto_box_keypair();
    const bob = sodium.crypto_box_keypair();
    const convKey = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);

    const sealedForBob = sodium.crypto_box_seal(convKey, bob.publicKey);
    const opened = sodium.crypto_box_seal_open(
      sealedForBob,
      bob.publicKey,
      bob.privateKey,
    );
    expect(Buffer.from(opened).equals(Buffer.from(convKey))).toBe(true);

    expect(() =>
      sodium.crypto_box_seal_open(
        sealedForBob,
        alice.publicKey,
        alice.privateKey,
      ),
    ).toThrow();
  });

  it('round-trips attachment blob with magic prefix', () => {
    const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
    const plain = new Uint8Array([1, 2, 3, 4, 5, 9]);
    const magic = Buffer.from(CHAT_E2E_BODY_PREFIX, 'utf8');
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const cipher = sodium.crypto_secretbox_easy(plain, nonce, key);
    const blob = new Uint8Array(
      magic.length + nonce.length + cipher.length,
    );
    blob.set(magic, 0);
    blob.set(nonce, magic.length);
    blob.set(cipher, magic.length + nonce.length);

    const packed = blob.subarray(magic.length);
    const n = packed.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
    const c = packed.subarray(sodium.crypto_secretbox_NONCEBYTES);
    const opened = sodium.crypto_secretbox_open_easy(c, n, key);
    expect(Buffer.from(opened).equals(Buffer.from(plain))).toBe(true);
  });
});
