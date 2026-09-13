import { createServer, type IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { port, isProduction } from './config.js';
import { createCatalog, handleApi } from './http/router.js';
import { handleMedia } from './http/media.js';

const catalog = createCatalog();
const frontendRoot = resolve(process.cwd(), 'frontend', 'dist');
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    if (await handleApi(request, response, catalog, pathname, url.searchParams)) return;
    const mediaMatch = pathname.match(/^\/api\/media\/([^/]+)$/);
    if (mediaMatch) {
      await handleMedia(request, response, catalog, decodeURIComponent(mediaMatch[1]));
      return;
    }
    await serveStatic(pathname, response);
  } catch (error) {
    console.error(error);
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ success: false, error: 'Unexpected server error' }));
  }
});

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(frontendRoot, safePath === '/' ? 'index.html' : safePath);
  if (!filePath.startsWith(frontendRoot)) throw new Error('Invalid path');
  try {
    const file = await readFile(filePath);
    response.writeHead(200, { 'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    response.end(file);
  } catch {
    const index = await readFile(join(frontendRoot, 'index.html'));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
    response.end(index);
  }
}

server.listen(port, '0.0.0.0', () => {
  console.log(`Telegram Movies listening on http://0.0.0.0:${port} (${isProduction ? 'production' : 'development'})`);
});

export { server };
