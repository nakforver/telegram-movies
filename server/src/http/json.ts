export function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(payload);
}
export function success<T>(response: import('node:http').ServerResponse, data: T, status = 200): void {
  sendJson(response, status, { success: true, data });
}
export function failure(response: import('node:http').ServerResponse, status: number, error: string): void {
  sendJson(response, status, { success: false, error });
}
