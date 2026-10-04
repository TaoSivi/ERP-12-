// Request flows (advance / settlement / payment request) + approval matrix + store safety. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

const TODAY = new Date().toISOString().slice(0, 10);
const addDays = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
function balanced(Acc, Store) {
  let dr = 0, cr = 0;
  const ok = new Set(Store.all("journal_entries").filter(j => j.status === "posted" || j.status === "reversed").map(j => j.id));
  Store.all("journal_lines").filter(l => ok.has(l.je_id)).forEach(l => { dr += l.debit; cr += l.credit; });
  return Acc.round(dr) === Acc.round(cr);
}
const bankId = S => S.all("bank_accounts")[0].id;
// run a request through its whole approval chain using the chain's own roles
function approveAll(F, S, id) {
  let r = S.get("requests", id), guard = 0;
  while (r.stage === "approval" && guard++ < 5) { F.approve(id, r.chain[r.approvals_done.length]); r = S.get("requests", id); }
  return r;
}

/* ---------- approval matrix ---------- */
test("matrix: default tiers pick the right chain", async () => {
  const { Approval } = await freshApp();
  assert.deepEqual(Array.from(Approval.chainFor("PAY", 1000000)), ["Manager"]);
  assert.deepEqual(Array.from(Approval.chainFor("PAY", 5000000)), ["Manager"]);
  assert.deepEqual(Array.from(Approval.chainFor("PAY", 5000001)), ["Manager", "Accountant"]);
  assert.deepEqual(Array.from(Approval.chainFor("PAY", 99000000)), ["Manager", "Accountant", "Admin"]);
});

test("matrix: admin can change tiers; an open-ended top tier is always kept", async () => {
  const { Approval } = await freshApp();
  Approval.setMatrix([{ max: 2000000, chain: ["Manager"] }, { max: 10000000, chain: ["Manager", "Admin"] }]);
  assert.deepEqual(Array.from(Approval.chainFor("ADV", 1500000)), ["Manager"]);
  assert.deepEqual(Array.from(Approval.chainFor("ADV", 50000000)), ["Manager", "Admin"], "above the last tier uses the last chain");
});

test("approval: requester cannot approve; one role per step; Admin can stand in once", async () => {
  const { Flows: F, Store } = await freshApp();
  const r = F.create("PAY", { payee_type: "employee", payee: "Noy", purpose: "Taxi", lines: [{ account: "5240", description: "Taxi", amount: 8000000, receipt_no: "R1" }] }, "Manager");
  F.submit(r.id, "Manager");
  assert.throws(() => F.approve(r.id, "Manager"), /ອະນຸມັດເອງບໍ່ໄດ້/);
  F.approve(r.id, "Admin");                                       // stands in for step 1
  assert.throws(() => F.approve(r.id, "Admin"), /ອະນຸມັດຂັ້ນກ່ອນແລ້ວ/);
  assert.throws(() => F.approve(r.id, "Sales"), /Accountant/);
  F.approve(r.id, "Accountant");
  assert.equal(Store.get("requests", r.id).stage, "payout");
});

/* ---------- cash advance + settlement ---------- */
async function paidAdvance(amount) {
  const app = await freshApp();
  const { Flows: F, Store } = app;
  const adv = F.create("ADV", { payee: "Somchai", purpose: "Trip to Pakse", amount }, "Sales");
  F.submit(adv.id, "Sales"); approveAll(F, Store, adv.id);
  assert.equal(Store.get("requests", adv.id).stage, "payout", "approved advance waits for cashier");
  F.pay(adv.id, "Cashier", { bank_id: bankId(Store) });
  return Object.assign(app, { adv: Store.get("requests", adv.id) });
}

test("advance: payout books Dr employee advance / Cr bank and sets a clearing due date", async () => {
  const { Acc, Store, adv } = await paidAdvance(3000000);
  assert.equal(adv.stage, "open");
  assert.equal(adv.due_clear, addDays(15));
  assert.equal(Acc.accountBalance("1450"), 3000000);
  assert.equal(Acc.accountBalance("1100"), -3000000);
  assert.ok(balanced(Acc, Store));
});

