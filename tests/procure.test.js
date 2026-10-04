// Procure-to-Pay process. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

function balanced(Acc, Store) {
  let dr = 0, cr = 0;
  const ok = new Set(Store.all("journal_entries").filter(j => j.status === "posted" || j.status === "reversed").map(j => j.id));
  Store.all("journal_lines").filter(l => ok.has(l.je_id)).forEach(l => { dr += l.debit; cr += l.credit; });
  return Acc.round(dr) === Acc.round(cr);
}
const jeCount = S => S.all("journal_entries").length;

async function setup() {
  const app = await freshApp();
  const { Store } = app;
  const water = Store.where("items", i => i.type === "stock")[0];
  const v1 = Store.all("vendors")[0];
  const v2 = Store.insert("vendors", { name: "Vendor B", currency: "LAK" });
  const v3 = Store.insert("vendors", { name: "Vendor C", currency: "LAK" });
  return Object.assign(app, { water, v1, v2, v3 });
}
// stock line 10 x 20,000 + a laptop (fixed asset) 1 x 8,000,000  = 8,200,000 estimated
function newCase(P, water) {
  return P.create({ requester: "Somchai", dept: "Office", purpose: "ອຸປະກອນຫ້ອງການ", lines: [
    { item_id: water.id, kind: "stock", qty: 10, price: 20000 },
    { description: "Laptop", kind: "asset", qty: 1, price: 8000000 }
  ] }, "Sales");
}

test("full happy path: request → approvals → GRN → bill → pay, with the right journals at the right steps", async () => {
  const { Procure: P, Acc, Store, water, v1, v2 } = await setup();
  const c = newCase(P, water);
  assert.equal(P.stageOf(c), "draft");
  const je0 = jeCount(Store);

  P.submit(c.id, "Sales");
  P.approvePR(c.id, "Manager", "ok");
  assert.equal(P.stageOf(Store.get("purchase_requisitions", c.id)), "pr_approval", "8.2M → matrix needs a 2nd approver");
  P.approvePR(c.id, "Accountant", "budget ok");
  P.addQuote(c.id, { vendor_id: v1.id, amount: 8200000, days: 3 }, "Purchasing");
  P.addQuote(c.id, { vendor_id: v2.id, amount: 8100000, days: 5 }, "Purchasing");
  const po = P.createPO(c.id, "Purchasing");               // < 10M threshold → 1 quote is enough; cheapest pre-selected
  assert.equal(po.vendor_id, v2.id, "cheapest quote selected");
  assert.equal(po.total, 8100000);
  assert.equal(jeCount(Store), je0, "PR / quotes / PO post NOTHING to the ledger");

  P.approvePO(c.id, "Manager");
  assert.equal(P.stageOf(Store.get("purchase_requisitions", c.id)), "receiving");
  assert.equal(jeCount(Store), je0, "approved PO still posts nothing");

  // GRN – everything at once
  const lines = Store.where("po_lines", l => l.po_id === po.id);
  P.receive(c.id, "Warehouse", { date: new Date().toISOString().slice(0, 10), receipt: lines.map(l => ({ po_line_id: l.id, qty: l.qty })) });
  assert.equal(jeCount(Store), je0 + 1, "GRN posts one journal");
  assert.equal(Acc.accountBalance("1500"), -8100000, "GR/IR credited (liability-like balance on an asset account)");
  assert.equal(Acc.accountBalance("1700") > 0, true, "laptop capitalised as fixed asset");
  assert.equal(Store.all("assets").some(a => a.source === "GRN"), true, "asset register entry created");
  assert.equal(Acc.stockQty(water.id), 110, "stock increased by 10");
  assert.equal(P.stageOf(Store.get("purchase_requisitions", c.id)), "invoicing");

  // Bill at PO prices, no VAT → GR/IR cleared
  const bill = P.prepareBill(c.id, "Accountant", { vendor_ref: "INV-778", vat: false, lines: lines.map(l => { const pl = Store.get("po_lines", l.id); return { po_line_id: l.id, qty: pl.qty, price: pl.price }; }) });
  assert.deepEqual(Array.from(P.matchFindings(bill)), [], "3-way match clean");
  P.finishBill(c.id, bill.id, "Accountant");
  assert.equal(Acc.accountBalance("1500"), 0, "GR/IR cleared by the bill");
  assert.equal(Acc.accountBalance("2100"), 8100000, "AP");
  assert.equal(P.stageOf(Store.get("purchase_requisitions", c.id)), "paying");

  P.pay(c.id, "Cashier", { bank_id: Store.all("bank_accounts")[0].id, amount: 8100000 });
  assert.equal(Acc.accountBalance("2100"), 0);
  assert.equal(P.stageOf(Store.get("purchase_requisitions", c.id)), "closed");
  assert.ok(balanced(Acc, Store));
  assert.ok(Store.where("approvals", a => a.doc_id === c.id).length >= 8, "every step is in the audit trail");
});

