// Port of apps-script/程式碼.gs on top of the Sheets API. Same actions, same request and
// response shapes, same sheet layouts, so the frontend only has to change its URL.
import { fmtDate, cell, todayTaipei } from './sheets.js';

const MAIN = '進行中', MS = '機台狀態', ISS = '議題清單', LINK = '常用連結', LC = '上線清單', SET = '設定', ABO = 'AB選項', AB = 'AB測試';
const MS_HEADER = ['機台名稱', '目前狀態', '進度', '最後更新日', '上線日期'];
const ISS_HEADER = ['標題', '狀態', '嚴重度', '負責人', '建立日', '更新日', '描述', '處理紀錄'];
const LINK_HEADER = ['名稱', '網址', '說明'];
const AB_HEADER = ['遊戲名稱', '遊戲tag', '目標市場', '上線日期', '版本標籤', '版本日期', '是否勝出', '是否在測', '外部連結'];

export const WRITE_ACTIONS = { addMachine: 1, addStage: 1, update: 1, delete: 1, deleteMachine: 1, setPriority: 1, archiveMachine: 1, setMachineStatus: 1, launchMachine: 1, setLaunchChecklist: 1, setIssues: 1, setLinks: 1, setStages: 1, setABOptions: 1, writeAB: 1, addABGame: 1, addABVersion: 1, setABWinner: 1, deleteABVersion: 1, deleteABGame: 1 };

const stageRow = (d) => [d.machine || '', d.stage || '', d.planStart || '', d.planEnd || '', d.actualStart || '', d.actualEnd || '', d.owner || '', d.note || '', d.priority || '', d.type || '工作階段'];

// ---- parsers shared by readAll and the single reads ----
function parseMain(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    out.push({ row: i + 1, machine: cell(r, 0), stage: cell(r, 1), planStart: fmtDate(cell(r, 2)), planEnd: fmtDate(cell(r, 3)), actualStart: fmtDate(cell(r, 4)), actualEnd: fmtDate(cell(r, 5)), owner: cell(r, 6), note: cell(r, 7), priority: cell(r, 8), type: cell(r, 9) || '工作階段' });
  }
  return out;
}
function parseStages(rows) {
  if (rows === null) return null;
  if (rows.length < 2) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) if (cell(rows[i], 0)) out.push({ name: String(cell(rows[i], 0)), color: String(cell(rows[i], 1) || '#9ca3af'), type: String(cell(rows[i], 2) || '工作階段') });
  return out;
}
function parseABOptions(rows) {
  const tags = [], markets = [];
  if (rows) for (let i = 1; i < rows.length; i++) { if (cell(rows[i], 0)) tags.push(String(cell(rows[i], 0))); if (cell(rows[i], 1)) markets.push(String(cell(rows[i], 1))); }
  return { tags, markets };
}
function parseStatuses(rows) {
  const map = {};
  if (rows) for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!cell(r, 0)) continue;
    const p = cell(r, 2);
    map[String(cell(r, 0))] = { status: String(cell(r, 1) || ''), progress: (p === '' || p == null) ? null : Number(p), updated: fmtDate(cell(r, 3)), launched: fmtDate(cell(r, 4)) };
  }
  return map;
}
function parseChecklist(rows) { const items = []; if (rows) for (let i = 1; i < rows.length; i++) if (cell(rows[i], 0)) items.push(String(cell(rows[i], 0))); return items; }
function parseIssues(rows) {
  const arr = [];
  if (rows) for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!cell(r, 0)) continue;
    let log = []; try { if (cell(r, 7)) log = JSON.parse(cell(r, 7)); } catch (e) { log = []; }
    arr.push({ title: String(cell(r, 0)), status: String(cell(r, 1) || '待處理'), severity: String(cell(r, 2) || '一般'), owner: String(cell(r, 3) || ''), created: fmtDate(cell(r, 4)), updated: fmtDate(cell(r, 5)), desc: String(cell(r, 6) || ''), log });
  }
  return arr;
}
function parseLinks(rows) {
  const arr = [];
  if (rows) for (let i = 1; i < rows.length; i++) { const r = rows[i]; if (!cell(r, 0) && !cell(r, 1)) continue; arr.push({ name: String(cell(r, 0)), url: String(cell(r, 1)), desc: String(cell(r, 2)) }); }
  return arr;
}
function parseAB(rows) {
  const out = [];
  if (rows) for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    out.push({ row: i + 1, game: cell(r, 0), tag: cell(r, 1), market: cell(r, 2), launchDate: fmtDate(cell(r, 3)), version: cell(r, 4), versionDate: fmtDate(cell(r, 5)), winner: cell(r, 6) === 'Y' || cell(r, 6) === true, running: cell(r, 7) === 'Y' || cell(r, 7) === true, link: cell(r, 8) });
  }
  return out;
}