test("advance: an overdue uncleared advance blocks a new one for the same person", async () => {
  const { Flows: F, Store, adv } = await paidAdvance(1000000);
  Store.update("requests", adv.id, { due_clear: "2020-01-01" });
  assert.throws(() => F.create("ADV", { payee: "Somchai", purpose: "again", amount: 500000 }, "Sales"), /ເກີນກຳນົດ/);
  assert.doesNotThrow(() => F.create("ADV", { payee: "Other", purpose: "x", amount: 500000 }, "Sales"));
});

test("settlement spent LESS: expenses + VAT booked, employee returns the rest, advance closes", async () => {
  const { Flows: F, Acc, Store, adv } = await paidAdvance(3000000);
  const clr = F.create("CLR", { advance_id: adv.id, purpose: "Trip receipts", lines: [
    { account: "5240", description: "Fuel", amount: 1100000, vat: true, receipt_no: "F-1" },   // 1,000,000 + 100,000 VAT
    { account: "5280", description: "Meals", amount: 900000, vat: false, receipt_no: "M-1" }
  ] }, "Sales");
  F.submit(clr.id, "Sales"); approveAll(F, Store, clr.id);
  let r = Store.get("requests", clr.id);
  assert.equal(r.stage, "refund");
  assert.equal(r.refund, 1000000);
  assert.equal(Acc.accountBalance("5240"), 1000000);
  assert.equal(Acc.accountBalance("1400"), 100000, "input VAT split out of the receipt");
  assert.equal(Acc.accountBalance("1450"), 1000000, "still owed by the employee");
  F.receiveRefund(clr.id, "Cashier", { bank_id: bankId(Store) });
  assert.equal(Acc.accountBalance("1450"), 0);
  assert.equal(Store.get("requests", adv.id).stage, "closed");
  assert.equal(Store.get("requests", clr.id).stage, "closed");
  assert.ok(balanced(Acc, Store));
});

test("settlement spent MORE: company pays the difference via payable-to-employee", async () => {
  const { Flows: F, Acc, Store, adv } = await paidAdvance(1000000);
  const clr = F.create("CLR", { advance_id: adv.id, purpose: "Receipts", lines: [{ account: "5270", description: "Repair", amount: 1300000, receipt_no: "X9" }] }, "Sales");
  F.submit(clr.id, "Sales"); approveAll(F, Store, clr.id);
  assert.equal(Store.get("requests", clr.id).stage, "payout");
  assert.equal(Acc.accountBalance("2150"), 300000);
  F.pay(clr.id, "Cashier", { bank_id: bankId(Store) });
  assert.equal(Acc.accountBalance("2150"), 0);
  assert.equal(Acc.accountBalance("1450"), 0);
  assert.equal(Store.get("requests", adv.id).stage, "closed");
  assert.ok(balanced(Acc, Store));
});

test("settlement needs a receipt number on every line, and only one per advance", async () => {
  const { Flows: F, adv } = await paidAdvance(1000000);
  assert.throws(() => F.create("CLR", { advance_id: adv.id, purpose: "x", lines: [{ account: "5240", amount: 100000, receipt_no: "" }] }, "Sales"), /ເລກທີ່ໃບບິນ/);
  F.create("CLR", { advance_id: adv.id, purpose: "x", lines: [{ account: "5240", amount: 100000, receipt_no: "A" }] }, "Sales");
  assert.throws(() => F.create("CLR", { advance_id: adv.id, purpose: "y", lines: [{ account: "5240", amount: 100000, receipt_no: "B" }] }, "Sales"), /ມີໃບເຄລຍຢູ່ແລ້ວ/);
});

