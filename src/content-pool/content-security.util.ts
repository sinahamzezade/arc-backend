import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function keyBytes(): Buffer {
  const raw =
    process.env.CONTENT_ANSWER_KEY ||
    process.env.JWT_ACCESS_SECRET ||
    'arc-dev-content-answer-key';
  return createHash('sha256').update(raw).digest();
}

/** Encrypt answer payload at rest. Play APIs never return this blob. */
export function encryptAnswerPayload(
  payload: Record<string, unknown>,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyBytes(), iv);
  const json = JSON.stringify(payload);
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    Buffer.concat([iv, tag, enc]).toString('base64url')
  );
}

export function decryptAnswerPayload(
  blob: string,
): Record<string, unknown> | null {
  if (!blob.startsWith(PREFIX)) {
    try {
      return JSON.parse(blob) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  try {
    const buf = Buffer.from(blob.slice(PREFIX.length), 'base64url');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv(ALGO, keyBytes(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Strip obvious script tags from author HTML/text blocks. */
export function sanitizeContentHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+=(["']).*?\1/gi, '')
    .replace(/javascript:/gi, '');
}

export function sanitizeBodyDeep(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeContentHtml(value);
  if (Array.isArray(value)) return value.map(sanitizeBodyDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeBodyDeep(v);
    }
    return out;
  }
  return value;
}
