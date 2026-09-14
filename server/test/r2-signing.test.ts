import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { uploadToR2, signedR2Url } from '../src/storage/r2.js';

process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET = 'test-bucket';

const originalValues = Object.fromEntries(['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].map(name => [name, process.env[name]]));

describe('Cloudflare R2 signing', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    vi.useRealTimers();
    for (const [name, value] of Object.entries(originalValues)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('signs streaming uploads with AWS Signature Version 4', async () => {
    const stream = new ReadableStream<Uint8Array>({ start: controller => controller.close() });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await uploadToR2('movies/movie.mp4', stream, 'video/mp4', 5);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { duplex: 'half' }];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://test-account.r2.cloudflarestorage.com/test-bucket/movies/movie.mp4');
    expect(init.method).toBe('PUT');
    expect(init.duplex).toBe('half');
    expect(headers.authorization).toContain('Credential=test-access-key/20260101/auto/s3/aws4_request');
    expect(headers.authorization).toContain('Signature=e72b3274624179ad70b0628784ff68b2af640a9c6078216d9076b8c27412af57');
  });

  it('caps presigned URLs at the R2 maximum expiration', () => {
    const url = signedR2Url('movies/movie.mp4', Date.parse('2026-01-11T00:00:00Z'));
    const query = new URL(url).searchParams;

    expect(query.get('X-Amz-Expires')).toBe('604800');
    expect(query.get('X-Amz-Signature')).toBe('774a85fbb5fc702a7827bcc8011503e22d59442c5b8dbeba639f33a6d6dfe71b');
  });
});
