import { createHash, createHmac } from 'node:crypto';

export interface R2Configuration {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const unsignedPayload = 'UNSIGNED-PAYLOAD';
const maxPresignedUrlSeconds = 7 * 24 * 60 * 60;

export function r2Configuration(): R2Configuration | null {
  const accountId = process.env.R2_ACCOUNT_ID ?? '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? '';
  const bucket = process.env.R2_BUCKET ?? '';
  return accountId && accessKeyId && secretAccessKey && bucket
    ? { accountId, accessKeyId, secretAccessKey, bucket }
    : null;
}

function endpoint(configuration: R2Configuration, objectKey: string, query: URLSearchParams = new URLSearchParams()): string {
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  const suffix = query.size ? `?${query}` : '';
  return `https://${configuration.accountId}.r2.cloudflarestorage.com/${configuration.bucket}/${encodedKey}${suffix}`;
}

function hmac(value: string, key: Buffer | string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function credentials(secretAccessKey: string, date: string): Buffer {
  return hmac(date, `AWS4${secretAccessKey}`);
}

function authorization(
  configuration: R2Configuration,
  method: string,
  canonicalUri: string,
  query: URLSearchParams,
  headers: Record<string, string>,
  date: Date
): string {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const sortedHeaders = Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const canonicalHeaders = sortedHeaders.map(([name, value]) => `${name}:${value}\n`).join('');
  const signedHeaders = sortedHeaders.map(([name]) => name).join(';');
  const canonicalQuery = [...query.entries()].map(([key, value]) => [key, value])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, unsignedPayload].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  const signingKey = hmac(`aws4_request`, hmac('s3', hmac('auto', credentials(configuration.secretAccessKey, dateStamp))));
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${configuration.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function canonicalUri(configuration: R2Configuration, objectKey: string): string {
  return `/${configuration.bucket}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

async function readError(response: Response, action: string): Promise<Error> {
  const body = await response.text().catch(() => '');
  const message = body.match(/<Message>([^<]+)<\/Message>/)?.[1];
  return new Error(message ? `${action} failed: ${message}` : `${action} failed (${response.status})`);
}

export async function uploadToR2(
  objectKey: string,
  body: ReadableStream<Uint8Array>,
  contentType = 'video/mp4',
  contentLength?: number
): Promise<{ objectKey: string }> {
  const configuration = r2Configuration();
  if (!configuration) throw new Error('Cloudflare R2 is not configured');
  if (contentLength === undefined || !Number.isFinite(contentLength) || contentLength < 0) {
    throw new Error('R2 upload requires a known content length');
  }
  const date = new Date();
  const host = `${configuration.accountId}.r2.cloudflarestorage.com`;
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': unsignedPayload,
    'x-amz-date': date.toISOString().replace(/[:-]|\.\d{3}/g, ''),
    'content-type': contentType,
    'content-length': String(contentLength)
  };
  const query = new URLSearchParams();
  headers.authorization = authorization(configuration, 'PUT', canonicalUri(configuration, objectKey), query, headers, date);
  const response = await fetch(endpoint(configuration, objectKey), {
    method: 'PUT',
    headers,
    body,
    duplex: 'half'
  } as RequestInit & { duplex: 'half' });
  if (!response.ok) throw await readError(response, 'R2 upload');
  await response.body?.cancel().catch(() => undefined);
  return { objectKey };
}

export function signedR2Url(objectKey: string, expiresAt = Date.now() + 5 * 60 * 1000): string | null {
  const configuration = r2Configuration();
  if (!configuration) return null;
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = `${configuration.accountId}.r2.cloudflarestorage.com`;
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${configuration.accessKeyId}/${dateStamp}/auto/s3/aws4_request`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(maxPresignedUrlSeconds, Math.max(1, Math.floor((expiresAt - date.getTime()) / 1000)))),
    'X-Amz-SignedHeaders': 'host'
  });
  const canonicalQuery = [...query.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  const canonicalRequest = [
    'GET',
    canonicalUri(configuration, objectKey),
    canonicalQuery,
    `host:${host}\n`,
    'host',
    unsignedPayload
  ].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  const signingKey = hmac(`aws4_request`, hmac('s3', hmac('auto', credentials(configuration.secretAccessKey, dateStamp))));
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  query.set('X-Amz-Signature', signature);
  return endpoint(configuration, objectKey, query);
}

export async function streamR2Object(objectKey: string, range?: string): Promise<Response> {
  const configuration = r2Configuration();
  if (!configuration) throw new Error('Cloudflare R2 is not configured');
  const url = signedR2Url(objectKey);
  if (!url) throw new Error('Cloudflare R2 is not configured');
  const response = await fetch(url, { headers: range ? { range } : undefined });
  if (!response.ok || !response.body) throw new Error(`R2 object request failed (${response.status})`);
  return response;
}
