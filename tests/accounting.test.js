// Accounting engine tests. Run with:  node --test tests/
// Loads the real browser files (config/store/accounting) into a vm sandbox — no build step.
const test = require("node:test");
const assert = require("node:assert/strict");

const TODAY = "2026-03-15";

const { freshApp } = require("./helpers");

// ---- helpers ----
function stockItem(S) { return S.where("items", i => i.type === "stock")[0]; }
function customer(S) { return S.all("customers")[0]; }
function makeInvoice(S, { date = TODAY, qty = 10, price = 35000, tax = "tax_out10" } = {}) {
  const it = stockItem(S);
  const inv = S.insert("invoices", { number: "T-" + Math.random(), date, customer_id: customer(S).id, status: "draft" });
  S.insert("invoice_lines", { invoice_id: inv.id, item_id: it.id, qty, price, discount: 0, tax_code: tax });
  return inv;
}
function totals(A, S) {
  let dr = 0, cr = 0;
  const ok = new Set(S.all("journal_entries").filter(j => j.status === "posted" || j.status === "reversed").map(j => j.id));
  S.all("journal_lines").filter(l => ok.has(l.je_id)).forEach(l => { dr += l.debit; cr += l.credit; });
  return { dr: A.round(dr), cr: A.round(cr) };
}

test("postJournal rejects an unbalanced entry", async () => {
  const { Acc } = await freshApp();
  assert.throws(() => Acc.postJournal({
    date: TODAY, source_type: "T", source_id: "", memo: "",
    lines: [{ account: "1100", debit: 100, credit: 0 }, { account: "4100", debit: 0, credit: 90 }]
  }), /ບໍ່ສົມດຸນ/);
});

test("invoice posting: AR / revenue / VAT / FIFO COGS / stock", async () => {
  const { Acc, Store } = await freshApp();
  const it = stockItem(Store);
  const inv = makeInvoice(Store, { qty: 10, price: 35000 });
  Acc.postInvoice(inv);
  // 10 x 35,000 = 350,000 + 10% VAT = 385,000
  assert.equal(Acc.accountBalance("1200"), 385000, "AR");
  assert.equal(Acc.accountBalance("4100"), 350000, "revenue");
  assert.equal(Acc.accountBalance("2200"), 35000, "VAT output");
  assert.equal(Acc.accountBalance("5100"), 220000, "COGS = 10 x 22,000");
  assert.equal(Acc.stockQty(it.id), 90);
  const t = totals(Acc, Store);
  assert.equal(t.dr, t.cr, "trial balance balances");
});

test("FIFO: second lot is only used after the first is exhausted", async () => {
  const { Acc, Store } = await freshApp();
  const it = stockItem(Store);
  Acc.recordMove(it.id, "in", 50, 30000, "T", "x");   // lots: 100@22k, 50@30k
  assert.equal(Acc.computeCOGS(it.id, 100), 100 * 22000);
  assert.equal(Acc.computeCOGS(it.id, 120), 100 * 22000 + 20 * 30000);
});

test("receivePayment settles the invoice and moves cash", async () => {
  const { Acc, Store } = await freshApp();
  const inv = makeInvoice(Store);
  Acc.postInvoice(inv);
  const bank = Store.all("bank_accounts")[0];
  const cur = () => Store.get("invoices", inv.id);
  Acc.receivePayment({ invoice_id: inv.id, bank_id: bank.id, amount: 100000, date: TODAY });
  assert.equal(cur().status, "partial");
  Acc.receivePayment({ invoice_id: inv.id, bank_id: bank.id, amount: 285000, date: TODAY });
  assert.equal(cur().status, "paid");
  assert.equal(Acc.accountBalance("1200"), 0, "AR cleared");
  assert.equal(Acc.accountBalance(bank.gl_account), 385000, "cash in bank");
});

test("voidInvoice reverses AR, revenue and puts stock back", async () => {
  const { Acc, Store } = await freshApp();
  const it = stockItem(Store);
  const inv = makeInvoice(Store);
  Acc.postInvoice(inv);
  Acc.voidInvoice(Store.get("invoices", inv.id));
  assert.equal(Acc.accountBalance("1200"), 0);
  assert.equal(Acc.accountBalance("4100"), 0);
  assert.equal(Acc.accountBalance("5100"), 0);
  assert.equal(Acc.stockQty(it.id), 100);
  assert.equal(Store.get("invoices", inv.id).status, "void");
  const t = totals(Acc, Store);
  assert.equal(t.dr, t.cr);
});

