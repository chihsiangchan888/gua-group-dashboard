// Offline test of the relay: every action runs against the fake Sheets API and the resulting
// sheet contents are compared with what the Apps Script version would have produced.
//   node test/run.js
import { Sheets } from '../src/sheets.js';
import { readAll, run } from '../src/actions.js';
import { handle } from '../src/worker.js';
import { makeFakeSheets } from './fake-sheets.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; } else { fail++; console.log('FAIL ' + name + '\n  got  ' + g + '\n  want ' + w); } };
const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (info ? ' ' + JSON.stringify(info) : '')); } };

// a real RSA key so the JWT signing path runs for real
async function fakeServiceAccount() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  let b = ''; for (const x of pkcs8) b += String.fromCharCode(x);
  const pem = '-----BEGIN PRIVATE KEY-----\n' + btoa(b).match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
  return { client_email: 'relay@test.iam.gserviceaccount.com', private_key: pem };
}

const SERIAL_2026_09_17 = 46282; // 2026-09-17 as a Sheets serial number
const initial = {
  '進行中': [
    ['機台名稱', '階段名稱', '計畫開始日', '計畫結束日', '實際開始日', '實際結束日', '負責人', '備註', '優先級', '類型'],
    ['A機', '版更', '', SERIAL_2026_09_17, '', '', '小明', '', '高', '里程碑'],
    ['A機', '送審', '', '2026-09-28', '', '', '小明', '', '', '里程碑'],
    ['B機', '未開始', '', '', '', '', '', '', '中', '工作階段'],
  ],
  '機台狀態': [['機台名稱', '目前狀態', '進度', '最後更新日', '上線日期'], ['A機', '打磨中', 80, SERIAL_2026_09_17, '']],
  '議題清單': [['標題', '狀態', '嚴重度', '負責人', '建立日', '更新日', '描述', '處理紀錄'], ['A機', '待處理', '一般', '', '2026-09-01', '2026-09-02', 'x', '[]'], ['其他', '處理中', '阻塞', '', '', '', '', '[{"date":"2026-09-03","text":"hi"}]']],
  '常用連結': [['名稱', '網址', '說明'], ['Looker', 'https://l', '']],
  '設定': [['階段名稱', '顏色代碼', '類型'], ['版更', '#111111', '里程碑'], ['未開始', '', '']],
  'AB測試': [['遊戲名稱', '遊戲tag', '目標市場', '上線日期', '版本標籤', '版本日期', '是否勝出', '是否在測', '外部連結'], ['G1', 't', 'm', '2026-08-01', 'A', '2026-08-01', '', 'Y', 'http://x'], ['G1', 't', 'm', '2026-08-01', 'B', '2026-08-08', 'Y', '', ''], ['G2', '', '', '', 'A', '2026-08-10', '', '', '']],
};

