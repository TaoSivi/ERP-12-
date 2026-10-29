const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");
const stockItem = c => c.Store.where("items", i => i.type === "stock")[0];

test("goods issue: draft → submit → approver signs → stock leaves and expense is booked; requester cannot approve", async () => {
  const c = await freshApp(), it = stockItem(c), q0 = c.Acc.stockQty(it.id);
  const d = c.StockDoc.create("ISS", { date: "2026-10-05", dept: "ເຮືອນຄົວ", reason: "ໃຊ້ໃນຄົວ", lines: [{ item_id: it.id, qty: 10 }] }, "Warehouse");
  assert.equal(d.status, "draft"); assert.match(d.number, /^ISS-2026-/);
  const s = c.StockDoc.submit(d.id, "Warehouse"); assert.equal(s.status, "approval"); assert.equal(s.value, 220000);
  assert.throws(() => c.StockDoc.approve(d.id, "Warehouse"), /ອະນຸມັດເອງບໍ່ໄດ້|ລໍ/);
  const p = c.StockDoc.approve(d.id, "Manager"); assert.equal(p.status, "posted");
  assert.equal(c.Acc.stockQty(it.id), q0 - 10); assert.equal(c.Acc.accountBalance("5200"), 220000); assert.equal(c.Acc.accountBalance("1300"), 2200000 - 220000);
  assert.throws(() => c.StockDoc.approve(d.id, "Manager"), /ບໍ່ຢູ່ຂັ້ນ/);
});

test("goods issue cannot take more than the stock; nothing posts for a rejected document", async () => {
  const c = await freshApp(), it = stockItem(c);
  const d = c.StockDoc.create("ISS", { dept: "x", reason: "y", lines: [{ item_id: it.id, qty: 100000 }] }, "Warehouse");
  assert.throws(() => c.StockDoc.submit(d.id, "Warehouse"), /ສະຕັອກບໍ່ພໍ/);
  const e = c.StockDoc.create("ADJ", { reason: "ເສຍ", lines: [{ item_id: it.id, delta: -2 }] }, "Warehouse"); c.StockDoc.submit(e.id, "Warehouse");
  assert.throws(() => c.StockDoc.reject(e.id, "Manager", ""), /ເຫດຜົນ/);
  assert.equal(c.StockDoc.reject(e.id, "Manager", "ບໍ່ຖືກ").status, "rejected"); assert.equal(c.Acc.stockQty(it.id), 100);
});

test("count sheet: the difference between counted and system is booked as loss/gain on approval", async () => {
  const c = await freshApp(), it = stockItem(c);
  const d = c.StockDoc.create("CNT", { reason: "ນັບທ້າຍເດືອນ", lines: [{ item_id: it.id, counted: 97 }] }, "Warehouse");
  assert.equal(d.lines[0].system, 100);
  c.StockDoc.submit(d.id, "Warehouse"); c.StockDoc.approve(d.id, "Manager");
  assert.equal(c.Acc.stockQty(it.id), 97); assert.equal(c.Acc.accountBalance("5200"), 66000, "3 × 22,000 loss to general expense");
});

test("dry run: a preview shows the journal it would create and leaves the real data untouched", async () => {
  const c = await freshApp(), n = c.Store.all("journal_entries").length;
  const r = c.PostMon.simulate(() => c.Acc.postJournal({ date: "2026-10-05", source_type: "T", memo: "x", lines: [{ account: "1100", debit: 5, credit: 0 }, { account: "3100", debit: 0, credit: 5 }] }));
  assert.ok(r.ok); assert.equal(r.entries.length, 1); assert.equal(r.entries[0].lines.length, 2);
  assert.equal(c.Store.all("journal_entries").length, n, "nothing was kept");
  const bad = c.PostMon.simulate(() => c.Acc.postJournal({ date: "2026-10-05", source_type: "T", memo: "x", lines: [{ account: "1100", debit: 5, credit: 0 }] }));
  assert.equal(bad.ok, false); assert.match(bad.error, /ບໍ່ສົມດຸນ/); assert.equal(c.PostMon.errors().length, 0, "a simulated failure is not an error-queue entry");
});

test("a real failed post lands in the error queue and still throws", async () => {
  const c = await freshApp();
  assert.throws(() => c.Acc.postJournal({ date: "2026-10-05", source_type: "T", memo: "x", lines: [{ account: "1100", debit: 5, credit: 0 }] }), /ບໍ່ສົມດຸນ/);
  assert.equal(c.PostMon.errors().length, 1); assert.equal(c.PostMon.errors()[0].fn, "postJournal");
});