test("bill posting + payment: AP and input VAT", async () => {
  const { Acc, Store } = await freshApp();
  const v = Store.all("vendors")[0];
  const bill = Store.insert("bills", { number: "B-1", date: TODAY, vendor_id: v.id, status: "draft" });
  Store.insert("bill_lines", { bill_id: bill.id, account_id: "5200", qty: 1, price: 200000, tax_code: "tax_in10", description: "rent" });
  Acc.postBill(bill);
  assert.equal(Acc.accountBalance("2100"), 220000, "AP");
  assert.equal(Acc.accountBalance("1400"), 20000, "VAT input");
  assert.equal(Acc.accountBalance("5200"), 200000, "expense");
  const bank = Store.all("bank_accounts")[0];
  Acc.payBill({ bill_id: bill.id, bank_id: bank.id, amount: 220000, date: TODAY });
  assert.equal(Acc.accountBalance("2100"), 0);
  assert.equal(Store.get("bills", bill.id).status, "paid");
});

test("period lock: back-dated posting is refused", async () => {
  const { Acc, Store } = await freshApp();
  Store.update("settings", "company", { lock_date: "2026-01-31" });
  assert.throws(() => Acc.assertOpen("2026-01-31"), /ວັນລັອກ/);
  assert.throws(() => Acc.assertOpen("2025-12-01"), /ວັນລັອກ/);
  assert.doesNotThrow(() => Acc.assertOpen("2026-02-01"));
});

test("period lock: a refused invoice leaves NO stock move and NO journal behind", async () => {
  const { Acc, Store } = await freshApp();
  const it = stockItem(Store);
  const inv = makeInvoice(Store, { date: "2026-01-10" });
  Store.update("settings", "company", { lock_date: "2026-01-31" });
  const moves = Store.all("stock_moves").length, jes = Store.all("journal_entries").length;
  assert.throws(() => Acc.postInvoice(inv), /ວັນລັອກ/);
  assert.equal(Store.all("stock_moves").length, moves, "stock_moves unchanged");
  assert.equal(Store.all("journal_entries").length, jes, "journal_entries unchanged");
  assert.equal(Acc.stockQty(it.id), 100);
  assert.equal(Store.get("invoices", inv.id).status, "draft");
});

test("period lock: a refused payment leaves no payment row; refused stock adjust leaves no move", async () => {
  const { Acc, Store } = await freshApp();
  const inv = makeInvoice(Store, { date: "2026-03-01" });
  Acc.postInvoice(inv);
  Store.update("settings", "company", { lock_date: "2026-03-31" });
  const bank = Store.all("bank_accounts")[0];
  assert.throws(() => Acc.receivePayment({ invoice_id: inv.id, bank_id: bank.id, amount: 1000, date: "2026-03-20" }), /ວັນລັອກ/);
  assert.equal(Store.all("payments").length, 0);
  const it = stockItem(Store);
  const moves = Store.all("stock_moves").length;
  assert.throws(() => Acc.stockAdjust({ item_id: it.id, qtyDelta: -5, reason: "t", date: "2026-03-20" }), /ວັນລັອກ/);
  assert.equal(Store.all("stock_moves").length, moves);
});

test("yearEndClose zeroes revenue/expense and moves profit to retained earnings", async () => {
  const { Acc, Store } = await freshApp();
  Acc.postInvoice(makeInvoice(Store, { qty: 10, price: 35000 })); // revenue 350k, COGS 220k => profit 130k
  const before = Acc.plData();
  assert.equal(before.net, 130000);
  Acc.yearEndClose(TODAY);
  assert.equal(Acc.accountBalance("4100"), 0);
  assert.equal(Acc.accountBalance("5100"), 0);
  assert.equal(Acc.accountBalance("3200"), 130000, "retained earnings");
  const t = totals(Acc, Store);
  assert.equal(t.dr, t.cr);
});
