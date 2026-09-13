import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { server } from '../src/main.js';

describe('HTTP server', () => {
  let activeServer: Server;

  beforeEach(() => {
    activeServer = server;
    return new Promise<void>(resolve => activeServer.listen(0, '127.0.0.1', resolve));
  });

  afterEach(() => {
    return new Promise<void>(resolve => activeServer.close(() => resolve()));
  });

  it('maps media route errors to their intended HTTP status', async () => {
    const port = (activeServer.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/media/missing`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Movie not found' });
  });
});
