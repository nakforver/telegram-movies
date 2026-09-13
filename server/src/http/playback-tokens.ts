import { createHmac, timingSafeEqual } from 'node:crypto';

const defaultTtlMs = 5 * 60 * 1000;

function secret(): string {
  return process.env.PLAYBACK_TOKEN_SECRET || process.env.ADMIN_SECRET || '';
}

export function signPlaybackToken(movieId: string, expiresAt = Date.now() + defaultTtlMs): string {
  const playbackSecret = secret();
  if (!playbackSecret) throw new Error('Playback signing secret is not configured');
  const payload = `${movieId}.${expiresAt}`;
  const signature = createHmac('sha256', playbackSecret).update(payload).digest('base64url');
  return `${expiresAt}.${signature}`;
}

export function verifyPlaybackToken(movieId: string, token: string | undefined): boolean {
  const playbackSecret = secret();
  if (!playbackSecret || !token) return false;
  const [expiresAtText, signature] = token.split('.');
  const expiresAt = Number(expiresAtText);
  if (!Number.isInteger(expiresAt) || expiresAt < Date.now()) return false;
  const expected = createHmac('sha256', playbackSecret).update(`${movieId}.${expiresAt}`).digest('base64url');
  const provided = Buffer.from(signature ?? '');
  const expectedBuffer = Buffer.from(expected);
  return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
}
