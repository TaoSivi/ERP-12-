const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

const DOCS = { slip: { ok: true, ref: "SLIP-001" } };
async function app() {
  const c = await freshApp();
  const cb = Array.from(c.Flows.cashBankAccounts()).map(a => a.code);
  assert.ok(cb.length >= 1, "demo CoA has at least one cash/bank account");
  const exp = Array.from(c.Store.where("accounts", a => a.type === "Expense" && !a.is_header))[0].code;
  return { c, from: cb[0], to: cb[1] || "1000", exp };
}
const mk = (c, over) => c.Flows.create("TRF", Object.assign({ purpose: "ຖອນເງິນເຂົ້າຄັງ", amount: 2000000, date: "2026-03-10", docs: DOCS }, over), "Cashier");

test("voucher numbers: KIND-ENTITY-CCY-MONYY-SEQ, sequence restarts each month", async () => {
  const { c } = await app();
  c.Store.update("settings", "company", { entity_code: "lt" });
  const a = c.Acc.nextVoucher("PV", "requests", "2025-12-04", "LAK");
  assert.equal(a, "PV-LT-LAK-DEC25-001");
  assert.equal(c.Acc.nextVoucher("RV", "requests", "2025-12-04", "usd"), "RV-LT-USD-DEC25-001");
  assert.equal(c.Acc.nextVoucher("PV", "requests", "2026-01-02", "LAK"), "PV-LT-LAK-JAN26-001");
});

test("transfer: needs documents, then approve posts Dr destination / Cr source and closes", async () => {
  const { c, from, to } = await app();
  c.Store.update("settings", "company", { entity_code: "LT" });
  const r = mk(c, { from, to, docs: undefined });
  assert.match(r.number, /^GL-LT-LAK-MAR26-001$/);
  assert.throws(() => c.Flows.submit(r.id, "Cashier"), /ເອກະສານແນບຍັງບໍ່ຄົບ/);
  c.Flows.setDocs(r.id, { slip: { ok: true, ref: "" } }, "Cashier");
  assert.throws(() => c.Flows.submit(r.id, "Cashier"), /ເອກະສານແນບ/, "ticked but no reference is still missing");
  c.Flows.setDocs(r.id, DOCS, "Cashier");
  c.Flows.submit(r.id, "Cashier");
  const before = [c.Acc.accountBalance(from), c.Acc.accountBalance(to)];
  const done = c.Flows.approve(r.id, "Manager", "", "2026-03-10");
  assert.equal(done.stage, "closed");
  assert.ok(done.je_id);
  assert.equal(c.Acc.accountBalance(to) - before[1], 2000000);
  assert.equal(c.Acc.accountBalance(from) - before[0], -2000000);
});

test("transfer: validation (same account, no amount)", async () => {
  const { c, from } = await app();
  assert.throws(() => mk(c, { from, to: from }), /ຕ່າງກັນ/);
  assert.throws(() => mk(c, { from, to: "1000", amount: 0 }), /ຈຳນວນເງິນ/);
});

test("bank fee posts Dr expense / Cr bank", async () => {
  const { c, from, exp } = await app();
  const r = c.Flows.create("FEE", { purpose: "ຄ່າທຳນຽມ ມີນາ", amount: 30700, date: "2026-03-31", bank: from, expense: exp, docs: { stmt: { ok: true, ref: "STMT-03" } } }, "Cashier");
  c.Flows.submit(r.id, "Cashier");
  const e0 = c.Acc.accountBalance(exp);
  c.Flows.approve(r.id, "Manager", "", "2026-03-31");
  assert.equal(Math.abs(c.Acc.accountBalance(exp) - e0), 30700);
});

test("approval in a locked period is refused and nothing is written", async () => {
  const { c, from, to } = await app();
  const r = mk(c, { from, to });
  c.Flows.submit(r.id, "Cashier");
  c.Store.update("settings", "company", { lock_date: "2026-03-31" });
  const jes = c.Store.all("journal_entries").length;
  assert.throws(() => c.Flows.approve(r.id, "Manager", "", "2026-03-10"));
  assert.equal(c.Store.all("journal_entries").length, jes);
  assert.equal(c.Store.get("requests", r.id).stage, "approval");
  assert.equal(c.Store.get("requests", r.id).approvals_done.length, 0);
});

test("documents on existing types are optional until Settings turns the rule on", async () => {
  const { c } = await app();
  const adv = c.Flows.create("ADV", { purpose: "ເດີນທາງ", payee: "ນາງ ກ", amount: 1000000 }, "Cashier");
  c.Flows.submit(adv.id, "Cashier"); // default: no evidence required
  c.Store.insert("settings", { id: "flows", require_docs: true });
  const adv2 = c.Flows.create("ADV", { purpose: "ເດີນທາງ 2", payee: "ນາງ ຂ", amount: 1000000 }, "Cashier");
  assert.throws(() => c.Flows.submit(adv2.id, "Cashier"), /ເອກະສານແນບຍັງບໍ່ຄົບ/);
  c.Flows.setDocs(adv2.id, { form: { ok: true, ref: "F-1" }, id: { ok: true, ref: "ID-9" } }, "Cashier");
  c.Flows.submit(adv2.id, "Cashier");
});

test("documents cannot be edited after approval is finished", async () => {
  const { c, from, to } = await app();
  const r = mk(c, { from, to });
  c.Flows.submit(r.id, "Cashier");
  c.Flows.approve(r.id, "Manager", "", "2026-03-10");
  assert.throws(() => c.Flows.setDocs(r.id, DOCS, "Cashier"), /ແກ້ເອກະສານແນບບໍ່ໄດ້/);
});
