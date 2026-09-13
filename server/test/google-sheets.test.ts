import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_SHEET_FIELD_SETS, SHEET_FIELDS } from '../src/storage/schema.js';

process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = 'test-key';

const { GoogleSheetsStore, columnLetter } = await import('../src/storage/google-sheets.js');

describe('GoogleSheetsStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mockSheetsRequest(responses: Record<string, unknown>) {
    return vi.spyOn(GoogleSheetsStore.prototype as unknown as { request: (...arguments_: unknown[]) => Promise<unknown> }, 'request')
      .mockImplementation(async (_method: string, path: string) => {
        const decodedPath = decodeURIComponent(path);
        const response = Object.entries(responses).find(([key]) => decodedPath.includes(key))?.[1];
        if (response === undefined) throw new Error(`Unexpected Sheets request: ${path}`);
        if (response instanceof Error) throw response;
        return response;
      });
  }
  const headerRange = `A1:${columnLetter(SHEET_FIELDS.length)}1`;
  const dataRange = `A2:${columnLetter(SHEET_FIELDS.length)}1000`;

  it('reads rows after validating the schema', async () => {
    const request = mockSheetsRequest({
      '?fields=sheets.properties': { sheets: [{ properties: { title: 'Movies', sheetId: 0 } }] },
      [headerRange]: { values: [SHEET_FIELDS] },
      [dataRange]: { values: [SHEET_FIELDS] }
    });

    const rows = await new GoogleSheetsStore('spreadsheet-id').list();

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {})).toEqual([...SHEET_FIELDS]);
    expect(request).toHaveBeenCalledWith('GET', `/values/${encodeURIComponent(`Movies!A1:${columnLetter(SHEET_FIELDS.length)}1`)}`);
    expect(request).not.toHaveBeenCalledWith('PUT', expect.any(String), expect.anything());
  });

  it('creates the header row before listing when it is missing', async () => {
    const request = mockSheetsRequest({
      '?fields=sheets.properties': { sheets: [{ properties: { title: 'Movies', sheetId: 0 } }] },
      [headerRange]: { values: [[]] },
      [dataRange]: { values: [] }
    });

    const rows = await new GoogleSheetsStore('spreadsheet-id').list();

    expect(rows).toEqual([]);
    expect(request).toHaveBeenCalledWith('PUT', `/values/${encodeURIComponent(`Movies!A1:${columnLetter(SHEET_FIELDS.length)}1`)}?valueInputOption=RAW`, { values: [SHEET_FIELDS] });
  });

  it('migrates the supported 22-column header to the full schema', async () => {
    const request = mockSheetsRequest({
      '?fields=sheets.properties': { sheets: [{ properties: { title: 'Movies', sheetId: 0 } }] },
      [headerRange]: { values: [SHEET_FIELDS.slice(0, 22)] },
      [dataRange]: { values: [] }
    });

    const rows = await new GoogleSheetsStore('spreadsheet-id').list();

    expect(rows).toEqual([]);
    expect(request).toHaveBeenCalledWith('PUT', `/values/${encodeURIComponent(`Movies!A1:${columnLetter(SHEET_FIELDS.length)}1`)}?valueInputOption=RAW`, { values: [SHEET_FIELDS] });
  });

  it('migrates the original Telegram catalog header without file size to the full schema', async () => {
    const request = mockSheetsRequest({
      '?fields=sheets.properties': { sheets: [{ properties: { title: 'Movies', sheetId: 0 } }] },
      [headerRange]: { values: [LEGACY_SHEET_FIELD_SETS[0]] },
      [dataRange]: { values: [] }
    });

    const rows = await new GoogleSheetsStore('spreadsheet-id').list();

    expect(rows).toEqual([]);
    expect(request).toHaveBeenCalledWith('PUT', `/values/${encodeURIComponent(`Movies!A1:${columnLetter(SHEET_FIELDS.length)}1`)}?valueInputOption=RAW`, { values: [SHEET_FIELDS] });
  });

  it('inserts the file-size column without shifting existing legacy rows', async () => {
    const legacyRow = ['telegram--100123-8', 'Movies Korea', '', '', '', '', '', '', '', '', '', '', '', 'movie', '', '', '-100123', '8', 'file-id', '', 'published', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z'];
    const request = mockSheetsRequest({
      '?fields=sheets.properties': { sheets: [{ properties: { title: 'Movies', sheetId: 0 } }] },
      [headerRange]: { values: [LEGACY_SHEET_FIELD_SETS[1]] },
      [dataRange]: { values: [legacyRow] },
      ':batchUpdate': {}
    });

    const rows = await new GoogleSheetsStore('spreadsheet-id').list();

    expect(rows[0]).toMatchObject({ movie_id: 'telegram--100123-8', telegram_message_id: '8', status: 'published' });
    expect(request).toHaveBeenCalledWith('POST', ':batchUpdate', { requests: [{ insertDimension: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 19, endIndex: 20 }, inheritFromBefore: true } }] });
    expect(request).toHaveBeenCalledWith('PUT', `/values/${encodeURIComponent(`Movies!A1:${columnLetter(SHEET_FIELDS.length)}1`)}?valueInputOption=RAW`, { values: [SHEET_FIELDS] });
  });

  it('repares rows misaligned by an earlier header-only migration', async () => {
    const misalignedRow = ['telegram--100123-8', 'Movies Korea', '', '', '', '', '', '', '', '', '', '', '', 'movie', '', '', '-100123', '8', 'file-id', 'published', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', '', '', '', ''];
    const request = mockSheetsRequest({
      '?fields=sheets.properties': { sheets: [{ properties: { title: 'Movies', sheetId: 0 } }] },
      [headerRange]: { values: [SHEET_FIELDS] },
      [dataRange]: { values: [misalignedRow] },
      ':batchUpdate': {}
    });

    const rows = await new GoogleSheetsStore('spreadsheet-id').list();

    expect(rows).toHaveLength(1);
    expect(request).toHaveBeenCalledWith('POST', ':batchUpdate', { requests: [{ insertDimension: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 19, endIndex: 20 }, inheritFromBefore: true } }] });
    expect(request).toHaveBeenCalledWith('PUT', `/values/${encodeURIComponent(`Movies!A1:${columnLetter(SHEET_FIELDS.length)}1`)}?valueInputOption=RAW`, { values: [SHEET_FIELDS] });
  });

  it('rejects an unsupported existing header layout', async () => {
    mockSheetsRequest({
      '?fields=sheets.properties': { sheets: [{ properties: { title: 'Movies', sheetId: 0 } }] },
      [headerRange]: { values: [['movie_id', 'unexpected_header']] },
      [dataRange]: { values: [] }
    });

    await expect(new GoogleSheetsStore('spreadsheet-id').list()).rejects.toThrow('Found [movie_id, unexpected_header]');
  });

  it('updates an existing row matched by Telegram chat and message IDs instead of appending', async () => {
    const existingRow = [...SHEET_FIELDS];
    existingRow[0] = 'existing-id';
    existingRow[1] = 'Existing Title';
    existingRow[16] = '-100123';
    existingRow[17] = '456';
    const request = mockSheetsRequest({
      [dataRange]: { values: [existingRow] },
      '?fields=sheets.properties': { sheets: [{ properties: { title: 'Movies', sheetId: 0 } }] },
      [headerRange]: { values: [SHEET_FIELDS] },
      'A2:': {}
    });
    const record = SHEET_FIELDS.reduce((accumulator, field) => ({ ...accumulator, [field]: '' }), {}) as Record<string, string>;

    const next = await new GoogleSheetsStore('spreadsheet-id').upsert({
      ...record,
      movie_id: 'new-id',
      title: 'New Title',
      telegram_chat_id: '-100123',
      telegram_message_id: '456'
    } as Parameters<GoogleSheetsStore['upsert']>[0]);

    expect(next).toMatchObject({ movie_id: 'new-id', title: 'New Title', telegram_chat_id: '-100123', telegram_message_id: '456' });
    expect(request).not.toHaveBeenCalledWith('POST', expect.stringContaining(':append'), expect.anything());
    const updateCall = request.mock.calls.find(([method, path]) => method === 'PUT' && /Movies!A2:[A-Z]+2/.test(decodeURIComponent(String(path))));
    expect((updateCall?.[2] as { values: string[][] }).values[0][0]).toBe('new-id');
  });
});
