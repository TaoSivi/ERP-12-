const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

// Found while running a month for a logistics company: places where a subledger or a report disagreed with the ledger.

function invoice(c, qty, price, date) {
  const cust = c.Store.all("customers")[0], item = c.Store.where("items", i => i.type === "service")[0];
  const inv = c.Store.insert("invoices", { number: c.Acc.nextNumber("INV", "invoices", date), customer_id: cust.id, date, due_date: date, currency: "LAK", fx_rate: 1, status: "draft", paid: 0 });
  c.Store.insert("invoice_lines", { invoice_id: inv.id, item_id: item.id, qty, price, discount: 0, tax_code: "tax_0" });
  c.Acc.postInvoice(inv);
  return c.Store.get("invoices", inv.id);
}
function bill(c, price, date) {
  const v = c.Store.all("vendors")[0];
  const b = c.Store.insert("bills", { number: c.Acc.nextNumber("BILL", "bills", date), vendor_id: v.id, date, due_date: date, currency: "LAK", fx_rate: 1, status: "draft", paid: 0 });
  c.Store.insert("bill_lines", { bill_id: b.id, account_id: "5200", description: "x", qty: 1, price, tax_code: "tax_0" });
  c.Acc.postBill(b);
  return c.Store.get("bills", b.id);
}

test("a credit note after the invoice was fully paid shows up as a customer CREDIT in AR (subledger = ledger)", async () => {
  const c = await freshApp(), bank = c.Store.all("bank_accounts")[0].id;
  const inv = invoice(c, 10, 100000, "2026-10-05");
  c.Acc.receivePayment({ invoice_id: inv.id, bank_id: bank, amount: 1000000, date: "2026-10-06" });
  const cn = c.Store.insert("credit_notes", { number: "CN-T", invoice_id: inv.id, customer_id: inv.customer_id, date: "2026-10-10", status: "draft", return_stock: false });
  c.Store.insert("cn_lines", { cn_id: cn.id, item_id: c.Store.where("items", i => i.type === "service")[0].id, qty: 1, price: 100000, tax_code: "tax_0" });
  c.Acc.postCreditNote(c.Store.get("credit_notes", cn.id));
  assert.equal(c.Acc.accountBalance("1200"), -100000, "the ledger holds a customer credit");
  assert.equal(c.Acc.arOutstanding(), -100000, "the report must say the same");
});

test("WHT tied to a bill settles that bill, so AP subledger = ledger", async () => {
  const c = await freshApp(), bank = c.Store.all("bank_accounts")[0].id;
  const b = bill(c, 1000000, "2026-10-05");
  const tax = c.Acc.whtEntry({ bill_id: b.id, base: 1000000, rate: 2, date: "2026-10-06" });
  assert.equal(tax, 20000);
  c.Acc.payBill({ bill_id: b.id, bank_id: bank, amount: 980000, date: "2026-10-07" });
  assert.equal(c.Store.get("bills", b.id).status, "paid");
  assert.equal(c.Acc.apOutstanding(), 0); assert.equal(c.Acc.accountBalance("2100"), 0); assert.equal(c.Acc.accountBalance("2400"), 20000);
  assert.throws(() => c.Acc.whtEntry({ bill_id: b.id, base: 1000000, rate: 2, date: "2026-10-08" }), /ເກີນຍອດຄ້າງ/, "cannot withhold more than the bill still owes");
});

test("working capital: no COGS (service company) gives n/a instead of nonsense days", async () => {
  const c = await freshApp();
  invoice(c, 10, 100000, "2026-10-05"); bill(c, 400000, "2026-10-06");
  const w = c.Acc.workingCapital();
  assert.equal(w.dio, null, "no stock, no days of stock");
  assert.ok(w.dso > 0 && w.dpo > 0 && w.dpo < 1000, "DPO " + w.dpo);
});

test("cash flow: paying for a fixed asset is INVESTING, not operating", async () => {
  const c = await freshApp(), bank = c.Store.all("bank_accounts")[0].id, vend = c.Store.all("vendors")[0].id, date = "2026-10-02";
  const pr = c.Procure.create({ requester: "x", dept: "x", purpose: "ຊື້ລົດຈັກ", date, lines: [{ description: "ລົດຈັກ", kind: "asset", qty: 1, price: 3000000, account: "1700" }] }, "Purchasing");
  c.Procure.submit(pr.id, "Purchasing");
  Array.from(c.Store.get("purchase_requisitions", pr.id).chain).forEach(r => c.Procure.approvePR(pr.id, r));
  c.Procure.addQuote(pr.id, { vendor_id: vend, amount: 3000000, days: 1 }, "Purchasing");
  c.Procure.createPO(pr.id, "Purchasing", "ຜູ້ສະໜອງດຽວ");
  const cas = c.Store.get("purchase_requisitions", pr.id);
  try { c.Procure.approvePO(pr.id, "Manager"); } catch (e) { c.Procure.approvePO(pr.id, "Admin"); }
  const pls = c.Store.where("po_lines", l => l.po_id === cas.po_id);
  c.Procure.receive(pr.id, "Warehouse", { date, receipt: pls.map(l => ({ po_line_id: l.id, qty: l.qty })) });
  const b = c.Procure.prepareBill(pr.id, "Accountant", { date, vendor_ref: "V1", vat: false, lines: pls.map(l => ({ po_line_id: l.id, qty: l.qty, price: l.price })) });
  c.Procure.finishBill(pr.id, b.id, "Accountant");
  c.Procure.pay(pr.id, "Accountant", { bank_id: bank, amount: c.Store.get("bills", b.id).total, date });
  const cf = c.Acc.cashFlowGL("2026-10-01", "2026-10-31"), inv = Array.from(cf.rows).filter(r => r.section === "ລົງທຶນ (ຊັບສິນຖາວອນ)");
  assert.equal(inv.reduce((s, r) => s + r.outflow, 0), 3000000);
  assert.equal(Array.from(cf.rows).filter(r => r.section === "ດຳເນີນງານ").reduce((s, r) => s + r.outflow, 0), 0);
});
