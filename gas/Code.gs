/* LaoBooks ERP – mailbox for other apps (Google Apps Script web app).
   Other apps POST transactions here with a token; the ERP (in the browser) pulls them and posts them.
   Setup: Project Settings → Script properties → add
     INGEST_TOKEN = <token generated in ERP › ຕັ້ງຄ່າ › API>   (apps that SEND use this)
     READ_TOKEN   = <the second token from the same screen>    (only the ERP uses this)
   Deploy → New deployment → Web app → Execute as: Me, Access: Anyone. Paste the /exec URL into the ERP.
   Requests are POST text/plain JSON:  {action:"ingest", token, records:[{id,source,type,date,...}]}
                                       {action:"pull", token}  {action:"ack", token, ids:[...]}          */
var SHEET = "ext_inbox", HEAD = ["key", "source", "json", "received_at", "status"];
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(HEAD); }
  return sh;
}
function same_(a, b) { // constant-time compare
  a = String(a || ""); b = String(b || ""); if (!b || a.length !== b.length) return false;
  var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return out_({ ok: true, service: "laobooks-ext-inbox" }); }
function doPost(e) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var req = JSON.parse(e.postData.contents), p = PropertiesService.getScriptProperties(), sh = sheet_();
    var rows = sh.getDataRange().getValues();
    if (req.action === "ingest") {
      if (!same_(req.token, p.getProperty("INGEST_TOKEN"))) return out_({ ok: false, error: "token" });
      var recs = req.records || []; if (!Array.isArray(recs) || !recs.length || recs.length > 200) return out_({ ok: false, error: "records: 1-200" });
      var have = {}; rows.forEach(function (r) { have[r[0]] = 1; }); var added = 0, dup = 0;
      recs.forEach(function (r) {
        if (!r || !r.id || !r.source) return;
        var key = r.source + ":" + r.id; if (have[key]) { dup++; return; } have[key] = 1;
        sh.appendRow([key, String(r.source), JSON.stringify(r), new Date().toISOString(), "new"]); added++;
      });
      return out_({ ok: true, added: added, duplicate: dup });
    }
    if (!same_(req.token, p.getProperty("READ_TOKEN"))) return out_({ ok: false, error: "token" });
    if (req.action === "pull") return out_({ ok: true, records: rows.slice(1).filter(function (r) { return r[4] === "new"; }).slice(0, 200).map(function (r) { return JSON.parse(r[2]); }) });
    if (req.action === "ack") {
      var ids = {}; (req.ids || []).forEach(function (k) { ids[k] = 1; });
      for (var i = 1; i < rows.length; i++) if (ids[rows[i][0]]) sh.getRange(i + 1, 5).setValue("done");
      return out_({ ok: true });
    }
    return out_({ ok: false, error: "action" });
  } catch (err) { return out_({ ok: false, error: String(err) }); } finally { lock.releaseLock(); }
}
