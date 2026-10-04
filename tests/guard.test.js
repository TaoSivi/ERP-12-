// Guard (pre-posting checks + precedents). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

const TODAY = new Date().toISOString().slice(0, 10);
const addDays = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function invoice(S, { date = TODAY, qty = 1, price = 100000, tax = "tax_0", status = "draft", customer } = {}) {
  const it = S.where("items", i => i.type === "stock")[0];
  const inv = S.insert("invoices", { number: "I-" + Math.random().toString(36).slice(2, 7), date, customer_id: (customer || S.all("customers")[0]).id, status });
  S.insert("invoice_lines", { invoice_id: inv.id, item_id: it.id, qty, price, discount: 0, tax_code: tax });
  return inv;
}
function bill(S, { date = TODAY, price = 200000, account = "5200", status = "draft" } = {}) {
  const b = S.insert("bills", { number: "B-" + Math.random().toString(36).slice(2, 7), date, vendor_id: S.all("vendors")[0].id, status });
  S.insert("bill_lines", { bill_id: b.id, account_id: account, qty: 1, price, tax_code: "tax_0", description: "x" });
  return b;
}
const rules = r => Array.from(r.findings, f => f.rule); // Array.from: results come from the vm realm

test("clean invoice passes with no findings", async () => {
  const { Guard, Store } = await freshApp();
  const r = Guard.review("invoice", invoice(Store, { price: 35000 }));
  assert.equal(r.status, "ok");
});

test("exact duplicate invoice is a BLOCK that needs an approver", async () => {
  const { Guard, Store, Acc } = await freshApp();
  const first = invoice(Store, { price: 50000 });
  Acc.postInvoice(first);
  const dup = invoice(Store, { price: 50000 });
  const r = Guard.review("invoice", dup);
  assert.ok(rules(r).includes("DUPLICATE"));
  assert.equal(r.needsApprover, true);
  assert.equal(r.status, "needs_decision");
});

test("a different amount is not a duplicate", async () => {
  const { Guard, Store, Acc } = await freshApp();
  Acc.postInvoice(invoice(Store, { price: 50000 }));
  assert.ok(!rules(Guard.review("invoice", invoice(Store, { price: 60000 }))).includes("DUPLICATE"));
});

test("selling below cost warns (cost is 22,000)", async () => {
  const { Guard, Store } = await freshApp();
  const r = Guard.review("invoice", invoice(Store, { price: 10000 }));
  assert.deepEqual(rules(r), ["BELOW_COST"]);
  assert.equal(r.needsApprover, false, "warn only: staff can continue with a reason");
});

test("bill on a Revenue account warns ACCOUNT_TYPE", async () => {
  const { Guard, Store } = await freshApp();
  assert.deepEqual(rules(Guard.review("bill", bill(Store, { account: "4100" }))), ["ACCOUNT_TYPE"]);
  assert.equal(Guard.review("bill", bill(Store, { account: "5200" })).status, "ok");
});

test("future and very old dates warn", async () => {
  const { Guard, Store } = await freshApp();
  assert.ok(rules(Guard.review("bill", bill(Store, { date: addDays(5) }))).includes("DATE_FUTURE"));
  assert.ok(rules(Guard.review("bill", bill(Store, { date: addDays(-90) }))).includes("DATE_OLD"));
});

test("unusually large amount for a party with history warns", async () => {
  const { Guard, Store, Acc } = await freshApp();
  for (let i = 0; i < 3; i++) Acc.postInvoice(invoice(Store, { price: 40000 + i * 1000, date: addDays(-(10 + i * 10)) }));
  const r = Guard.review("invoice", invoice(Store, { price: 500000 }));
  assert.ok(rules(r).includes("UNUSUAL_AMOUNT"));
});

test("manual journal: missing memo blocks; control account and cash warn", async () => {
  const { Guard, Store } = await freshApp();
  const bank = Store.all("bank_accounts")[0];
  const lines = [{ account: "1200", debit: 1000, credit: 0 }, { account: bank.gl_account, debit: 0, credit: 1000 }];
  const r = Guard.review("journal", { date: TODAY, memo: "", lines });
  assert.deepEqual(rules(r).sort(), ["JE_CASH", "JE_CONTROL", "JE_MEMO"]);
  assert.equal(r.needsApprover, true);
  assert.equal(Guard.review("journal", { date: TODAY, memo: "x", lines }, { skipMemo: true }).findings.some(f => f.rule === "JE_MEMO"), false);
});

test("manual journal above approval_limit blocks", async () => {
  const { Guard, Store } = await freshApp();
  Store.update("settings", "company", { approval_limit: 1000000 });
  const r = Guard.review("journal", { date: TODAY, memo: "ປັບປຸງຍອດ", lines: [{ account: "5200", debit: 5000000, credit: 0 }, { account: "3100", debit: 0, credit: 5000000 }] });
  assert.ok(rules(r).includes("JE_LARGE"));
});

test("approver's reason becomes a precedent; the same case then auto-passes", async () => {
  const { Guard, Store } = await freshApp();
  const first = Guard.review("bill", bill(Store, { account: "4100" }));
  assert.equal(first.status, "needs_decision");
  const outcome = Guard.record({ kind: "bill", doc: { id: "b1", number: "B-1" }, result: first, reason: "ເງິນຄືນຈາກຜູ້ສະໜອງ", role: "Manager", isApprover: true });
  assert.equal(outcome, "approved");
  assert.equal(Store.all("precedents").length, 1);

  const second = Guard.review("bill", bill(Store, { account: "4100" }));
  assert.equal(second.status, "precedent");
  Guard.record({ kind: "bill", doc: { id: "b2" }, result: second, reason: "", role: "Accountant", isApprover: false });
  assert.equal(Store.all("precedents")[0].uses, 1, "use counter incremented");
  assert.equal(Store.all("guard_log").length, 2);

  // a different account is NOT covered by that precedent
  assert.equal(Guard.review("bill", bill(Store, { account: "3100" })).status, "needs_decision");
});

test("staff reason is logged for review but does NOT create a precedent", async () => {
  const { Guard, Store } = await freshApp();
  const r = Guard.review("bill", bill(Store, { account: "4100" }));
  const outcome = Guard.record({ kind: "bill", doc: { id: "b1" }, result: r, reason: "ຂ້ອຍຄິດວ່າຖືກ", role: "Accountant", isApprover: false });
  assert.equal(outcome, "staff_override");
  assert.equal(Store.all("precedents").length, 0);
  assert.equal(Store.all("guard_log")[0].needs_review, true);
  assert.equal(Guard.review("bill", bill(Store, { account: "4100" })).status, "needs_decision", "still checked next time");
});

test("duplicates and missing memo can never be waved through by a precedent", async () => {
  const { Guard, Store, Acc } = await freshApp();
  Acc.postInvoice(invoice(Store, { price: 70000 }));
  const r = Guard.review("invoice", invoice(Store, { price: 70000 }));
  Guard.record({ kind: "invoice", doc: { id: "i" }, result: r, reason: "ລູກຄ້າສັ່ງສອງຄັ້ງ", role: "Admin", isApprover: true });
  assert.equal(Store.all("precedents").length, 0, "non-learnable rule stores no precedent");
  assert.equal(Guard.review("invoice", invoice(Store, { price: 70000 })).status, "needs_decision");
});
