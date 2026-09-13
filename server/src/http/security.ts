import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { adminSecret, frontendUrl } from '../config.js';

export function applySecurityHeaders(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  let allowOrigin = frontendUrl || '*';
  if (!frontendUrl && typeof origin === 'string') {
    try { allowOrigin = new URL(origin).origin; } catch { allowOrigin = ''; }
  }
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (allowOrigin) response.setHeader('Access-Control-Allow-Origin', allowOrigin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Secret');
}

export function isAdmin(request: IncomingMessage): boolean {
  const header = request.headers['x-admin-secret'];
  if (!adminSecret) return false;
  const provided = Array.isArray(header) ? header[0] : header;
  return typeof provided === 'string' && safeEqual(provided, adminSecret);
}


function safeEqual(a: string, b: string): boolean {
  const encodedA = Buffer.from(a);
  const encodedB = Buffer.from(b);
  return encodedA.length === encodedB.length && timingSafeEqual(encodedA, encodedB);
}
