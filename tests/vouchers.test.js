const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

const DOCS = { slip: { ok: true, ref: "SLIP-001" } };
async function app() {
  const c = await freshApp();
  c.Store.insert("accounts", { id: "acc_1110", code: "1110", name: "ເງິນສົດໜ້າຮ້ານ", type: "Asset", is_header: 0, is_active: 1 }); // second cash/bank account (the engine now refuses header accounts)
  const cb = Array.from(c.Flows.cashBankAccounts()).map(a => a.code);
  assert.ok(cb.length >= 1, "demo CoA has at least one cash/bank account");
  const exp = Array.from(c.Store.where("accounts", a => a.type === "Expense" && !a.is_header))[0].code;
  return { c, from: cb[0], to: cb[1] || "1000", exp };
}
const mk = (c, over) => c.Flows.create("TRF", Object.assign({ purpose: "ຖອນເງິນເຂົ້າຄັງ", amount: 2000000, date: "2026-03-10", docs: DOCS }, over), "Cashier");

test("voucher numbers: KIND-ENTITY-MONYY-SEQ (2026 style, no currency); sequence restarts each month and per kind", async () => {
  const { c } = await app();
  c.Store.update("settings", "company", { entity_code: "lt" });
  assert.equal(c.Acc.nextVoucher("PV", "requests", "2025-12-04"), "PV-LT-DEC25-001");
  assert.equal(c.Acc.nextVoucher("RV", "requests", "2025-12-04"), "RV-LT-DEC25-001");
  assert.equal(c.Acc.nextVoucher("PV", "requests", "2026-01-02"), "PV-LT-JAN26-001");
});

