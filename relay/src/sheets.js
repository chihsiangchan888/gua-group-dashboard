// Minimal Google Sheets API v4 client for Cloudflare Workers (and Node 18+).
// Auth: service-account JWT (RS256 via WebCrypto) exchanged for a one-hour access token.
// Reads use UNFORMATTED_VALUE + SERIAL_NUMBER so dates come back as serial numbers and are
// normalised by fmtDate(); writes use RAW so strings stay strings (same as Apps Script setValues).

const enc = new TextEncoder();
const b64url = (input) => {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function importPrivateKey(pem) {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', raw, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

// Google Sheets serial day 0 = 1899-12-30. Dates are calendar days, no timezone involved.
export function fmtDate(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return String(v);
}
export const cell = (row, i) => (row && row[i] !== undefined && row[i] !== null ? row[i] : '');
export function todayTaipei() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }

export class Sheets {
  constructor(saJson, spreadsheetId, fetchImpl) {
    this.sa = typeof saJson === 'string' ? JSON.parse(saJson) : saJson;
    this.id = spreadsheetId;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.token = null; this.tokenExp = 0; this.meta = null;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExp - 60000) return this.token;
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({ iss: this.sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
    const input = header + '.' + claim;
    const key = await importPrivateKey(this.sa.private_key);
    const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, enc.encode(input));
    const jwt = input + '.' + b64url(new Uint8Array(sig));
    const r = await this.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
    const j = await r.json();
    if (!j.access_token) throw new Error('token exchange failed: ' + JSON.stringify(j).slice(0, 200));
    this.token = j.access_token; this.tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
    return this.token;
  }

  async api(path, opts) {
    const tok = await this.accessToken();
    const r = await this.fetch('https://sheets.googleapis.com/v4/spreadsheets/' + this.id + path, Object.assign({}, opts || {}, { headers: Object.assign({ Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }));
    const text = await r.text();
    let j; try { j = text ? JSON.parse(text) : {}; } catch (e) { throw new Error('sheets ' + r.status + ': ' + text.slice(0, 200)); }
    if (!r.ok) throw new Error('sheets ' + r.status + ': ' + ((j.error && j.error.message) || text.slice(0, 200)));
    return j;
  }

  async sheetsMeta(force) {
    if (this.meta && !force) return this.meta;
    const j = await this.api('?fields=sheets.properties');
    this.meta = (j.sheets || []).map((s) => s.properties);
    return this.meta;
  }
  async sheetId(title) { const s = (await this.sheetsMeta()).find((p) => p.title === title); return s ? s.sheetId : null; }
  async hasSheet(title) { return (await this.sheetId(title)) !== null; }

  // create the tab with a header row when it is missing (Apps Script insertSheet + header)
  async ensureSheet(title, header) {
    if (await this.hasSheet(title)) return false;
    await this.api(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }) });
    await this.sheetsMeta(true);
    if (header && header.length) await this.update(title + '!A1', [header]);
    return true;
  }

  async getValues(title) {
    const j = await this.api('/values/' + encodeURIComponent(title) + '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
    return j.values || [];
  }
  // several tabs in one round trip; tabs that do not exist come back as null
  async getMany(titles) {
    const meta = await this.sheetsMeta();
    const existing = titles.filter((t) => meta.some((p) => p.title === t));
    let map = {};
    if (existing.length) {
      const q = existing.map((t) => 'ranges=' + encodeURIComponent(t)).join('&');
      const j = await this.api('/values:batchGet?' + q + '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
      (j.valueRanges || []).forEach((vr, i) => { map[existing[i]] = vr.values || []; });
    }
    const out = {};
    titles.forEach((t) => { out[t] = existing.includes(t) ? (map[t] || []) : null; });
    return out;
  }

  async update(range, values) {
    return this.api('/values/' + encodeURIComponent(range) + '?valueInputOption=RAW', { method: 'PUT', body: JSON.stringify({ range, majorDimension: 'ROWS', values }) });
  }
  async batchUpdateValues(items) { // [{range, values}]
    if (!items.length) return;
    return this.api('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: items.map((x) => ({ range: x.range, majorDimension: 'ROWS', values: x.values })) }) });
  }
  // same semantics as Apps Script appendRow: the row after the last row that has content
  async appendRow(title, row) {
    const values = await this.getValues(title);
    const r = values.length + 1;
    await this.update(title + '!A' + r, [row]);
    return r;
  }
  async clear(range) { return this.api('/values/' + encodeURIComponent(range) + ':clear', { method: 'POST', body: '{}' }); }
  // 1-based sheet rows, possibly across several tabs: {title: [rows]}; delete bottom-up per tab
  async deleteRows(byTitle) {
    const requests = [];
    for (const title of Object.keys(byTitle)) {
      const sid = await this.sheetId(title);
      if (sid === null) continue;
      [...new Set(byTitle[title])].sort((a, b) => b - a).forEach((r) => requests.push({ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } }));
    }
    if (requests.length) await this.api(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
  }
}
