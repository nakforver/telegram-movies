import { describe, expect, it, vi } from 'vitest';
import { SHEET_FIELDS } from '../src/storage/schema.js';

describe('GoogleSheetsStore', () => {
  it('reads rows after validating the schema', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
    process.env.GOOGLE_PRIVATE_KEY = 'test-key';
    const { GoogleSheetsStore, columnLetter } = await import('../src/storage/google-sheets.js');
    const request = vi.spyOn(GoogleSheetsStore.prototype as unknown as { request: (...arguments_: unknown[]) => Promise<unknown> }, 'request')
      .mockResolvedValueOnce({ sheets: [{ properties: { title: 'Movies', sheetId: 0 } }] })
      .mockResolvedValueOnce({ values: [SHEET_FIELDS] })
      .mockResolvedValueOnce({ values: [SHEET_FIELDS] });

    const rows = await new GoogleSheetsStore('spreadsheet-id').list();

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {})).toEqual([...SHEET_FIELDS]);
    expect(request).toHaveBeenCalledWith('GET', `/values/${encodeURIComponent(`Movies!A1:${columnLetter(SHEET_FIELDS.length)}1`)}`);
    expect(request).not.toHaveBeenCalledWith('PUT', expect.any(String), expect.anything());
    request.mockRestore();
  });

  it('creates the header row before listing when it is missing', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
    process.env.GOOGLE_PRIVATE_KEY = 'test-key';
    const { GoogleSheetsStore, columnLetter } = await import('../src/storage/google-sheets.js');
    const request = vi.spyOn(GoogleSheetsStore.prototype as unknown as { request: (...arguments_: unknown[]) => Promise<unknown> }, 'request')
      .mockResolvedValueOnce({ sheets: [{ properties: { title: 'Movies', sheetId: 0 } }] })
      .mockResolvedValueOnce({ values: [[]] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ values: [] });

    const rows = await new GoogleSheetsStore('spreadsheet-id').list();

    expect(rows).toEqual([]);
    expect(request).toHaveBeenCalledWith('PUT', `/values/${encodeURIComponent(`Movies!A1:${columnLetter(SHEET_FIELDS.length)}1`)}?valueInputOption=RAW`, { values: [SHEET_FIELDS] });
    request.mockRestore();
  });
});

  it('updates an existing row matched by Telegram chat and message IDs instead of appending', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
    process.env.GOOGLE_PRIVATE_KEY = 'test-key';
    const { GoogleSheetsStore, columnLetter } = await import('../src/storage/google-sheets.js');
    const existingRow = [
      'existing-id', 'Existing Title', '', '', '', '', '', 'Movies', '', '', '', '', '', 'movie', '', '', '-100123', '456', '', 'published', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    ];
    const token = vi.spyOn(GoogleSheetsStore.prototype as unknown as { getAccessToken: () => Promise<string> }, 'getAccessToken').mockResolvedValue('token');
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ values: [existingRow] }) }));
    vi.stubGlobal('fetch', fetchSpy);

    const next = await new GoogleSheetsStore('spreadsheet-id').upsert({ ...SHEET_FIELDS, movie_id: 'new-id', title: 'New Title', telegram_chat_id: '-100123', telegram_message_id: '456' });

    expect(next).toMatchObject({ movie_id: 'new-id', title: 'New Title', telegram_chat_id: '-100123', telegram_message_id: '456' });
    expect(fetchSpy.mock.calls.some(([, options]) => String(options?.method).toUpperCase() === 'POST' && String(options?.body ?? '').includes('"new-id"'))).toBe(false);
    const putCall = fetchSpy.mock.calls.find(([, options]) => String(options?.method).toUpperCase() === 'PUT');
    expect(putCall).toBeDefined();
    expect(String(putCall?.[1]?.body)).toContain('"new-id"');
    token.mockRestore();
    vi.unstubAllGlobals();
  });
