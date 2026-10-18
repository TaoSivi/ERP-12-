const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

const mkItem = c => c.Store.insert("items", { sku: "T1", name: "ວັດຖຸດິບ", type: "stock", uom: "kg", sell_price: 0, buy_price: 0, income_account: "4100", inventory_account: "1300", cogs_account: "5100", tax_code: "tax_in10", qty: 0, avg_cost: 0, status: "active" });

test("FIFO keeps move order past 9 and 99 moves (seq is numeric, not text)", async () => {
  const c = await freshApp();
  const it = mkItem(c);
  // reference model: plain array FIFO, same events
  const model = []; let n = 0;
  const inn = (q, cost) => { c.Acc.recordMove(it.id, "in", q, cost, "T", "", "2026-10-18"); model.push({ q, cost }); n++; };
  const out = q => { c.Acc.recordMove(it.id, "out", q, 0, "T", "", "2026-10-18"); let need = q; while (need > 1e-9 && model.length) { const t = Math.min(need, model[0].q); model[0].q -= t; need -= t; if (model[0].q <= 1e-9) model.shift(); } n++; };
  for (let i = 1; i <= 40; i++) { inn(10, 100 + i); if (i % 2 === 0) out(7); } // 60 moves on one day, crossing seq 9 and 99 digit boundaries
  const lots = Array.from(c.Acc.lotsFor(it.id));
  assert.equal(lots.length, model.length);
  lots.forEach((l, i) => { assert.equal(l.cost, model[i].cost); assert.ok(Math.abs(l.qty - model[i].q) < 1e-9); });
  assert.ok(n > 9);
});

test("moves keep the document date for reporting", async () => {
  const c = await freshApp();
  const it = mkItem(c);
  c.Acc.recordMove(it.id, "in", 10, 200, "T", "", "2026-10-20");
  assert.equal(c.Store.where("stock_moves", m => m.item_id === it.id)[0].date, "2026-10-20");
});

test("stock adjustment: usage goes to COGS, loss/count difference to general expense", async () => {
  const c = await freshApp();
  const it = mkItem(c);
  c.Acc.recordMove(it.id, "in", 100, 1000, "T", "", "2026-10-01"); c.Store.update("items", it.id, { avg_cost: 1000, qty: 100 });
  c.Acc.postJournal({ date: "2026-10-01", source_type: "T", memo: "ຍອດຍົກມາ", lines: [{ account: "1300", debit: 100000, credit: 0 }, { account: "3100", debit: 0, credit: 100000 }] });
  const base1300 = c.Acc.accountBalance("1300"), baseStock = c.Acc.stockValue(it.id) - 100000; // demo seed already holds some stock
  c.Acc.stockAdjust({ item_id: it.id, qtyDelta: -30, reason: "ໃຊ້ປຸງ", date: "2026-10-31", kind: "usage" });
  assert.equal(c.Acc.accountBalance("5100"), 30000);
  assert.equal(c.Acc.accountBalance("5200"), 0);
  c.Acc.stockAdjust({ item_id: it.id, qtyDelta: -2, reason: "ເສຍ", date: "2026-10-31" });
  assert.equal(c.Acc.accountBalance("5200"), 2000);
  assert.equal(c.Acc.accountBalance("1300") - base1300, -32000);
  assert.equal(c.Acc.stockValue(it.id), 68000, "stock subledger: 70 - 2 units left at 1,000");
});
