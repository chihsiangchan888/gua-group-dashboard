/**
 * 機率部門專案時程管理 — Google Apps Script Web App
 * 
 * 部署步驟：
 * 1. 在 Google Sheet 中：擴充功能 → Apps Script
 * 2. 將此檔案內容貼入 Code.gs（覆蓋原有內容）
 * 3. 部署 → 新增部署 → 類型選「網頁應用程式」
 * 4. 執行身分：自己（呱老大的帳號）
 * 5. 存取權限：任何人
 * 6. 部署後複製 Web App URL，貼入 project-timeline.html 的 CONFIG.APPS_SCRIPT_URL
 */

const SHEET_ID = '10_RMNf8IluvwZyPUUGrLDupcK09aaXGTVqJxEkXLSt8';
const SHEET_ACTIVE = '進行中';
const SHEET_DONE = '已完成';
const HEADERS = ['機台名稱','負責人','目前階段','預計開始日','預計結束日','實際開始日','實際結束日','備註'];

function getSheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'read';
  if (action === 'read') return jsonResponse(readAll());
  return jsonResponse({ error: 'Unknown action' });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const action = body.action;

  if (action === 'add') return jsonResponse(addRow(body.data));
  if (action === 'update') return jsonResponse(updateRow(body.sheet, body.row, body.data));
  if (action === 'delete') return jsonResponse(deleteRow(body.sheet, body.row));
  if (action === 'move') return jsonResponse(moveRow(body.fromSheet, body.row, body.toSheet));

  return jsonResponse({ error: 'Unknown action' });
}

function readAll() {
  const active = readSheet(SHEET_ACTIVE);
  const done = readSheet(SHEET_DONE);
  return { success: true, data: { active, done } };
}

function readSheet(name) {
  const sheet = getSheet(name);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    rows.push({
      row: i + 1, // 1-indexed row number in sheet
      name: data[i][0] || '',
      owner: data[i][1] || '',
      stage: data[i][2] || '',
      planStart: formatDate(data[i][3]),
      planEnd: formatDate(data[i][4]),
      actualStart: formatDate(data[i][5]),
      actualEnd: formatDate(data[i][6]),
      note: data[i][7] || ''
    });
  }
  return rows;
}

function addRow(data) {
  const sheet = getSheet(SHEET_ACTIVE);
  sheet.appendRow([
    data.name || '',
    data.owner || '',
    data.stage || '未開始',
    data.planStart || '',
    data.planEnd || '',
    data.actualStart || '',
    data.actualEnd || '',
    data.note || ''
  ]);
  return { success: true };
}

function updateRow(sheetName, rowNum, data) {
  const sheet = getSheet(sheetName);
  if (!sheet) return { success: false, error: 'Sheet not found' };
  const values = [
    data.name || '',
    data.owner || '',
    data.stage || '',
    data.planStart || '',
    data.planEnd || '',
    data.actualStart || '',
    data.actualEnd || '',
    data.note || ''
  ];
  sheet.getRange(rowNum, 1, 1, 8).setValues([values]);
  return { success: true };
}

function deleteRow(sheetName, rowNum) {
  const sheet = getSheet(sheetName);
  if (!sheet) return { success: false, error: 'Sheet not found' };
  sheet.deleteRow(rowNum);
  return { success: true };
}

function moveRow(fromSheetName, rowNum, toSheetName) {
  const fromSheet = getSheet(fromSheetName);
  const toSheet = getSheet(toSheetName);
  if (!fromSheet || !toSheet) return { success: false, error: 'Sheet not found' };
  const values = fromSheet.getRange(rowNum, 1, 1, 8).getValues()[0];
  toSheet.appendRow(values);
  fromSheet.deleteRow(rowNum);
  return { success: true };
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
