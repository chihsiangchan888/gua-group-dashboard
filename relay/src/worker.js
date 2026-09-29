// Cloudflare Worker entry. Speaks the exact contract the dashboard already uses:
//   GET  /               → readAll
//   GET  /?action=readAB → readAB   (any read-only action)
//   GET  /?payload=<json>  or  POST / with a JSON body → any action
// Write actions need `key` when WRITE_KEY is set, and are de-duplicated by `reqId` (KV, 6 h).
import { Sheets } from './sheets.js';
import { readAll, run, WRITE_ACTIONS } from './actions.js';

const json = (obj, status, origin, extra) => new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors(origin), extra || {}) });
function cors(origin) {
  return { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
}
function pickOrigin(req, env) {
  const o = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes('*')) return '*';
  return allowed.includes(o) ? o : allowed[0];
}

export async function handle(req, env) {
  const origin = pickOrigin(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  const url = new URL(req.url);
  let body = null;
  try {
    if (req.method === 'POST') body = await req.json();
    else if (url.searchParams.get('payload')) body = JSON.parse(url.searchParams.get('payload'));
    else if (url.searchParams.get('action')) body = { action: url.searchParams.get('action') };
    else body = { action: 'readAll' };
  } catch (e) { return json({ success: false, error: 'bad request: ' + e.message }, 400, origin); }

  const caps = { reqId: true, writeKey: !!env.WRITE_KEY, relay: 'sheets-api' };
  const a = body.action;
  if (a === 'caps') return json({ success: true, caps }, 200, origin);
  if (!env.GOOGLE_SA_JSON || !env.SHEET_ID) return json({ success: false, error: 'relay not configured (GOOGLE_SA_JSON / SHEET_ID)' }, 500, origin);

  if (WRITE_ACTIONS[a]) {
    if (env.WRITE_KEY && String(body.key || '') !== env.WRITE_KEY) return json({ success: false, error: 'unauthorized' }, 200, origin);
    if (body.reqId && env.DEDUP) {
      const hit = await env.DEDUP.get('req:' + body.reqId);
      if (hit) return new Response(hit, { status: 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'X-Relay-Dedup': 'hit' }, cors(origin)) });
    }
  }

  const sh = new Sheets(env.GOOGLE_SA_JSON, env.SHEET_ID);
  let result;
  try {
    result = a === 'readAll' ? await readAll(sh, caps) : await run(sh, body);
  } catch (e) {
    return json({ success: false, error: 'relay: ' + (e.message || String(e)) }, 200, origin);
  }
  const text = JSON.stringify(result);
  if (WRITE_ACTIONS[a] && body.reqId && env.DEDUP && result && result.success) {
    try { await env.DEDUP.put('req:' + body.reqId, text, { expirationTtl: 21600 }); } catch (e) { /* de-dup is best effort */ }
  }
  return new Response(text, { status: 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors(origin)) });
}

export default { fetch: (req, env) => handle(req, env) };
