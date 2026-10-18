const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

const J = (c, lines) => c.Acc.postJournal({ date: "2026-10-15", source_type: "MANUAL", memo: "ທົດສອບ", lines });

test("journal: unknown account, header account and negative amounts are refused", async () => {
  const c = await freshApp();
  assert.throws(() => J(c, [{ account: "9999", debit: 100, credit: 0 }, { account: "1100", debit: 0, credit: 100 }]), /ບໍ່ພົບບັນຊີ/);
  assert.throws(() => J(c, [{ account: "5000", debit: 100, credit: 0 }, { account: "1100", debit: 0, credit: 100 }]), /ຫົວໝວດ/);
  assert.throws(() => J(c, [{ account: "5200", debit: -100, credit: 0 }, { account: "1100", debit: 0, credit: -100 }]), /ຕິດລົບ/);
  const n = c.Store.all("journal_entries").length;
  J(c, [{ account: "5200", debit: 100, credit: 0 }, { account: "1100", debit: 0, credit: 100 }]); // a valid one still works
  assert.equal(c.Store.all("journal_entries").length, n + 1);
});

function invoice(c, qty, price) {
  const cust = c.Store.all("customers")[0], item = c.Store.where("items", i => i.type === "service")[0];
  const inv = c.Store.insert("invoices", { number: c.Acc.nextNumber("INV", "invoices", "2026-10-15"), customer_id: cust.id, date: "2026-10-15", due_date: "2026-10-30", currency: "LAK", fx_rate: 1, status: "draft", paid: 0 });
  c.Store.insert("invoice_lines", { invoice_id: inv.id, item_id: item.id, qty, price, discount: 0, tax_code: "tax_0" });
  c.Acc.postInvoice(inv);
  return c.Store.get("invoices", inv.id);
}

test("receipts: must be > 0 and cannot exceed what is open on the invoice", async () => {
  const c = await freshApp();
  const inv = invoice(c, 1, 1000000), bank = c.Store.all("bank_accounts")[0].id;
  assert.throws(() => c.Acc.receivePayment({ invoice_id: inv.id, bank_id: bank, amount: 0, date: "2026-10-16" }), /> 0/);
  assert.throws(() => c.Acc.receivePayment({ invoice_id: inv.id, bank_id: bank, amount: 1500000, date: "2026-10-16" }), /ເກີນຍອດຄ້າງ/);
  c.Acc.receivePayment({ invoice_id: inv.id, bank_id: bank, amount: 600000, date: "2026-10-16" });
  assert.throws(() => c.Acc.receivePayment({ invoice_id: inv.id, bank_id: bank, amount: 600000, date: "2026-10-17" }), /ຄ້າງ 400000/);
  c.Acc.receivePayment({ invoice_id: inv.id, bank_id: bank, amount: 400000, date: "2026-10-17" });
  assert.equal(c.Store.get("invoices", inv.id).status, "paid");
  assert.equal(c.Acc.arOutstanding(), 0);
});

test("bill payments: cannot pay more than is owed", async () => {
  const c = await freshApp();
  const v = c.Store.all("vendors")[0], bank = c.Store.all("bank_accounts")[0].id;
  const bill = c.Store.insert("bills", { number: "BILL-T", vendor_id: v.id, date: "2026-10-15", due_date: "2026-10-30", currency: "LAK", fx_rate: 1, status: "draft", paid: 0 });
  c.Store.insert("bill_lines", { bill_id: bill.id, account_id: "5200", description: "x", qty: 1, price: 500000, tax_code: "tax_0" });
  c.Acc.postBill(bill);
  assert.throws(() => c.Acc.payBill({ bill_id: bill.id, bank_id: bank, amount: 600000, date: "2026-10-16" }), /ເກີນຍອດຄ້າງ/);
  c.Acc.payBill({ bill_id: bill.id, bank_id: bank, amount: 500000, date: "2026-10-16" });
  assert.equal(c.Acc.apOutstanding(), 0);
});

test("cash flow comes from the ledger: every journal on a cash/bank account counts and the closing equals the balance", async () => {
  const c = await freshApp();
  c.Acc.postJournal({ date: "2026-10-01", source_type: "MANUAL", memo: "ທຶນ", lines: [{ account: "1100", debit: 50000000, credit: 0 }, { account: "3100", debit: 0, credit: 50000000 }] });
  c.Acc.postJournal({ date: "2026-10-02", source_type: "POS_DAILY", memo: "POS", lines: [{ account: "1100", debit: 11000000, credit: 0 }, { account: "4100", debit: 0, credit: 10000000 }, { account: "2200", debit: 0, credit: 1000000 }] });
  c.Acc.postJournal({ date: "2026-10-03", source_type: "REQUEST", memo: "ຄ່າເຊົ່າ", lines: [{ account: "5200", debit: 4000000, credit: 0 }, { account: "1100", debit: 0, credit: 4000000 }] });
  const cf = c.Acc.cashFlowGL("2026-10-01", "2026-10-31");
  assert.equal(cf.inflow, 61000000);
  assert.equal(cf.outflow, 4000000);
  assert.equal(cf.closing, c.Acc.accountBalance("1100"));
  const fin = Array.from(cf.rows).find(r => r.section === "ການເງິນ (ທຶນ / ກູ້ຢືມ)");
  assert.equal(fin.inflow, 50000000, "owner capital is financing, not operating");
  // opening balance: a later window starts from what was there before
  const later = c.Acc.cashFlowGL("2026-10-03", "2026-10-31");
  assert.equal(later.opening, 61000000);
  assert.equal(later.closing, c.Acc.accountBalance("1100"));
});
