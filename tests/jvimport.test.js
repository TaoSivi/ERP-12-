const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

// a sheet row: [seq, date, voucher, ref, Dr, Cr, memo, original value, rate, Dr amount, Cr amount]
const row = (no, date, dr, cr, amt, extra = {}) => [1, date, no, "B1", dr, cr, extra.memo || "ຄ່າໃຊ້ຈ່າຍ", extra.orig || amt + ".00 ກີບ", extra.rate || 1, amt, amt];

test("parse groups rows by voucher+date, keeps number and flags a foreign-currency line", async () => {
  const c = await freshApp();
  const p = c.JVImport.parse([
    ["header"], row("PV-1", "02/01/2026", "6140", "1021.1", 400000), row("PV-1", "02/01/2026", "6390", "1021.1", 100000),
    ["ລວມຍອດ 02/01/2026", null, null, null, null, null, null, null, null, 500000, 500000],
    row("BL-9", "03/01/2026", "627.0001", "1022.2", 30850.92, { orig: "$1.42", rate: 21726 })]);
  assert.equal(p.vouchers.length, 2);
  assert.equal(p.vouchers[0].no, "PV-1");
  assert.equal(p.vouchers[0].lines.length, 2);
  assert.equal(p.vouchers[0].total, 500000);
  assert.match(p.vouchers[1].lines[0].fx, /21726/);
  assert.equal(p.errors.length, 0);
});

test("run posts balanced entries with new accounts, keeps voucher numbers, and a second run adds nothing", async () => {
  const c = await freshApp();
  const p = c.JVImport.parse([row("PV-1", "02/01/2026", "1332.65.72.0011", "1021.1", 400000), row("PV-1", "02/01/2026", "639.1", "1021.1", 100000), row("RV-2", "05/01/2026", "1021.1", "431.0068", 900)]);
  const before = c.Store.all("journal_entries").length;
  const r = c.JVImport.run(p);
  assert.equal(r.entries, 2);
  assert.equal(r.accounts, 4); // 1332.65.72.0011, 1021.1, 639.1, 431.0068 are not in the default chart
  const je = c.Store.where("journal_entries", j => j.number === "PV-1")[0];
  assert.equal(je.total_debit, 500000);
  const lines = c.Store.where("journal_lines", l => l.je_id === je.id);
  assert.equal(lines.reduce((s, l) => s + l.debit, 0), lines.reduce((s, l) => s + l.credit, 0));
  assert.equal(c.Store.all("journal_entries").length, before + 2);
  assert.equal(c.Store.where("accounts", a => a.code === "431.0068")[0].type, "Revenue");
  assert.equal(c.Store.where("accounts", a => a.code === "1332.65.72.0011")[0].type, "Asset");
  assert.equal(c.JVImport.run(p).entries, 0);
  assert.equal(c.Store.all("journal_entries").length, before + 2);
});

test("batch rolls back everything when a write throws", async () => {
  const c = await freshApp();
  const n = c.Store.all("accounts").length;
  assert.throws(() => c.Store.batch(["accounts"], () => { c.Store.insert("accounts", { id: "x", code: "9999", name: "x", type: "Asset" }); throw new Error("boom"); }), /boom/);
  assert.equal(c.Store.all("accounts").length, n);
});

test("each company slot has its own database key", async () => {
  const a = await freshApp({ mem: {} }), b = await freshApp({ mem: { laobooks_db_slot: "c2" } });
  assert.equal(a.Store.slot, "");
  assert.equal(b.Store.slot, "c2");
  b.Store.insert("customers", { id: "k1", name: "only in c2" });
  assert.equal(b.Store.all("customers").length, 1); // slot databases do not get the demo customers
  assert.equal(a.Store.all("customers").some(x => x.name === "only in c2"), false);
});
