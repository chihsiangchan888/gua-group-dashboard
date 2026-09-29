// In-memory stand-in for the parts of the Sheets API v4 the relay uses, exposed as a fetch().
// Enough fidelity to check row arithmetic: A1 ranges, append-after-last-row, clear, deleteDimension.
export function makeFakeSheets(initial) {
  const book = {}; // title -> rows (arrays of cells)
  let nextId = 100;
  const ids = {};
  for (const t of Object.keys(initial || {})) { book[t] = initial[t].map((r) => r.slice()); ids[t] = nextId++; }
  const calls = [];

  const colNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  function parseRange(range) { // "title" | "title!A1" | "title!A2:J9"
    const m = /^(.*?)(?:!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?)?$/.exec(decodeURIComponent(range));
    return { title: m[1].replace(/^'|'$/g, ''), r0: m[3] ? +m[3] : 1, c0: m[2] ? colNum(m[2]) : 1, r1: m[5] ? +m[5] : null, c1: m[4] ? colNum(m[4]) : null };
  }
  const titleOf = (t) => book[t];
  function setValues(rg, values) {
    const rows = titleOf(rg.title); if (!rows) throw new Error('no sheet ' + rg.title);
    values.forEach((vr, i) => { const r = rg.r0 - 1 + i; while (rows.length <= r) rows.push([]); vr.forEach((v, j) => { const c = rg.c0 - 1 + j; while (rows[r].length <= c) rows[r].push(''); rows[r][c] = v; }); });
  }
  function trimmed(rows) { // like the API: drop trailing empty rows / cells
    const out = rows.map((r) => { const c = r.slice(); while (c.length && (c[c.length - 1] === '' || c[c.length - 1] == null)) c.pop(); return c; });
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out;
  }
  const ok = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const err = (status, msg) => new Response(JSON.stringify({ error: { message: msg } }), { status });

  async function fetchImpl(url, opts) {
    const u = new URL(url); const method = (opts && opts.method) || 'GET';
    calls.push(method + ' ' + u.pathname + u.search);
    if (u.hostname === 'oauth2.googleapis.com') { if (!/assertion=[\w-]+\.[\w-]+\.[\w-]+/.test(opts.body)) return err(400, 'bad jwt'); return ok({ access_token: 'fake-token', expires_in: 3600 }); }
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (!opts || !opts.headers || opts.headers.Authorization !== 'Bearer fake-token') return err(401, 'no token');
    const p = u.pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, '');
    if (p === '' && u.searchParams.get('fields') === 'sheets.properties') return ok({ sheets: Object.keys(book).map((t) => ({ properties: { title: t, sheetId: ids[t] } })) });
    if (p === ':batchUpdate') {
      for (const rq of body.requests) {
        if (rq.addSheet) { const t = rq.addSheet.properties.title; if (book[t]) return err(400, 'exists'); book[t] = []; ids[t] = nextId++; }
        else if (rq.deleteDimension) { const { sheetId, startIndex, endIndex } = rq.deleteDimension.range; const t = Object.keys(ids).find((k) => ids[k] === sheetId); book[t].splice(startIndex, endIndex - startIndex); }
        else return err(400, 'unsupported request');
      }
      return ok({});
    }
    if (p === '/values:batchGet') { const ranges = u.searchParams.getAll('ranges').map(parseRange); for (const rg of ranges) if (!book[rg.title]) return err(400, 'Unable to parse range: ' + rg.title); return ok({ valueRanges: ranges.map((rg) => ({ values: trimmed(book[rg.title]) })) }); }
    if (p === '/values:batchUpdate') { for (const d of body.data) setValues(parseRange(d.range), d.values); return ok({}); }
    let m = /^\/values\/(.+?)(:clear|:append)?$/.exec(p);
    if (m) {
      const rg = parseRange(m[1]);
      if (!book[rg.title]) return err(400, 'Unable to parse range: ' + rg.title);
      if (m[2] === ':clear') { const rows = book[rg.title]; const r1 = rg.r1 || rows.length, c1 = rg.c1 || 26; for (let r = rg.r0 - 1; r < r1 && r < rows.length; r++) for (let c = rg.c0 - 1; c < c1 && c < rows[r].length; c++) rows[r][c] = ''; return ok({}); }
      if (method === 'GET') return ok({ values: trimmed(book[rg.title]) });
      if (method === 'PUT') { setValues(rg, body.values); return ok({}); }
    }
    return err(404, 'unsupported ' + method + ' ' + p);
  }
  return { fetch: fetchImpl, book, calls, dump: (t) => trimmed(book[t]) };
}