test("roles: only the right role can act, and nobody approves their own step", async () => {
  const { Procure: P, Store, water, v1 } = await setup();
  const c = newCase(P, water);
  P.submit(c.id, "Manager");
  assert.throws(() => P.approvePR(c.id, "Sales"), /ລໍຖ້າ/, "Sales cannot approve");
  assert.throws(() => P.approvePR(c.id, "Manager"), /ອະນຸມັດເອງບໍ່ໄດ້/, "submitter role cannot approve own request");
  P.approvePR(c.id, "Admin");                                   // Admin stands in for step 1 (Manager)
  assert.throws(() => P.approvePR(c.id, "Admin"), /ອະນຸມັດຂັ້ນກ່ອນແລ້ວ/, "one role approves at most one step");
  P.approvePR(c.id, "Accountant");
  P.addQuote(c.id, { vendor_id: v1.id, amount: 8200000 }, "Manager");
  P.createPO(c.id, "Manager");
  assert.throws(() => P.approvePO(c.id, "Manager"), /ອະນຸມັດ PO ເອງບໍ່ໄດ້/);
  P.approvePO(c.id, "Admin");
  assert.equal(P.stageOf(Store.get("purchase_requisitions", c.id)), "receiving");
});

test("PO above approval_limit needs Admin", async () => {
  const { Procure: P, Store, water, v1 } = await setup();
  Store.update("settings", "company", { approval_limit: 5000000 });
  const c = newCase(P, water);
  P.submit(c.id, "Sales"); P.approvePR(c.id, "Manager"); P.approvePR(c.id, "Accountant");
  P.addQuote(c.id, { vendor_id: v1.id, amount: 8200000 }, "Purchasing");
  P.createPO(c.id, "Purchasing");
  assert.throws(() => P.approvePO(c.id, "Manager"), /Admin/);
  P.approvePO(c.id, "Admin");
});

test("quotes: big purchases need 3 quotes (or a reason); picking a dearer quote needs a reason", async () => {
  const { Procure: P, Store, water, v1, v2 } = await setup();
  const c = P.create({ purpose: "Server", lines: [{ description: "Server", kind: "asset", qty: 1, price: 30000000 }] }, "Sales");
  P.submit(c.id, "Sales");
  assert.deepEqual(Array.from(Store.get("purchase_requisitions", c.id).chain), ["Manager", "Accountant", "Admin"], "> 20M → 3-step chain");
  P.approvePR(c.id, "Manager"); P.approvePR(c.id, "Accountant"); P.approvePR(c.id, "Admin");
  P.addQuote(c.id, { vendor_id: v1.id, amount: 30000000 }, "Purchasing");
  assert.throws(() => P.createPO(c.id, "Purchasing"), /ຕ້ອງມີ 3 ໃບສະເໜີ/);
  P.addQuote(c.id, { vendor_id: v2.id, amount: 29000000 }, "Purchasing");
  const q1 = Store.where("pr_quotes", q => q.vendor_id === v1.id)[0];
  P.selectQuote(c.id, q1.id, "Purchasing");
  assert.throws(() => P.createPO(c.id, "Purchasing", "ok"), /ເຫດຜົນ/, "reason too short");
  const po = P.createPO(c.id, "Purchasing", "ຜູ້ສະໜອງ B ບໍ່ມີປະກັນ 3 ປີ");
  assert.equal(po.vendor_id, v1.id);
  assert.ok(Store.where("approvals", a => a.doc_id === c.id && a.action === "create_po")[0].note.includes("ປະກັນ"));
});

