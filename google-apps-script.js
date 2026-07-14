const SHEET_NAME = 'STATE';
const TOKEN_PROPERTY = 'SYNC_TOKEN';

function setup() {
  const token = 'doi-token-nay';
  PropertiesService.getScriptProperties().setProperty(TOKEN_PROPERTY, token);
  getStateSheet_();
}

function doGet(e) {
  const action = e.parameter.action || 'load';
  const callback = e.parameter.callback || 'callback';
  try {
    checkToken_(e.parameter.token || '');
    if (action === 'ping') return jsonp_(callback, { ok: true, updatedAt: getUpdatedAt_() });
    if (action !== 'load') throw new Error('Action khong hop le');
    return jsonp_(callback, {
      ok: true,
      data: readState_(),
      updatedAt: getUpdatedAt_()
    });
  } catch (err) {
    return jsonp_(callback, { ok: false, error: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}');
    checkToken_(body.token || '');
    if (body.action !== 'save') throw new Error('Action khong hop le');
    writeState_(body.data || {});
    return json_({ ok: true, updatedAt: getUpdatedAt_() });
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err) });
  }
}

function checkToken_(token) {
  const saved = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
  if (!saved) throw new Error('Chua chay setup() de tao token');
  if (token !== saved) throw new Error('Sai token');
}

function getStateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  sheet.getRange('A1').setValue('json');
  sheet.getRange('B1').setValue('updatedAt');
  return sheet;
}

function readState_() {
  const raw = getStateSheet_().getRange('A2').getValue();
  return raw ? JSON.parse(raw) : { members: [], results: [], entries: [] };
}

function writeState_(data) {
  const sheet = getStateSheet_();
  sheet.getRange('A2').setValue(JSON.stringify(data));
  sheet.getRange('B2').setValue(new Date().toISOString());
}

function getUpdatedAt_() {
  const value = getStateSheet_().getRange('B2').getValue();
  return value ? String(value) : '';
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonp_(callback, obj) {
  const safeCallback = String(callback).replace(/[^\w$.]/g, '');
  return ContentService
    .createTextOutput(`${safeCallback}(${JSON.stringify(obj)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