// overwrite rows 2.. of a tab with the given rows (Apps Script clearContent + setValues)
async function overwrite(sh, title, width, rows) {
  const cur = await sh.getValues(title);
  if (cur.length > 1) await sh.clear(title + '!A2:' + String.fromCharCode(64 + width) + cur.length);
  if (rows.length) await sh.update(title + '!A2', rows);
}

export async function readAll(sh, caps) {
  const v = await sh.getMany([MAIN, SET, ABO, MS, LC, ISS, LINK]);
  const abo = parseABOptions(v[ABO]);
  return { success: true, caps, data: parseMain(v[MAIN] || []), stages: parseStages(v[SET]), abTags: abo.tags, abMarkets: abo.markets, statuses: parseStatuses(v[MS]), launchChecklist: parseChecklist(v[LC]), issues: parseIssues(v[ISS]), links: parseLinks(v[LINK]) };
}

export async function run(sh, body) {
  const a = body.action;
  switch (a) {
    case 'addMachine': {
      await sh.appendRow(MAIN, [body.name, '未開始', '', '', '', '', body.owner || '', '', body.priority || '中', '工作階段']);
      await sh.ensureSheet(MS, MS_HEADER);
      const ms = await sh.getValues(MS);
      if (!ms.slice(1).some((r) => cell(r, 0) === body.name)) await sh.appendRow(MS, [body.name, '', '', '', '']);
      return { success: true };
    }
    case 'addStage': await sh.appendRow(MAIN, stageRow(body.data || {})); return { success: true };
    case 'update': { const d = body.data || {}; await sh.update(MAIN + '!A' + body.row + ':J' + body.row, [stageRow(d)]); return { success: true }; }
    case 'delete': await sh.deleteRows({ [MAIN]: [Number(body.row)] }); return { success: true };
    case 'deleteMachine': {
      const v = await sh.getMany([MAIN, MS, ISS]);
      const pick = (rows) => rows ? rows.map((r, i) => (i > 0 && cell(r, 0) === body.machineName ? i + 1 : 0)).filter(Boolean) : [];
      await sh.deleteRows({ [MAIN]: pick(v[MAIN]), [MS]: pick(v[MS]), [ISS]: pick(v[ISS]) });
      return { success: true };
    }
    case 'setPriority': {
      const rows = await sh.getValues(MAIN);
      const items = rows.map((r, i) => (i > 0 && cell(r, 0) === body.machineName ? { range: MAIN + '!I' + (i + 1), values: [[body.priority]] } : null)).filter(Boolean);
      await sh.batchUpdateValues(items); return { success: true };
    }
    case 'archiveMachine': {
      const rows = await sh.getValues(MAIN);
      const items = rows.map((r, i) => (i > 0 && cell(r, 0) === body.machineName ? { range: MAIN + '!B' + (i + 1), values: [['已完成']] } : null)).filter(Boolean);
      await sh.batchUpdateValues(items); return { success: true };
    }
    case 'setMachineStatus': {
      await sh.ensureSheet(MS, MS_HEADER);
      const rows = await sh.getValues(MS), today = todayTaipei();
      const prog = (body.progress === '' || body.progress == null) ? '' : Number(body.progress);
      const i = rows.findIndex((r, k) => k > 0 && cell(r, 0) === body.machineName);
      if (i > 0) await sh.update(MS + '!B' + (i + 1) + ':D' + (i + 1), [[body.status || '', prog, today]]);
      else await sh.appendRow(MS, [body.machineName, body.status || '', prog, today]);
      return { success: true };
    }
    case 'launchMachine': {
      await sh.ensureSheet(MS, MS_HEADER);
      const rows = await sh.getValues(MS), d = body.launchDate || todayTaipei();
      const i = rows.findIndex((r, k) => k > 0 && cell(r, 0) === body.machineName);
      if (i > 0) await sh.update(MS + '!E' + (i + 1), [[d]]);
      else await sh.appendRow(MS, [body.machineName, '', '', '', d]);
      return { success: true };
    }
    case 'getLaunchChecklist': return { success: true, items: parseChecklist(await sh.hasSheet(LC) ? await sh.getValues(LC) : null) };
    case 'setLaunchChecklist': {
      await sh.ensureSheet(LC, ['檢查項目']);
      await overwrite(sh, LC, 1, (body.items || []).map((x) => [x])); return { success: true };
    }
    case 'setIssues': {
      await sh.ensureSheet(ISS, ISS_HEADER);
      await overwrite(sh, ISS, 8, (body.issues || []).map((v) => [v.title || '', v.status || '待處理', v.severity || '一般', v.owner || '', v.created || '', v.updated || '', v.desc || '', JSON.stringify(v.log || [])]));
      return { success: true };
    }
    case 'setLinks': {
      await sh.ensureSheet(LINK, LINK_HEADER);
      await overwrite(sh, LINK, 3, (body.links || []).map((v) => [v.name || '', v.url || '', v.desc || '']));
      return { success: true };
    }
    case 'getStages': return { success: true, stages: parseStages(await sh.hasSheet(SET) ? await sh.getValues(SET) : null) };
    case 'setStages': {
      await sh.ensureSheet(SET, ['階段名稱', '顏色代碼', '類型']);
      await overwrite(sh, SET, 3, (body.stages || []).map((s) => [s.name, s.color, s.type || '工作階段'])); return { success: true };
    }
    case 'getABOptions': { const o = parseABOptions(await sh.hasSheet(ABO) ? await sh.getValues(ABO) : null); return { success: true, tags: o.tags, markets: o.markets }; }
    case 'setABOptions': {
      await sh.ensureSheet(ABO, ['Tag選項', '市場選項']);
      const o = body.options || {}, tags = o.tags || [], markets = o.markets || [];
      const n = Math.max(tags.length, markets.length, 1), rows = [];
      for (let i = 0; i < n; i++) rows.push([tags[i] || '', markets[i] || '']);
      await overwrite(sh, ABO, 2, rows); return { success: true };
    }
    case 'readAB': { await sh.ensureSheet(AB, AB_HEADER); return { success: true, data: parseAB(await sh.getValues(AB)) }; }
    case 'writeAB': {
      await sh.ensureSheet(AB, AB_HEADER);
      const cur = await sh.getValues(AB);
      const existing = Math.max(cur.length - 1, 0);
      let newRows = 0; (body.data || []).forEach((g) => { const vs = g.versions || []; newRows += vs.length > 0 ? vs.length : 1; });
      if (existing > 4 && newRows < existing * 0.5) return { success: false, error: '安全防護：新資料筆數(' + newRows + ')不到現有(' + existing + ')的一半，拒絕覆寫。請使用單筆操作 API。' };
      const rows = [];
      (body.data || []).forEach((g) => {
        const vs = g.versions || [];
        if (!vs.length) rows.push([g.gameName || '', g.gameTag || '', g.targetMarket || '', g.launchDate || '', '', '', '', '', g.link || '']);
        else vs.forEach((v, i) => rows.push([g.gameName || '', g.gameTag || '', g.targetMarket || '', g.launchDate || '', v.label || '', v.date || '', v.winner ? 'Y' : '', v.running ? 'Y' : '', i === 0 ? (g.link || '') : '']));
      });
      if (cur.length > 1) await sh.clear(AB + '!A2:I' + cur.length);
      if (rows.length) await sh.update(AB + '!A2', rows);
      return { success: true };
    }
    case 'addABGame': { await sh.ensureSheet(AB, AB_HEADER); const d = body.data || {}; await sh.appendRow(AB, [d.game || '', d.tag || '', d.market || '', d.launchDate || '', 'A', d.versionDate || '', '']); return { success: true }; }
    case 'addABVersion': { await sh.ensureSheet(AB, AB_HEADER); const d = body.data || {}; await sh.appendRow(AB, [d.game || '', d.tag || '', d.market || '', '', d.version || '', d.versionDate || '', '']); return { success: true }; }
    case 'setABWinner': {
      const rows = await sh.getValues(AB);
      const items = rows.map((r, i) => (i > 0 && cell(r, 0) === body.game ? { range: AB + '!G' + (i + 1), values: [[cell(r, 4) === body.version ? 'Y' : '']] } : null)).filter(Boolean);
      await sh.batchUpdateValues(items); return { success: true };
    }
    case 'deleteABVersion': await sh.deleteRows({ [AB]: [Number(body.row)] }); return { success: true };
    case 'deleteABGame': {
      const rows = await sh.getValues(AB);
      await sh.deleteRows({ [AB]: rows.map((r, i) => (i > 0 && cell(r, 0) === body.game ? i + 1 : 0)).filter(Boolean) });
      return { success: true };
    }
    default: return { success: false, error: 'Unknown action' };
  }
}