test("partial receipt keeps the case in receiving; over-receipt is refused; short-close moves on", async () => {
  const { Procure: P, Store, water, v1 } = await setup();
  const c = P.create({ purpose: "Water", lines: [{ item_id: water.id, kind: "stock", qty: 10, price: 20000 }] }, "Sales");
  P.submit(c.id, "Sales"); P.approvePR(c.id, "Manager");
  P.addQuote(c.id, { vendor_id: v1.id, amount: 200000 }, "Purchasing");
  const po = P.createPO(c.id, "Purchasing"); P.approvePO(c.id, "Manager");
  const l = Store.where("po_lines", x => x.po_id === po.id)[0];
  P.receive(c.id, "Warehouse", { receipt: [{ po_line_id: l.id, qty: 4 }] });
  assert.equal(P.stageOf(Store.get("purchase_requisitions", c.id)), "receiving");
  assert.equal(Store.get("purchase_orders", po.id).status, "partial");
  assert.throws(() => P.receive(c.id, "Warehouse", { receipt: [{ po_line_id: l.id, qty: 7 }] }), /ເກີນ/);
  P.shortClose(c.id, "Purchasing", "ຜູ້ສະໜອງໝົດສິນຄ້າ");
  assert.equal(P.stageOf(Store.get("purchase_requisitions", c.id)), "invoicing");
});

test("3-way match: billing more than received or a price gap is flagged by the Guard as needing a manager", async () => {
  const { Procure: P, Guard, Store, water, v1 } = await setup();
  const c = P.create({ purpose: "Water", lines: [{ item_id: water.id, kind: "stock", qty: 10, price: 20000 }] }, "Sales");
  P.submit(c.id, "Sales"); P.approvePR(c.id, "Manager");
  P.addQuote(c.id, { vendor_id: v1.id, amount: 200000 }, "Purchasing");
  const po = P.createPO(c.id, "Purchasing"); P.approvePO(c.id, "Manager");
  const l = Store.where("po_lines", x => x.po_id === po.id)[0];
  P.receive(c.id, "Warehouse", { receipt: [{ po_line_id: l.id, qty: 10 }] });
  const bill = P.prepareBill(c.id, "Accountant", { vendor_ref: "X1", vat: false, lines: [{ po_line_id: l.id, qty: 12, price: 23000 }] });
  const rules = Array.from(Guard.review("bill", bill).findings, f => f.rule).sort();
  assert.deepEqual(rules, ["PO_PRICE", "PO_QTY"]);
  assert.equal(Guard.review("bill", bill).needsApprover, true);
});

test("a cancelled guard leaves no draft bill behind; reject PO goes back to sourcing", async () => {
  const { Procure: P, Store, water, v1 } = await setup();
  const c = P.create({ purpose: "Water", lines: [{ item_id: water.id, kind: "stock", qty: 1, price: 20000 }] }, "Sales");
  P.submit(c.id, "Sales"); P.approvePR(c.id, "Manager");
  P.addQuote(c.id, { vendor_id: v1.id, amount: 20000 }, "Purchasing");
  P.createPO(c.id, "Purchasing");
  assert.throws(() => P.rejectPO(c.id, "Manager", ""), /ເຫດຜົນ/);
  P.rejectPO(c.id, "Manager", "ລາຄາແພງ");
  assert.equal(P.stageOf(Store.get("purchase_requisitions", c.id)), "sourcing");
  const po = P.createPO(c.id, "Purchasing"); P.approvePO(c.id, "Manager");
  const l = Store.where("po_lines", x => x.po_id === po.id)[0];
  P.receive(c.id, "Warehouse", { receipt: [{ po_line_id: l.id, qty: 1 }] });
  const bill = P.prepareBill(c.id, "Accountant", { vendor_ref: "Y", vat: true, lines: [{ po_line_id: l.id, qty: 1, price: 20000 }] });
  P.discardBill(bill.id);
  assert.equal(Store.get("bills", bill.id), null);
  assert.equal(Store.where("bill_lines", x => x.bill_id === bill.id).length, 0);
});

