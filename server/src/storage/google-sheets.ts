import * as crypto from 'node:crypto';
import { googlePrivateKey, googleServiceAccountEmail, googleSpreadsheetId } from '../config.js';
import type { CatalogStore } from '../domain/catalog.js';
import type { MovieRecord } from '../types.js';
import { LEGACY_SHEET_FIELD_SETS, SHEET_FIELDS } from './schema.js';

export class GoogleSheetsStore implements CatalogStore {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private spreadsheetId: string, private worksheetName = process.env.GOOGLE_WORKSHEET_NAME ?? 'Movies') {}

  private async sheets(): Promise<void> {
    if (!googleServiceAccountEmail || !googlePrivateKey || !this.spreadsheetId) {
      throw new Error('Google Sheets credentials or spreadsheet ID are not configured');
    }
  }

  private async range(range: string) {
    return `${this.worksheetName}!${range}`;
  }

  private row(record: MovieRecord): string[] {
    return SHEET_FIELDS.map(field => {
      const value = (record as unknown as Record<string, unknown>)[field];
      return value === undefined || value === null ? '' : String(value);
    });
  }

  async list(): Promise<MovieRecord[]> {
    await this.sheets();
    await this.sheetId();
    await this.ensureHeaderRow();
    await this.repairMisalignedRows();
    const boundedResponse = await this.request('GET', `/values/${encodeURIComponent(await this.range(`A2:${columnLetter(SHEET_FIELDS.length)}1000`))}`);
    return (boundedResponse.values ?? []).map(rowToObject).filter(Boolean);
  }

  private async ensureHeaderRow(): Promise<void> {
    const response = await this.request('GET', `/values/${encodeURIComponent(await this.range(`A1:${columnLetter(SHEET_FIELDS.length)}1`))}`);
    const rawHeader = Array.isArray(response.values?.[0]) ? response.values[0] : [];
    const header = rawHeader.filter(value => String(value ?? '').trim() !== '');
    if (this.validateHeaders(header)) return;
    const isKnownPrefix = rawHeader.length <= SHEET_FIELDS.length && LEGACY_SHEET_FIELD_SETS.some(fields => (
      rawHeader.length === fields.length
      && rawHeader.every((field, index) => String(field ?? '').trim() === fields[index])
    ));
    if (rawHeader.length && !isKnownPrefix) {
      const headerNames = rawHeader.map(field => String(field ?? '').trim()).filter(Boolean);
      throw new Error(`Worksheet headers do not match the supported catalog schema. Found [${headerNames.join(', ')}]`);
    }
    const legacyWithoutFileSize = rawHeader.length === LEGACY_SHEET_FIELD_SETS[1].length
      && rawHeader.every((field, index) => String(field ?? '').trim() === LEGACY_SHEET_FIELD_SETS[1][index]);
    const hasExistingRows = legacyWithoutFileSize ? await this.hasExistingRows() : false;
    if (legacyWithoutFileSize && hasExistingRows) {
      await this.insertTelegramFileSizeColumn();
    }
    await this.request('PUT', `/values/${encodeURIComponent(await this.range(`A1:${columnLetter(SHEET_FIELDS.length)}1`))}?valueInputOption=RAW`, {
      values: [SHEET_FIELDS]
    });
  }

  private async repairMisalignedRows(): Promise<void> {
    const response = await this.request('GET', `/values/${encodeURIComponent(await this.range(`A2:${columnLetter(SHEET_FIELDS.length)}1000`))}`);
    const rows = response.values ?? [];
    const needsRepair = (rows as unknown[][]).some(row => {
      return !isAlignedRow(row) && isShiftedRow(row);
    });
    if (!needsRepair) return;
    await this.insertTelegramFileSizeColumn();
    await this.request('PUT', `/values/${encodeURIComponent(await this.range(`A1:${columnLetter(SHEET_FIELDS.length)}1`))}?valueInputOption=RAW`, {
      values: [SHEET_FIELDS]
    });
  }

  private async hasExistingRows(): Promise<boolean> {
    const response = await this.request('GET', `/values/${encodeURIComponent(await this.range(`A2:${columnLetter(SHEET_FIELDS.length)}1000`))}`);
    return ((response.values ?? []) as unknown[][]).some(row => Array.isArray(row) && row.some(value => String(value ?? '').trim() !== ''));
  }

  private async insertTelegramFileSizeColumn(): Promise<void> {
    await this.request('POST', ':batchUpdate', {
      requests: [{
        insertDimension: {
          range: { sheetId: await this.sheetId(), dimension: 'COLUMNS', startIndex: 19, endIndex: 20 },
          inheritFromBefore: true
        }
      }]
    });
  }

  async schemaDiagnostics(): Promise<{ alignedRows: number; misalignedRows: number; totalRows: number }> {
    await this.sheets();
    await this.sheetId();
    const response = await this.request('GET', `/values/${encodeURIComponent(await this.range(`A2:${columnLetter(SHEET_FIELDS.length)}1000`))}`);
    const rows = (response.values ?? []) as unknown[][];
    let alignedRows = 0;
    let misalignedRows = 0;
    for (const row of rows) {
      if (!Array.isArray(row) || !row.some(value => String(value ?? '').trim() !== '')) continue;
      if (isAlignedRow(row)) alignedRows += 1;
      else if (isShiftedRow(row)) misalignedRows += 1;
    }
    return { alignedRows, misalignedRows, totalRows: rows.length };
  }

  private validateHeaders(header: unknown[] | undefined): boolean {
    return Array.isArray(header) && SHEET_FIELDS.every((field, index) => String(header[index] ?? '').trim() === field);
  }

  async upsert(record: MovieRecord): Promise<MovieRecord> {
    await this.sheets();
    await this.sheetId();
    await this.ensureHeaderRow();
    await this.repairMisalignedRows();
    const values = await this.request('GET', `/values/${encodeURIComponent(await this.range(`A2:${columnLetter(SHEET_FIELDS.length)}1000`))}`);
    const rows = values.values as unknown[][] ?? [];
    const rowIndex = rows.findIndex(row => {
      const current = rowToObject(row);
      if (!current) return false;
      if (current.movie_id === record.movie_id) return true;
      return current.telegram_chat_id === record.telegram_chat_id
        && current.telegram_message_id === record.telegram_message_id
        && Boolean(record.telegram_chat_id)
        && Boolean(record.telegram_message_id);
    });
    const now = new Date().toISOString();
    const next = { ...record, updated_at: now, created_at: record.created_at ?? now };
    if (rowIndex < 0) {
      await this.request('POST', `/values/${encodeURIComponent(await this.range('A2'))}:append?valueInputOption=USER_ENTERED`, { values: [this.row(next)] });
    } else {
      await this.request('PUT', `/values/${encodeURIComponent(await this.range(`A${rowIndex + 2}:${columnLetter(SHEET_FIELDS.length)}${rowIndex + 2}`))}?valueInputOption=USER_ENTERED`, { values: [this.row(next)] });
    }
    return next;
  }

  async delete(movieId: string): Promise<void> {
    await this.sheets();
    const values = await this.request('GET', `/values/${encodeURIComponent(await this.range('A2:A'))}`);
    const ids = ((values.values ?? []) as unknown[]).flat().map(String);
    const rowIndex = ids.findIndex(id => id === movieId);
    if (rowIndex < 0) return;
    await this.request('POST', ':batchUpdate', {
      requests: [{ deleteDimension: { range: { sheetId: await this.sheetId(), dimension: 'ROWS', startIndex: rowIndex + 1, endIndex: rowIndex + 2 } } }]
    });
  }

  private async sheetId(): Promise<number> {
    await this.sheets();
    const response = await this.request('GET', '?fields=sheets.properties');
    const sheet = response.sheets?.find((sheet: { properties?: { title?: string } }) => sheet.properties?.title === this.worksheetName);
    if (sheet?.properties?.sheetId === undefined) throw new Error(`Worksheet ${this.worksheetName} was not found`);
    return sheet.properties.sheetId;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const token = await this.getAccessToken();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error?.message ?? `Google Sheets request failed (${response.status})`);
    return result;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) return this.accessToken;
    const now = Math.floor(Date.now() / 1000);
    const scope = 'https://www.googleapis.com/auth/spreadsheets';
    const kid = crypto.createHash('sha256').update(`${googleServiceAccountEmail}${scope}${now}`).digest('hex').slice(0, 16);
    const header = { alg: 'RS256', typ: 'JWT', kid };
    const claim = { iss: googleServiceAccountEmail, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
    const encoded = [header, claim].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(encoded), crypto.createPrivateKey({ key: googlePrivateKey }));
    const token = `${encoded}.${signature.toString('base64url')}`;
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: token })
    });
    const result: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error_description ?? `Google token request failed (${response.status})`);
    const { access_token: accessToken, expires_in: expiresIn } = result;
    if (!accessToken || !expiresIn) throw new Error('Google token response was invalid');
    this.accessToken = accessToken;
    this.accessTokenExpiresAt = (now + Number(expiresIn) - 60) * 1000;
    return accessToken;
  }
}

