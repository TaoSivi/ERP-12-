const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

async function withInvoice(c, total = 100000) {
  const cu = c.Store.all("customers")[0], it = c.Store.where("items", i => i.type === "service")[0];
  const inv = c.Store.insert("invoices", { number: "I-1", customer_id: cu.id, date: "2026-10-05", due_date: "2026-10-05", currency: "LAK", fx_rate: 1, status: "draft", paid: 0 });
  c.Store.insert("invoice_lines", { invoice_id: inv.id, item_id: it.id, qty: 1, price: total, discount: 0, tax_code: "tax_0" });
  c.Acc.postInvoice(c.Store.get("invoices", inv.id)); return c.Store.get("invoices", inv.id);
}

test("switch OFF: receipt posts at once; switch ON: nothing posts until the chain has signed", async () => {
  const c = await freshApp(), inv = await withInvoice(c), bank = c.Store.all("bank_accounts")[0].id;
  assert.equal(c.Gate.isOn("RCPT"), false);
  let r = c.Gate.submit("RCPT", { invoice_id: inv.id, bank_id: bank, amount: 40000, date: "2026-10-06" }, "Cashier");
  assert.equal(r.pending, false); assert.equal(c.Store.get("invoices", inv.id).paid, 40000);
  c.Gate.setOn("RCPT", true);
  r = c.Gate.submit("RCPT", { invoice_id: inv.id, bank_id: bank, amount: 60000, date: "2026-10-07" }, "Cashier");
  assert.equal(r.pending, true); assert.equal(c.Store.get("invoices", inv.id).paid, 40000, "still not posted");
  assert.throws(() => c.Gate.approve(r.doc.id, "Cashier"), /ອະນຸມັດເອງບໍ່ໄດ້|ລໍ/, "the requester cannot approve");
  const d = c.Gate.approve(r.doc.id, "Manager");
  assert.equal(d.status, "posted"); assert.equal(c.Store.get("invoices", inv.id).status, "paid"); assert.ok(d.je_ids.length >= 1);
});

test("payment voucher is ON by default, can be rejected (with a reason) and then posts nothing", async () => {
  const c = await freshApp(), bank = c.Store.all("bank_accounts")[0].id, v = c.Store.all("vendors")[0];
  const b = c.Store.insert("bills", { number: "B-1", vendor_id: v.id, date: "2026-10-05", due_date: "2026-10-05", currency: "LAK", fx_rate: 1, status: "draft", paid: 0 });
  c.Store.insert("bill_lines", { bill_id: b.id, account_id: "5200", description: "x", qty: 1, price: 50000, tax_code: "tax_0" }); c.Acc.postBill(c.Store.get("bills", b.id));
  assert.equal(c.Gate.isOn("PAYV"), true);
  const r = c.Gate.submit("PAYV", { bill_id: b.id, bank_id: bank, amount: 50000, date: "2026-10-06" }, "Accountant");
  assert.equal(r.pending, true);
  assert.throws(() => c.Gate.reject(r.doc.id, "Manager", ""), /ເຫດຜົນ/);
  assert.equal(c.Gate.reject(r.doc.id, "Manager", "ຍັງບໍ່ມີໃບບິນຕົວຈິງ").status, "rejected");
  assert.equal(c.Store.get("bills", b.id).paid, 0);
});

test("two waiting documents for the same thing are refused (key); a document that cannot post becomes 'failed' and can be retried", async () => {
  const c = await freshApp(), bank = c.Store.all("bank_accounts")[0].id;
  c.Store.insert("assets", { name: "ລົດ", category: "x", cost: 6000000, life_months: 60, date: "2026-09-01", method: "straight", acc_dep: 0, status: "active" });
  const p = { period: "2026-10", date: "2026-10-31", amount: 100000 };
  const r = c.Gate.submit("DEPR", p, "Accountant", { key: "DEPR:2026-10" });
  assert.throws(() => c.Gate.submit("DEPR", p, "Accountant", { key: "DEPR:2026-10" }), /ລໍອະນຸມັດຢູ່ແລ້ວ/);
  c.Store.update("settings", "company", { lock_date: "2026-10-31" }); // the period gets locked before the approver signs
  assert.equal(c.Gate.approve(r.doc.id, "Manager").status, "failed");
  c.Store.update("settings", "company", { lock_date: "" });
  assert.equal(c.Gate.retry(r.doc.id).status, "posted"); assert.ok(c.Acc.accountBalance("1750") < 0, "accumulated depreciation is a credit");
});

test("month-end depreciation waits for approval when the gate is on and cannot be duplicated by the engine", async () => {
  const c = await freshApp();
  c.Store.insert("assets", { name: "ລົດ", category: "x", cost: 6000000, life_months: 60, date: "2026-09-01", method: "straight", acc_dep: 0, status: "active" });
  c.Autopost.setConfig({ enabled: true, start: "2026-09" });
  c.Autopost.run("2026-11-05"); c.Autopost.run("2026-11-06");
  const docs = c.Store.all("gate_docs").filter(d => d.type === "DEPR");
  assert.ok(docs.length >= 1 && new Set(docs.map(d => d.key)).size === docs.length, "one waiting document per month");
  assert.equal(c.Acc.accountBalance("1750"), 0, "nothing posted before approval");
  c.Gate.approve(docs[0].id, "Manager"); assert.ok(c.Acc.accountBalance("1750") < 0, "accumulated depreciation is a credit");
});

test("the gate queue shows a document only to people who may sign it", async () => {
  const c = await freshApp(), inv = await withInvoice(c), bank = c.Store.all("bank_accounts")[0].id;
  c.Gate.setOn("RCPT", true); c.Gate.submit("RCPT", { invoice_id: inv.id, bank_id: bank, amount: 1000, date: "2026-10-06" }, "Cashier");
  assert.equal(c.Gate.queue("Manager").length, 1); assert.equal(c.Gate.queue("Cashier").length, 0);
});
