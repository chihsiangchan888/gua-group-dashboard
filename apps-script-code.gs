/**
 * 機率部門專案時程管理 — Google Apps Script Web App
 * 資料結構：一機台多階段（每列 = 一個階段）
 *
 * 部署步驟：
 * 1. Google Sheet → 擴充功能 → Apps Script
 * 2. 貼入此檔案內容至 Code.gs
 * 3. 部署 → 新增部署 → 網頁應用程式
 * 4. 執行身分：自己 / 存取權限：任何人
 * 5. 複製 Web App URL 貼入 HTML CONFIG.APPS_SCRIPT_URL
 *
 * 工作表欄位（第一列為標題）：
 * A:機台名稱 | B:階段名稱 | C:計畫開始日 | D:計畫結束日 | E:實際開始日 | F:實際結束日 | G:負責人 | H:備註
 */

const SHEET_ID = '10_RMNf8IluvwZyPUUGrLDupcK09aaXGTVqJxEkXLSt8';
const SHEET_NAME = '進行中';

function getSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.payload) {
    var body = JSON.parse(e.parameter.payload);
    return processAction(body);
  }
  return jsonResponse(readAll());
}

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  return processAction(body);
}

function processAction(body) {
  var action = body.action;
  if (action === 'addMachine') return jsonResponse(addMachine(body.name, body.owner));
  if (action === 'addStage') return jsonResponse(addStage(body.data));
  if (action === 'update') return jsonResponse(updateRow(body.row, body.data));
  if (action === 'delete') return jsonResponse(deleteRow(body.row));
  if (action === 'deleteMachine') return jsonResponse(deleteMachine(body.machineName));
  if (action === 'getStages') return jsonResponse(getStages());
  if (action === 'setStages') return jsonResponse(setStages(body.stages));
  return jsonResponse({ success: false, error: 'Unknown action' });
}

function readAll() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  var rows = [];
  if (data.length >= 2) {
    for (let i = 1; i < data.length; i++) {
      rows.push({
        row: i + 1,
        machine: data[i][0] || '',
        stage: data[i][1] || '',
        planStart: fmtDate(data[i][2]),
        planEnd: fmtDate(data[i][3]),
        actualStart: fmtDate(data[i][4]),
        actualEnd: fmtDate(data[i][5]),
        owner: data[i][6] || '',
        note: data[i][7] || ''
      });
    }
  }
  var stagesResult = getStages();
  return { success: true, data: rows, stages: stagesResult.stages };
}

function addMachine(name, owner) {
  const sheet = getSheet();
  sheet.appendRow([name, '未開始', '', '', '', '', owner, '']);
  return { success: true };
}

function addStage(data) {
  const sheet = getSheet();
  sheet.appendRow([
    data.machine || '',
    data.stage || '',
    data.planStart || '',
    data.planEnd || '',
    data.actualStart || '',
    data.actualEnd || '',
    data.owner || '',
    data.note || ''
  ]);
  return { success: true };
}

function updateRow(rowNum, data) {
  const sheet = getSheet();
  sheet.getRange(rowNum, 1, 1, 8).setValues([[
    data.machine || '',
    data.stage || '',
    data.planStart || '',
    data.planEnd || '',
    data.actualStart || '',
    data.actualEnd || '',
    data.owner || '',
    data.note || ''
  ]]);
  return { success: true };
}

function deleteRow(rowNum) {
  getSheet().deleteRow(rowNum);
  return { success: true };
}

function deleteMachine(machineName) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  // Delete from bottom to top to preserve row indices
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === machineName) sheet.deleteRow(i + 1);
  }
  return { success: true };
}

function getStages() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('設定');
  if (!sheet) return { success: true, stages: null };
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: true, stages: [] };
  var stages = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) stages.push({ name: String(data[i][0]), color: String(data[i][1] || '#9ca3af') });
  }
  return { success: true, stages: stages };
}

function setStages(stages) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('設定');
  if (!sheet) {
    sheet = ss.insertSheet('設定');
    sheet.getRange(1, 1, 1, 2).setValues([['階段名稱', '顏色代碼']]);
  }
  // Clear existing data (keep header)
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clearContent();
  if (stages.length > 0) {
    var values = stages.map(function(s) { return [s.name, s.color]; });
    sheet.getRange(2, 1, values.length, 2).setValues(values);
  }
  return { success: true };
}

function fmtDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  return String(val);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