export function rowToObject(row: unknown[]): MovieRecord | null {
  const source = Array.isArray(row) ? row : [];
  const record: Record<string, unknown> = {};
  SHEET_FIELDS.forEach((field, index) => { record[field] = source[index]; });
  if (!record.movie_id || !record.title) return null;
  return record as unknown as MovieRecord;
}

function isAlignedRow(row: unknown[]): boolean {
  const fileSize = String(row[19] ?? '').trim();
  const status = String(row[20] ?? '').trim();
  const createdAt = String(row[21] ?? '').trim();
  const updatedAt = String(row[22] ?? '').trim();
  return Number.isFinite(Number(fileSize))
    && (status === 'published' || status === 'draft')
    && Date.parse(createdAt) > 0
    && Date.parse(updatedAt) > 0;
}

function isShiftedRow(row: unknown[]): boolean {
  const fileSize = String(row[19] ?? '').trim();
  const status = String(row[20] ?? '').trim();
  const createdAt = String(row[21] ?? '').trim();
  const updatedAt = String(row[22] ?? '').trim();
  const mediaUrl = String(row[23] ?? '').trim();
  const mediaObjectKey = String(row[24] ?? '').trim();
  const mediaReason = String(row[25] ?? '').trim();
  return Number(fileSize) === 0
    && status === 'published'
    && createdAt === ''
    && updatedAt === ''
    && mediaUrl === 'published'
    && Date.parse(mediaObjectKey) > 0
    && Date.parse(mediaReason) > 0
    && String(row[26] ?? '').trim() === '';
}

export function columnLetter(number: number): string {
  let value = number;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}