(async () => {
  const sa = await fakeServiceAccount();
  const fake = makeFakeSheets(initial);
  const sh = new Sheets(sa, 'SHEET', fake.fetch);

  // ---- reads ----
  const all = await readAll(sh, { reqId: true });
  eq('readAll rows', all.data.map((r) => [r.row, r.machine, r.stage, r.planEnd, r.type]), [[2, 'A機', '版更', '2026-09-17', '里程碑'], [3, 'A機', '送審', '2026-09-28', '里程碑'], [4, 'B機', '未開始', '', '工作階段']]);
  eq('readAll statuses', all.statuses, { 'A機': { status: '打磨中', progress: 80, updated: '2026-09-17', launched: '' } });
  eq('readAll stages', all.stages, [{ name: '版更', color: '#111111', type: '里程碑' }, { name: '未開始', color: '#9ca3af', type: '工作階段' }]);
  eq('readAll issues', all.issues.map((i) => [i.title, i.status, i.log.length]), [['A機', '待處理', 0], ['其他', '處理中', 1]]);
  eq('readAll links', all.links, [{ name: 'Looker', url: 'https://l', desc: '' }]);
  eq('readAll missing tabs', [all.abTags, all.abMarkets, all.launchChecklist], [[], [], []]);
  ok('readAll uses one batchGet', fake.calls.filter((c) => c.includes('batchGet')).length === 1, fake.calls);
  const ab = await run(sh, { action: 'readAB' });
  eq('readAB', ab.data.map((r) => [r.row, r.game, r.version, r.winner, r.running, r.link]), [[2, 'G1', 'A', false, true, 'http://x'], [3, 'G1', 'B', true, false, ''], [4, 'G2', 'A', false, false, '']]);

  // ---- main sheet writes ----
  await run(sh, { action: 'addMachine', name: 'C機', owner: '阿花', priority: '' });
  eq('addMachine main row', fake.dump('進行中')[4], ['C機', '未開始', '', '', '', '', '阿花', '', '中', '工作階段']);
  eq('addMachine status row', fake.dump('機台狀態')[2], ['C機']);
  await run(sh, { action: 'addMachine', name: 'C機', owner: '', priority: '低' });
  eq('addMachine again does not duplicate status', fake.dump('機台狀態').length, 3);
  await run(sh, { action: 'addStage', data: { machine: 'C機', stage: '版更', planEnd: '2026-10-08', type: '里程碑' } });
  eq('addStage', fake.dump('進行中')[6], ['C機', '版更', '', '2026-10-08', '', '', '', '', '', '里程碑']);
  await run(sh, { action: 'update', row: 3, data: { machine: 'A機', stage: '送審', planEnd: '2026-10-05', owner: '小明', type: '里程碑' } });
  eq('update row 3', fake.dump('進行中')[2], ['A機', '送審', '', '2026-10-05', '', '', '小明', '', '', '里程碑']);
  await run(sh, { action: 'setPriority', machineName: 'A機', priority: '低' });
  eq('setPriority both rows', fake.dump('進行中').slice(1, 3).map((r) => r[8]), ['低', '低']);
  await run(sh, { action: 'archiveMachine', machineName: 'B機' });
  eq('archiveMachine', fake.dump('進行中')[3][1], '已完成');
  await run(sh, { action: 'delete', row: 4 });
  eq('delete row 4 shifts the rest up', fake.dump('進行中').map((r) => r[0]), ['機台名稱', 'A機', 'A機', 'C機', 'C機', 'C機']);

  // ---- machine status ----
  await run(sh, { action: 'setMachineStatus', machineName: 'A機', status: '全面開放', progress: '100' });
  const msA = fake.dump('機台狀態')[1];
  ok('setMachineStatus updates B:D', msA[1] === '全面開放' && msA[2] === 100 && /^\d{4}-\d{2}-\d{2}$/.test(msA[3]), msA);
  await run(sh, { action: 'setMachineStatus', machineName: '新機', status: '', progress: '' });
  eq('setMachineStatus appends unknown machine', fake.dump('機台狀態')[3].slice(0, 3), ['新機', '', '']);
  await run(sh, { action: 'launchMachine', machineName: 'A機', launchDate: '2026-09-30' });
  eq('launchMachine sets E only', fake.dump('機台狀態')[1].slice(1), ['全面開放', 100, msA[3], '2026-09-30']);

  // ---- list-style tabs ----
  await run(sh, { action: 'setIssues', issues: [{ title: 'N', status: '待處理', severity: '一般', log: [{ date: '2026-09-29', text: 'ok' }] }] });
  eq('setIssues overwrites', fake.dump('議題清單'), [['標題', '狀態', '嚴重度', '負責人', '建立日', '更新日', '描述', '處理紀錄'], ['N', '待處理', '一般', '', '', '', '', '[{"date":"2026-09-29","text":"ok"}]']]);
  await run(sh, { action: 'setLinks', links: [] });
  eq('setLinks empty clears', fake.dump('常用連結'), [['名稱', '網址', '說明']]);
  await run(sh, { action: 'setLaunchChecklist', items: ['a', 'b'] });
  eq('setLaunchChecklist creates tab', fake.dump('上線清單'), [['檢查項目'], ['a'], ['b']]);
  eq('getLaunchChecklist', (await run(sh, { action: 'getLaunchChecklist' })).items, ['a', 'b']);
  await run(sh, { action: 'setStages', stages: [{ name: '版更', color: '#1', type: '里程碑' }, { name: '開發中', color: '#2' }] });
  eq('setStages', fake.dump('設定'), [['階段名稱', '顏色代碼', '類型'], ['版更', '#1', '里程碑'], ['開發中', '#2', '工作階段']]);
  await run(sh, { action: 'setABOptions', options: { tags: ['x', 'y'], markets: ['TW'] } });
  eq('setABOptions', fake.dump('AB選項'), [['Tag選項', '市場選項'], ['x', 'TW'], ['y']]); // trailing blanks are trimmed by the API
  eq('getABOptions', await run(sh, { action: 'getABOptions' }), { success: true, tags: ['x', 'y'], markets: ['TW'] });

  // ---- deleteMachine across tabs ----
  await run(sh, { action: 'setIssues', issues: [{ title: 'C機', status: '待處理' }, { title: 'zzz' }] });
  await run(sh, { action: 'deleteMachine', machineName: 'C機' });
  eq('deleteMachine main', fake.dump('進行中').map((r) => r[0]), ['機台名稱', 'A機', 'A機']);
  eq('deleteMachine status', fake.dump('機台狀態').map((r) => r[0]), ['機台名稱', 'A機', '新機']);
  eq('deleteMachine issues', fake.dump('議題清單').map((r) => r[0]), ['標題', 'zzz']);

  // ---- AB ----
  await run(sh, { action: 'addABGame', data: { game: 'G3', tag: 'p', market: 'TW', launchDate: '2026-10-01', versionDate: '2026-10-01' } });
  eq('addABGame', fake.dump('AB測試')[4], ['G3', 'p', 'TW', '2026-10-01', 'A', '2026-10-01']);
  await run(sh, { action: 'addABVersion', data: { game: 'G3', tag: 'p', market: 'TW', version: 'B', versionDate: '2026-10-08' } });
  eq('addABVersion', fake.dump('AB測試')[5], ['G3', 'p', 'TW', '', 'B', '2026-10-08']);
  await run(sh, { action: 'setABWinner', game: 'G3', version: 'B' });
  eq('setABWinner', fake.dump('AB測試').slice(4).map((r) => r[6] || ''), ['', 'Y']);
  const blocked = await run(sh, { action: 'writeAB', data: [{ gameName: 'only', versions: [] }] });
  ok('writeAB safety refuses shrinking below half', blocked.success === false && /安全防護/.test(blocked.error), blocked);
  await run(sh, { action: 'writeAB', data: [{ gameName: 'G1', gameTag: 't', targetMarket: 'm', launchDate: '2026-08-01', link: 'http://x', versions: [{ label: 'A', date: '2026-08-01', running: true }, { label: 'B', date: '2026-08-08', winner: true }] }, { gameName: 'G2', versions: [] }, { gameName: 'G3', versions: [{ label: 'A', date: '2026-10-01' }] }] });
  eq('writeAB rewrites', fake.dump('AB測試').slice(1), [['G1', 't', 'm', '2026-08-01', 'A', '2026-08-01', '', 'Y', 'http://x'], ['G1', 't', 'm', '2026-08-01', 'B', '2026-08-08', 'Y'], ['G2'], ['G3', '', '', '', 'A', '2026-10-01']]);
  await run(sh, { action: 'deleteABVersion', row: 5 });
  await run(sh, { action: 'deleteABGame', game: 'G1' });
  eq('deleteABVersion + deleteABGame', fake.dump('AB測試').map((r) => r[0]), ['遊戲名稱', 'G2']);
  eq('unknown action', await run(sh, { action: 'nope' }), { success: false, error: 'Unknown action' });

  // ---- worker layer: key, dedup, CORS, GET/POST parsing ----
  const kv = { store: {}, get: async (k) => kv.store[k] || null, put: async (k, v) => { kv.store[k] = v; } };
  const fake2 = makeFakeSheets(initial);
  const realFetch = globalThis.fetch; globalThis.fetch = fake2.fetch;
  const env = { GOOGLE_SA_JSON: JSON.stringify(sa), SHEET_ID: 'SHEET', WRITE_KEY: 'k', DEDUP: kv, ALLOWED_ORIGINS: 'https://chihsiangchan888.github.io' };
  const req = (url, init) => new Request('https://relay.test' + url, init);
  const j = async (r) => JSON.parse(await r.text());
  eq('caps', await j(await handle(req('/?action=caps'), env)), { success: true, caps: { reqId: true, writeKey: true, relay: 'sheets-api' } });
  const ra = await j(await handle(req('/'), env));
  ok('GET / is readAll with caps', ra.success && ra.data.length === 3 && ra.caps.relay === 'sheets-api', ra.caps);
  eq('readAB via ?action', (await j(await handle(req('/?action=readAB'), env))).data.length, 3);
  eq('write without key', await j(await handle(req('/?payload=' + encodeURIComponent(JSON.stringify({ action: 'setLinks', links: [] }))), env)), { success: false, error: 'unauthorized' });
  const w1 = await handle(req('/', { method: 'POST', body: JSON.stringify({ action: 'addStage', key: 'k', reqId: 'r1', data: { machine: 'A機', stage: '體驗會', planEnd: '2026-08-01', type: '里程碑' } }) }), env);
  const w2 = await handle(req('/', { method: 'POST', body: JSON.stringify({ action: 'addStage', key: 'k', reqId: 'r1', data: { machine: 'A機', stage: '體驗會', planEnd: '2026-08-01', type: '里程碑' } }) }), env);
  ok('dedup: same reqId executes once', fake2.dump('進行中').length === 5 && w2.headers.get('X-Relay-Dedup') === 'hit', { rows: fake2.dump('進行中').length, w1: await w1.text(), w2: await w2.text() });
  const c = await handle(req('/', { method: 'OPTIONS', headers: { Origin: 'https://chihsiangchan888.github.io' } }), env);
  eq('CORS preflight', [c.status, c.headers.get('Access-Control-Allow-Origin')], [204, 'https://chihsiangchan888.github.io']);
  const c2 = await handle(req('/?action=caps', { headers: { Origin: 'https://evil.example' } }), env);
  eq('CORS unknown origin gets the first allowed one, not itself', c2.headers.get('Access-Control-Allow-Origin'), 'https://chihsiangchan888.github.io');
  const nocfg = await j(await handle(req('/'), { SHEET_ID: 'x' }));
  ok('unconfigured relay says so', nocfg.success === false && /not configured/.test(nocfg.error));
  globalThis.fetch = realFetch;

  console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
