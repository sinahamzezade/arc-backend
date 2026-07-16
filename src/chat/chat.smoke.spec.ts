import {
  CHAT_ALLOWED_MIME,
  CHAT_MAX_BODY_CHARS,
  ConversationType,
  ChatMessageType,
  directPairKey,
} from './chat.constants';

/**
 * Lightweight smoke checks for chat MVP invariants (no DB).
 * Full two-user flow needs running API + friends relationship.
 */
describe('chat MVP smoke invariants', () => {
  it('DM pair key collapses order', () => {
    const a = '11111111-1111-1111-1111-111111111111';
    const b = '22222222-2222-2222-2222-222222222222';
    expect(directPairKey(a, b)).toEqual(directPairKey(b, a));
  });

  it('exposes expected conversation + message types', () => {
    expect(ConversationType.Direct).toBe('direct');
    expect(ConversationType.Group).toBe('group');
    expect(ChatMessageType.Text).toBe('text');
    expect(ChatMessageType.Image).toBe('image');
  });

  it('allows study-upload style image MIME types', () => {
    expect(CHAT_ALLOWED_MIME.has('image/jpeg')).toBe(true);
    expect(CHAT_ALLOWED_MIME.has('image/png')).toBe(true);
    expect(CHAT_ALLOWED_MIME.has('application/x-msdownload')).toBe(false);
  });

  it('caps body length', () => {
    expect(CHAT_MAX_BODY_CHARS).toBeGreaterThan(0);
    expect(CHAT_MAX_BODY_CHARS).toBeLessThanOrEqual(8000);
  });
});
