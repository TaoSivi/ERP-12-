/* ============================================================
   LaoBooks ERP – Google Apps Script backend
   ------------------------------------------------------------
   ໃຊ້ Google Sheet ເປັນຖານຂໍ້ມູນ. ແຕ່ລະ tab = ໜຶ່ງຕາຕະລາງ.
   ຕິດຕັ້ງ: ເບິ່ງ README.md (ສ້າງ Sheet → Extensions → Apps Script →
   ວາງ code ນີ້ → Deploy → Web app → Anyone).
   ============================================================ */

var COLLECTIONS = [
  "settings","accounts","taxcodes","customers","vendors","items",
  "invoices","invoice_lines","bills","bill_lines",
  "journal_entries","journal_lines","payments","bank_accounts","stock_moves",
  "quotes","quote_lines","purchase_orders","po_lines",
  "credit_notes","cn_lines","debit_notes","dn_lines","prepaids","deferreds","fx_rates",
  "cost_centres","projects",
  "purchase_requisitions","pr_lines","recurring","bank_statements","locations","stock_serials","stock_transfers","leaves",
  "companies","salary_revisions",
  "sales_orders","so_lines","deliveries","delivery_lines","users","holidays",
  "boms","bom_lines",
  "employees","payroll","assets","budgets","audit_log",
  "documents","doc_folders","announcements","announcement_acks","workflows","doc_templates","departments"
];

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    else if (e && e.parameter && e.parameter.action) body = { action: e.parameter.action, payload: e.parameter.payload ? JSON.parse(e.parameter.payload) : {} };
    var action = body.action, p = body.payload || {};
    var data;
    switch (action) {
      case "ping":    data = { ok: true, time: new Date().toISOString() }; break;
      case "loadAll": data = loadAll(); break;
      case "append":  data = appendRow(p.sheet, p.row); break;
      case "update":  data = updateRow(p.sheet, p.id, p.row); break;
      case "remove":  data = removeRow(p.sheet, p.id); break;
      case "uploadFile": data = uploadFile(p.name, p.mime, p.b64); break;
      default: throw new Error("ບໍ່ຮູ້ຈັກ action: " + action);
    }
    return json({ ok: true, data: data });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

/* ອັບໂຫລດໄຟລ໌ເອກະສານຂຶ້ນ Google Drive (folder "LaoBooks Docs") → ຄືນ URL */
function uploadFile(name, mime, b64) {
  if (!name || !b64) throw new Error("ຂໍ້ມູນໄຟລ໌ບໍ່ຄົບ");
  var folders = DriveApp.getFoldersByName("LaoBooks Docs");
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("LaoBooks Docs");
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime || "application/octet-stream", name);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: file.getUrl(), download: "https://drive.google.com/uc?export=download&id=" + file.getId(), id: file.getId() };
}

function getSheet(name) {
  var s = ss().getSheetByName(name);
  if (!s) { s = ss().insertSheet(name); s.appendRow(["id"]); }
  if (s.getLastRow() === 0) s.appendRow(["id"]);
  return s;
}

function headers(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function ensureColumns(sheet, keys) {
  var hs = headers(sheet);
  var added = false;
  keys.forEach(function (k) {
    if (hs.indexOf(k) === -1) { hs.push(k); added = true; }
  });
  if (added) sheet.getRange(1, 1, 1, hs.length).setValues([hs]);
  return hs;
}

function loadAll() {
  var out = {};
  COLLECTIONS.forEach(function (name) {
    var s = ss().getSheetByName(name);
    out[name] = [];
    if (!s || s.getLastRow() < 2) return;
    var values = s.getDataRange().getValues();
    var hs = values[0];
    for (var r = 1; r < values.length; r++) {
      var obj = {}, empty = true;
      for (var c = 0; c < hs.length; c++) {
        var key = hs[c]; if (!key) continue;
        var v = values[r][c];
        if (v !== "" && v !== null) empty = false;
        obj[key] = v;
      }
      if (!empty && obj.id) out[name].push(obj);
    }
  });
  return out;
}

function appendRow(name, row) {
  var s = getSheet(name);
  var hs = ensureColumns(s, Object.keys(row));
  var line = hs.map(function (k) { return row[k] === undefined ? "" : row[k]; });
  s.appendRow(line);
  return { id: row.id };
}

function findRowIndex(sheet, id) {
  var ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var i = 1; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 1;
  return -1;
}

function updateRow(name, id, row) {
  var s = getSheet(name);
  var idx = findRowIndex(s, id);
  if (idx === -1) return appendRow(name, row);
  var hs = ensureColumns(s, Object.keys(row));
  var line = hs.map(function (k) { return row[k] === undefined ? "" : row[k]; });
  s.getRange(idx, 1, 1, hs.length).setValues([line]);
  return { id: id };
}

function removeRow(name, id) {
  var s = getSheet(name);
  var idx = findRowIndex(s, id);
  if (idx !== -1) s.deleteRow(idx);
  return { id: id };
}

/* Run once from the editor (optional) to pre-create all tabs */
function setupTabs() {
  COLLECTIONS.forEach(function (n) { getSheet(n); });
}
