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