test("transfer: needs documents, then approve posts Dr destination / Cr source and closes", async () => {
  const { c, from, to } = await app();
  c.Store.update("settings", "company", { entity_code: "LT" });
  const r = mk(c, { from, to, docs: undefined });
  assert.match(r.number, /^JV-LT-MAR26-001$/);
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

/* ---------- step 2: multi-line vouchers, currency + rate, new types ---------- */
// approve through the whole chain (large amounts need several roles); returns the closed request
const approveAll = (c, id, date) => { let r = c.Store.get("requests", id); for (const role of Array.from(r.chain)) r = c.Flows.approve(id, role, "", date); return r; };
const lineAcc = (c, f) => Array.from(c.Store.where("accounts", a => !a.is_header && f(a)))[0].code;

test("EXP: several lines, one bank credit, balanced; paid in USD at a per-voucher rate", async () => {
  const { c, from } = await app();
  const e1 = lineAcc(c, a => a.type === "Expense"), e2 = Array.from(c.Store.where("accounts", a => !a.is_header && a.type === "Expense"))[1].code;
  const r = c.Flows.create("EXP", { purpose: "ຄ່າລົດ", date: "2026-01-06", bank: from, ccy: "USD", rate: 21555,
    lines: [{ account: e1, memo: "ງວດ 21", orig: 1158 }, { account: e2, memo: "ງວດ 21 (2)", orig: 498 }], docs: { bill: { ok: true, ref: "B217037" }, pv: { ok: true, ref: "PV-1" } } }, "Cashier");
  assert.equal(r.amount, Math.round(1158 * 21555) + Math.round(498 * 21555));
  assert.equal(r.vlines.length, 2);
  c.Flows.submit(r.id, "Cashier");
  const jes = c.Store.all("journal_entries").length;
  approveAll(c, r.id, "2026-01-06");
  assert.equal(c.Store.all("journal_entries").length, jes + 1);
  const je = c.Store.get("journal_entries", c.Store.get("requests", r.id).je_id);
  assert.equal(je.total_debit, je.total_credit);
  assert.equal(je.total_debit, r.amount);
});

test("EXP: foreign currency needs a rate; an account must come from the allowed list; at least one line", async () => {
  const { c, from } = await app();
  const e1 = lineAcc(c, a => a.type === "Expense");
  const base = { purpose: "x", bank: from, lines: [{ account: e1, orig: 100 }] };
  assert.throws(() => c.Flows.create("EXP", Object.assign({}, base, { ccy: "THB" }), "Cashier"), /ອັດຕາ/);
  assert.throws(() => c.Flows.create("EXP", Object.assign({}, base, { lines: [{ account: "9999", orig: 100 }] }), "Cashier"), /ບັນຊີ/);
  assert.throws(() => c.Flows.create("EXP", Object.assign({}, base, { lines: [] }), "Cashier"), /ຢ່າງໜ້ອຍ 1/);
  assert.throws(() => c.Flows.create("EXP", Object.assign({}, base, { lines: [{ account: from, orig: 100 }] }), "Cashier"), /ບັນຊີ/, "cash/bank is not a valid expense line (use a transfer)");
});

test("RCV: Dr bank / Cr each line", async () => {
  const { c, from } = await app();
  const inc = lineAcc(c, a => a.type === "Revenue");
  const r = c.Flows.create("RCV", { purpose: "ດອກເບ້ຍທະນາຄານ", date: "2026-01-05", bank: from, lines: [{ account: inc, memo: "ດອກເບ້ຍ LDB", orig: 726500 }], docs: { advice: { ok: true, ref: "R896461" } } }, "Cashier");
  assert.match(r.number, /^RV-MAIN-JAN26-001$/);
  c.Flows.submit(r.id, "Cashier");
  const b0 = c.Acc.accountBalance(from);
  c.Flows.approve(r.id, "Manager", "", "2026-01-05");
  assert.equal(c.Acc.accountBalance(from) - b0, 726500);
});

test("FXX: buying USD with LAK posts the rate difference to FX gain/loss and balances", async () => {
  const { c, from, to } = await app();
  const r = c.Flows.create("FXX", { purpose: "ແລກປ່ຽນ", date: "2026-01-08", ccy: "USD", rate: 21800, dir: "buy", from, to, orig: 3000, amount: 65000000,
    docs: { slip: { ok: true, ref: "S1" }, rate: { ok: true, ref: "BOL 08/01" } } }, "Cashier");
  c.Flows.submit(r.id, "Cashier");
  approveAll(c, r.id, "2026-01-08");
  const je = c.Store.get("journal_entries", c.Store.get("requests", r.id).je_id);
  assert.equal(je.total_debit, je.total_credit);
  assert.equal(je.total_debit, 65400000); // 3000 x 21800 received; 65,000,000 paid; 400,000 difference is FX
  assert.throws(() => c.Flows.create("FXX", { purpose: "x", ccy: "LAK", dir: "buy", from, to, orig: 1, amount: 1 }, "Cashier"), /ເງິນຕາຕ່າງປະເທດ/);
});

test("PRJ and LSE accept only their account families; approvers see rate and round-amount warnings", async () => {
  const { c, from } = await app();
  const liab = lineAcc(c, a => a.type === "Liability");
  const lse = c.Flows.create("LSE", { purpose: "ງວດ", bank: from, lines: [{ account: liab, orig: 1000000 }], docs: { notice: { ok: true, ref: "N" }, slip: { ok: true, ref: "S" } } }, "Cashier");
  assert.ok(lse.vlines.length === 1);
  const asset = lineAcc(c, a => a.type === "Revenue");
  assert.throws(() => c.Flows.create("LSE", { purpose: "x", bank: from, lines: [{ account: asset, orig: 1 }] }, "Cashier"), /ບັນຊີ/);
  c.Store.insert("fx_rates", { currency: "USD", rate: 21500, date: "2026-01-01" });
  const exp = lineAcc(c, a => a.type === "Expense");
  const r = c.Flows.create("PRJ", { purpose: "ໂຄງການ", bank: from, ccy: "USD", rate: 24000, lines: [{ account: exp, orig: 2500 }], docs: { bill: { ok: true, ref: "B" }, pv: { ok: true, ref: "P" } } }, "Cashier");
  const w = Array.from(c.Flows.warnings(r));
  assert.ok(w.some(x => /2%/.test(x)), "rate far from the stored rate");
  assert.ok(w.some(x => /ຍອດກົມ/.test(x)), "60,000,000 is a round amount >= 50M");
});