test("queue: each role sees only the cases waiting for them", async () => {
  const { Procure: P, water } = await setup();
  const c = newCase(P, water);
  P.submit(c.id, "Sales");
  assert.equal(P.queue("Manager").length, 1);
  assert.equal(P.queue("Warehouse").length, 0);
  assert.equal(P.queue("Sales").length, 0, "submitter does not see own approval");
});

test("goods receipt in a locked period is refused before anything is written", async () => {
  const { Procure: P, Store, water, v1 } = await setup();
  const c = P.create({ purpose: "Water", lines: [{ item_id: water.id, kind: "stock", qty: 1, price: 20000 }] }, "Sales");
  P.submit(c.id, "Sales"); P.approvePR(c.id, "Manager");
  P.addQuote(c.id, { vendor_id: v1.id, amount: 20000 }, "Purchasing");
  const po = P.createPO(c.id, "Purchasing"); P.approvePO(c.id, "Manager");
  Store.update("settings", "company", { lock_date: "2026-12-31" });
  const l = Store.where("po_lines", x => x.po_id === po.id)[0];
  assert.throws(() => P.receive(c.id, "Warehouse", { date: "2026-06-01", receipt: [{ po_line_id: l.id, qty: 1 }] }), /ລັອກ/);
  assert.equal(Store.all("grns").length, 0);
  assert.equal(Store.get("po_lines", l.id).received_qty, 0);
});

test("regression: quote ≠ estimate over several lines still books whole kip and clears GR/IR exactly", async () => {
  const { Procure: P, Acc, Store, water, v1 } = await setup();
  // same shape as the browser run that exposed a 0.02 kip drift: asset 9,000,000 + 20 × 22,000, quote 9,300,000
  const c = P.create({ purpose: "Laptop + water", lines: [
    { description: "Laptop", kind: "asset", qty: 1, price: 9000000 },
    { item_id: water.id, kind: "stock", qty: 20, price: 22000 }
  ] }, "Sales");
  P.submit(c.id, "Sales"); P.approvePR(c.id, "Manager"); P.approvePR(c.id, "Accountant");
  P.addQuote(c.id, { vendor_id: v1.id, amount: 9300000 }, "Purchasing");
  const po = P.createPO(c.id, "Purchasing"); P.approvePO(c.id, "Manager");
  const lines = Store.where("po_lines", l => l.po_id === po.id);
  assert.equal(lines.reduce((s, l) => s + l.line_total, 0), 9300000, "line totals add up to the quote");
  lines.forEach(l => assert.equal(Number.isInteger(l.line_total), true, "whole kip per line"));
  P.receive(c.id, "Warehouse", { receipt: lines.map(l => ({ po_line_id: l.id, qty: l.qty })) });
  assert.equal(Acc.accountBalance("1500"), -9300000);
  // bill exactly as the UI builds it: amount per line, price = amount / qty
  const bill = P.prepareBill(c.id, "Accountant", { vendor_ref: "R1", vat: true, lines: lines.map(l => { const amt = Math.round(l.qty * l.price); return { po_line_id: l.id, qty: l.qty, price: amt / l.qty }; }) });
  assert.deepEqual(Array.from(P.matchFindings(bill)), []);
  P.finishBill(c.id, bill.id, "Accountant");
  assert.equal(Acc.accountBalance("1500"), 0, "GR/IR exactly cleared");
  assert.equal(Acc.accountBalance("2100"), 10230000, "AP = 9,300,000 + 10% VAT, no fractions");
  assert.ok(balanced(Acc, Store));
});
