/**
 * 機率部門專案時程管理 — Google Apps Script Web App
 * 
 * 工作表「進行中」欄位（第一列為標題）：
 * A:機台名稱 | B:階段名稱 | C:計畫開始日 | D:計畫結束日 | E:實際開始日 | F:實際結束日 | G:負責人 | H:備註 | I:優先級 | J:類型
 *
 * 類型值：里程碑 / 工作階段
 * 工作表「設定」欄位：A:階段名稱 | B:顏色代碼
 *
 * 部署：擴充功能→Apps Script→貼入→部署→網頁應用程式→執行:自己/存取:任何人
 */

const SHEET_ID = '10_RMNf8IluvwZyPUUGrLDupcK09aaXGTVqJxEkXLSt8';
const SHEET_NAME = '進行中';

function getSheet() { return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME); }

function doGet(e) {
  if (e && e.parameter && e.parameter.payload) return processAction(JSON.parse(e.parameter.payload));
  return jsonResponse(readAll());
}
function doPost(e) { return processAction(JSON.parse(e.postData.contents)); }

function processAction(body) {
  var a = body.action;
  if (a === 'addMachine') return jsonResponse(addMachine(body.name, body.owner, body.priority));
  if (a === 'addStage') return jsonResponse(addStage(body.data));
  if (a === 'update') return jsonResponse(updateRow(body.row, body.data));
  if (a === 'delete') return jsonResponse(deleteRow(body.row));
  if (a === 'deleteMachine') return jsonResponse(deleteMachine(body.machineName));
  if (a === 'setPriority') return jsonResponse(setPriority(body.machineName, body.priority));
  if (a === 'archiveMachine') return jsonResponse(archiveMachine(body.machineName));
  if (a === 'getStages') return jsonResponse(getStages());
  if (a === 'setStages') return jsonResponse(setStages(body.stages));
  return jsonResponse({ success: false, error: 'Unknown action' });
}

function readAll() {
  var sheet = getSheet();
  var data = sheet.getDataRange().getValues();
  var rows = [];
  if (data.length >= 2) {
    for (var i = 1; i < data.length; i++) {
      rows.push({ row: i+1, machine: data[i][0]||'', stage: data[i][1]||'', planStart: fmtDate(data[i][2]), planEnd: fmtDate(data[i][3]), actualStart: fmtDate(data[i][4]), actualEnd: fmtDate(data[i][5]), owner: data[i][6]||'', note: data[i][7]||'', priority: data[i][8]||'', type: data[i][9]||'工作階段' });
    }
  }
  var stagesResult = getStages();
  return { success: true, data: rows, stages: stagesResult.stages };
}

function addMachine(name, owner, priority) {
  getSheet().appendRow([name, '未開始', '', '', '', '', owner, '', priority||'中', '工作階段']);
  return { success: true };
}

function addStage(data) {
  getSheet().appendRow([data.machine||'', data.stage||'', data.planStart||'', data.planEnd||'', data.actualStart||'', data.actualEnd||'', data.owner||'', data.note||'', data.priority||'', data.type||'工作階段']);
  return { success: true };
}

function updateRow(rowNum, data) {
  getSheet().getRange(rowNum, 1, 1, 10).setValues([[data.machine||'', data.stage||'', data.planStart||'', data.planEnd||'', data.actualStart||'', data.actualEnd||'', data.owner||'', data.note||'', data.priority||'', data.type||'工作階段']]);
  return { success: true };
}

function deleteRow(rowNum) { getSheet().deleteRow(rowNum); return { success: true }; }

function deleteMachine(machineName) {
  var sheet = getSheet(); var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) { if (data[i][0] === machineName) sheet.deleteRow(i + 1); }
  return { success: true };
}

function setPriority(machineName, priority) {
  var sheet = getSheet(); var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { if (data[i][0] === machineName) sheet.getRange(i+1, 9).setValue(priority); }
  return { success: true };
}

function archiveMachine(machineName) {
  var sheet = getSheet(); var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { if (data[i][0] === machineName) sheet.getRange(i+1, 2).setValue('已完成'); }
  return { success: true };
}

function getStages() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('設定');
  if (!sheet) return { success: true, stages: null };
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: true, stages: [] };
  var stages = [];
  for (var i = 1; i < data.length; i++) { if (data[i][0]) stages.push({ name: String(data[i][0]), color: String(data[i][1]||'#9ca3af'), type: String(data[i][2]||'工作階段') }); }
  return { success: true, stages: stages };
}

function setStages(stages) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('設定');
  if (!sheet) { sheet = ss.insertSheet('設定'); sheet.getRange(1,1,1,3).setValues([['階段名稱','顏色代碼','類型']]); }
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow()-1, 3).clearContent();
  if (stages.length > 0) { sheet.getRange(2, 1, stages.length, 3).setValues(stages.map(function(s){return [s.name, s.color, s.type||'工作階段']})); }
  return { success: true };
}

function fmtDate(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy-MM-dd');
  return String(val);
}

function jsonResponse(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