/* ---------- payment request ---------- */
test("payment request to a vendor: approval creates & posts a Bill (AP aging), payout clears it", async () => {
  const { Flows: F, Acc, Store } = await freshApp();
  const v = Store.all("vendors")[0];
  const r = F.create("PAY", { payee_type: "vendor", vendor_id: v.id, purpose: "Electricity Sept", lines: [{ account: "5220", description: "EDL", amount: 2200000, vat: true, receipt_no: "EDL-0925" }] }, "Accountant");
  F.submit(r.id, "Accountant"); approveAll(F, Store, r.id);
  const bill = Store.get("bills", Store.get("requests", r.id).bill_id);
  assert.equal(bill.status, "posted");
  assert.equal(Acc.accountBalance("2100"), 2200000);
  assert.equal(Acc.accountBalance("5220"), 2000000);
  F.pay(r.id, "Cashier", { bank_id: bankId(Store) });
  assert.equal(Acc.accountBalance("2100"), 0);
  assert.equal(Store.get("bills", bill.id).status, "paid");
  assert.equal(Store.get("requests", r.id).stage, "closed");
  assert.ok(balanced(Acc, Store));
});

test("reimbursement to an employee: Dr expense / Cr payable-to-employee, then paid", async () => {
  const { Flows: F, Acc, Store } = await freshApp();
  const r = F.create("PAY", { payee_type: "employee", payee: "Noy", purpose: "Office supplies", lines: [{ account: "5260", description: "Paper", amount: 450000, receipt_no: "S-77" }] }, "Sales");
  F.submit(r.id, "Sales"); approveAll(F, Store, r.id);
  assert.equal(Acc.accountBalance("2150"), 450000);
  F.pay(r.id, "Cashier", { bank_id: bankId(Store) });
  assert.equal(Acc.accountBalance("2150"), 0);
  assert.equal(Acc.accountBalance("5260"), 450000);
});

test("locked period: final approval of a vendor payment request leaves no half-made bill", async () => {
  const { Flows: F, Store } = await freshApp();
  Store.update("settings", "company", { lock_date: "2099-12-31" });
  const v = Store.all("vendors")[0];
  const r = F.create("PAY", { payee_type: "vendor", vendor_id: v.id, purpose: "x", lines: [{ account: "5220", amount: 100000, receipt_no: "1" }] }, "Sales");
  F.submit(r.id, "Sales");
  assert.throws(() => F.approve(r.id, "Manager"), /ລັອກ/);
  assert.equal(Store.all("bills").length, 0);
  assert.equal(Store.get("requests", r.id).stage, "approval");
});

test("split warning: several small requests by one person that together exceed the first tier", async () => {
  const { Flows: F } = await freshApp();
  const mk = amt => F.create("PAY", { payee_type: "employee", payee: "Kham", purpose: "parts", lines: [{ account: "5270", amount: amt, receipt_no: "r" + amt }] }, "Sales");
  mk(3000000); mk(2500000); const third = mk(1000000);
  assert.ok(F.warnings(third).some(w => /ແບ່ງຍອດ/.test(w)));
});

/* ---------- store safety ---------- */
test("store: re-opening an existing database adds new accounts but duplicates nothing", async () => {
  const mem = {};
  const a = await freshApp({ mem });
  const n = a.Store.all("accounts").length;
  assert.ok(a.Store.get("accounts", "acc_1450"), "employee-advance account exists");
  const b = await freshApp({ mem });
  assert.equal(b.Store.all("accounts").length, n);
});

test("store (cloud mode): only NEW rows are pushed to the sheet, never the whole database again", async () => {
  const sent = [];
  const existing = { accounts: [{ id: "acc_1100", code: "1100", name: "Bank", type: "Asset", is_header: 0 }], customers: [{ id: "c1", name: "Old customer" }] };
  await freshApp({ beforeBoot: ctx => {
    ctx.ERP_CONFIG.APPS_SCRIPT_URL = "https://example.invalid/exec";
    ctx.fetch = async (url, init) => {
      const { action, payload } = JSON.parse(init.body);
      if (action === "loadAll") return { text: async () => JSON.stringify({ ok: true, data: existing }) };
      sent.push(payload.sheet + ":" + payload.row.id);
      return { text: async () => JSON.stringify({ ok: true, data: null }) };
    };
  } });
  assert.ok(!sent.includes("customers:c1"), "existing rows are not re-sent");
  assert.ok(!sent.includes("accounts:acc_1100"));
  assert.ok(sent.includes("accounts:acc_1450"), "new rows are sent");
});
