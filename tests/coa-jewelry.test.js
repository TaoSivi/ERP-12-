// Jewelry chart template (js/coa-jewelry.js) for a new company, LT numbering. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

// a new company slot created with the jewelry template, as the "new company" form stores it
const jewelryCompany = () => freshApp({ mem: { laobooks_db_slot: "cj1", "laobooks_slot_init__cj1": JSON.stringify({ name: "ຮ້ານທອງ", tin: "", coa: "jewelry_lt" }) } });
const TODAY = new Date().toISOString().slice(0, 10);

test("template: unique codes, valid types, every alias and posting role points into the chart", async () => {
  const app = await freshApp();
  const tpl = app.COA_TEMPLATES.jewelry_lt, codes = new Set(tpl.accounts.map(r => r[0]));
  assert.equal(codes.size, tpl.accounts.length, "no duplicate codes");
  tpl.accounts.forEach(r => assert.ok(["Asset", "Liability", "Equity", "Revenue", "Expense"].includes(r[2]), r[0]));
  Object.entries(tpl.alias).forEach(([k, v]) => assert.ok(codes.has(v), k + " → " + v + " missing"));
  Object.entries(app.Acc.POSTING_DEFAULTS).forEach(([role, code]) => assert.ok(codes.has(tpl.alias[code] || code), role + " (" + code + ") not mapped"));
});

test("new company starts with ONLY the jewelry chart, roles and bank mapped to it", async () => {
  const { Store, COA_TEMPLATES } = await jewelryCompany();
  const tpl = COA_TEMPLATES.jewelry_lt;
  assert.equal(Store.all("accounts").length, tpl.accounts.length, "no default 4-digit accounts added");
  assert.equal(Store.where("accounts", a => a.code === "1100").length, 0);
  assert.equal(Store.get("settings", "company").coa_template, "jewelry_lt");
  assert.equal(Store.get("settings", "posting").AR, "1211.01");
  assert.equal(Store.get("settings", "posting").VAT_OUT, "432.01");
  assert.equal(Store.all("bank_accounts")[0].gl_account, "1021.01");
  assert.equal(Store.all("customers").length, 0, "no demo data");
});

test("re-opening the jewelry company does not add the default accounts back", async () => {
  const mem = { laobooks_db_slot: "cj1", "laobooks_slot_init__cj1": JSON.stringify({ name: "ຮ້ານທອງ", coa: "jewelry_lt" }) };
  const a = await freshApp({ mem }); const n = a.Store.all("accounts").length;
  delete mem["laobooks_slot_init__cj1"];             // the app removes the init note after the first start
  const b = await freshApp({ mem });
  assert.equal(b.Store.all("accounts").length, n);
});

test("a sale and its payment land only on chart accounts (LT codes) and balance", async () => {
  const { Store, Acc } = await jewelryCompany();
  const cust = Store.insert("customers", { name: "ນາງ ພອນ", terms: 0 });
  const it = Store.insert("items", { sku: "RG1", name: "ແຫວນທອງ", type: "stock", sell_price: 9800000, income_account: "7011.01", inventory_account: "1371.01", status: "active" });
  Acc.recordMove(it.id, "in", 1, 8200000, "OPENING", "");
  const inv = Store.insert("invoices", { number: "INV-1", date: TODAY, customer_id: cust.id, status: "draft" });
  Store.insert("invoice_lines", { invoice_id: inv.id, item_id: it.id, qty: 1, price: 9800000, discount: 0, tax_code: "tax_out10" });
  Acc.postInvoice(inv);
  Acc.receivePayment({ invoice_id: inv.id, bank_id: Store.all("bank_accounts")[0].id, amount: Store.get("invoices", inv.id).total, date: TODAY });
  const chart = new Set(Store.all("accounts").map(a => a.code));
  Store.all("journal_lines").forEach(l => assert.ok(chart.has(l.account), "line on " + l.account + " is outside the chart"));
  assert.equal(Acc.accountBalance("7011.01"), 9800000, "revenue – gold");
  assert.equal(Acc.accountBalance("432.01"), 980000, "VAT out");
  assert.equal(Acc.accountBalance("1211.01"), 0, "paid");
  assert.equal(Acc.accountBalance("1021.01"), 10780000, "bank");
  let dr = 0, cr = 0; Store.all("journal_lines").forEach(l => { dr += l.debit; cr += l.credit; });
  assert.equal(Acc.round(dr), Acc.round(cr));
});

test("built-in 4-digit codes are mapped: '5200' posts to 606.09 and reads back via either code", async () => {
  const { Acc } = await jewelryCompany();
  Acc.postJournal({ date: TODAY, source_type: "T", source_id: "", memo: "x", lines: [{ account: "5200", debit: 50000, credit: 0 }, { account: "1100", debit: 0, credit: 50000 }] });
  assert.equal(Acc.accountBalance("606.09"), 50000);
  assert.equal(Acc.accountBalance("5200"), 50000);
  assert.equal(Acc.accountBalance("1021.01"), -50000);
});

test("a company on the default chart is unchanged (no alias)", async () => {
  const { Store, Acc } = await freshApp();
  assert.ok(Store.where("accounts", a => a.code === "1100").length);
  assert.equal(Acc.alias("5200"), "5200");
});
