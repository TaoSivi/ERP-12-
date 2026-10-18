const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

const DOCS = { slip: { ok: true, ref: "S1" } };
async function app() {
  const c = await freshApp();
  const cb = Array.from(c.Flows.cashBankAccounts()).map(a => a.code);
  const U = (id, name, role) => c.Store.insert("users", { id, name, role, status: "active" });
  U("uA", "ທ້າວ ກ", "Manager"); U("uB", "ທ້າວ ຂ", "Manager"); U("u1", "ນາງ ຄ", "Accountant"); U("u2", "ນາງ ງ", "Accountant"); U("uR", "ນາງ ຈ", "Cashier");
  let cur = "";
  c.AppCtx = { currentUserId: () => cur }; // who is "signed in" for the next call
  const as = id => { cur = id; };
  const trf = () => c.Flows.create("TRF", { purpose: "ໂອນ", amount: 1000000, date: "2026-03-10", from: cb[0], to: cb[1] || "1000", docs: DOCS }, "Cashier");
  return { c, as, trf, U };
}

test("a step can name people: only they (or a stand-in Admin) may sign it", async () => {
  const { c, as, trf } = await app();
  c.Approval.setTypeTiers("TRF", [{ max: null, chain: [{ roles: [], users: ["uA"], need: 1 }] }]);
  as("uR"); const r = trf(); c.Flows.submit(r.id, "Cashier");
  as("uB"); assert.match(c.Flows.canAct(c.Store.get("requests", r.id), "Manager").why, /ລໍ/, "another Manager is not on the list");
  assert.throws(() => c.Flows.approve(r.id, "Manager", "", "2026-03-10"), /ລໍ/);
  as("uA"); const done = c.Flows.approve(r.id, "Manager", "", "2026-03-10");
  assert.equal(done.stage, "closed");
  assert.equal(done.approvals_done[0].user, "uA");
  assert.equal(done.approvals_done[0].name, "ທ້າວ ກ");
});

test("a step can need N different people; the same person cannot sign twice", async () => {
  const { c, as, trf } = await app();
  c.Approval.setTypeTiers("TRF", [{ max: null, chain: [{ roles: ["Accountant"], users: [], need: 2 }] }]);
  as("uR"); const r = trf(); c.Flows.submit(r.id, "Cashier");
  as("u1"); const a = c.Flows.approve(r.id, "Accountant", "", "2026-03-10");
  assert.equal(a.stage, "approval", "1 of 2 signatures is not enough");
  assert.match(c.Flows.canAct(a, "Accountant").why, /ອະນຸມັດຂັ້ນກ່ອນແລ້ວ/);
  assert.throws(() => c.Flows.approve(r.id, "Accountant", "", "2026-03-10"), /ຄົນອື່ນ/);
  as("u2"); const b = c.Flows.approve(r.id, "Accountant", "", "2026-03-10");
  assert.equal(b.stage, "closed");
  assert.equal(b.approvals_done.length, 2);
});

test("steps run in order: step 2 opens only after step 1 has its N signatures", async () => {
  const { c, as, trf } = await app();
  c.Approval.setTypeTiers("TRF", [{ max: null, chain: [{ roles: [], users: ["uA", "uB"], need: 2 }, "Accountant"] }]);
  as("uR"); const r = trf(); c.Flows.submit(r.id, "Cashier");
  as("u1"); assert.throws(() => c.Flows.approve(r.id, "Accountant", "", "2026-03-10"), /ລໍ/, "Accountant cannot jump ahead");
  as("uA"); c.Flows.approve(r.id, "Manager", "", "2026-03-10");
  let st = c.Approval.chainState(c.Store.get("requests", r.id));
  assert.equal(st.step, 0); assert.equal(st.count[0], 1);
  as("uB"); c.Flows.approve(r.id, "Manager", "", "2026-03-10");
  st = c.Approval.chainState(c.Store.get("requests", r.id));
  assert.equal(st.step, 1);
  as("u1"); assert.equal(c.Flows.approve(r.id, "Accountant", "", "2026-03-10").stage, "closed");
});

test("the person who made the request cannot sign it, even if their role is listed", async () => {
  const { c, as, trf } = await app();
  c.Approval.setTypeTiers("TRF", [{ max: null, chain: [{ roles: ["Cashier"], users: [], need: 1 }] }]);
  as("uR"); const r = trf(); c.Flows.submit(r.id, "Cashier");
  assert.equal(c.Store.get("requests", r.id).requester_user, "uR");
  assert.throws(() => c.Flows.approve(r.id, "Cashier", "", "2026-03-10"), /ຜູ້ຂໍ/);
});

test("role-only chains behave as before (no user signed in)", async () => {
  const { c, as, trf } = await app();
  as("");
  const r = trf(); c.Flows.submit(r.id, "Cashier");
  assert.equal(c.Flows.approve(r.id, "Manager", "", "2026-03-10").stage, "closed"); // default chain ≤5M = Manager
});

test("per-type chains override the default; null falls back; labels show people", async () => {
  const { c } = await app();
  const def = Array.from(c.Approval.chainFor("TRF", 1000)).join();
  c.Approval.setTypeTiers("TRF", [{ max: null, chain: ["Admin"] }]);
  assert.equal(c.Approval.chainFor("TRF", 1000)[0], "Admin");
  assert.equal(Array.from(c.Approval.chainFor("EXP", 1000)).join(), def, "other types unaffected");
  c.Approval.setTypeTiers("TRF", null);
  assert.equal(Array.from(c.Approval.chainFor("TRF", 1000)).join(), def);
  assert.equal(c.Approval.stepLabel({ roles: ["Manager"], users: ["uA"], need: 2 }), "Manager / ທ້າວ ກ ×2");
  assert.equal(c.Approval.stepLabel("Admin"), "Admin");
});

test("old records without a step number still count one signature per step", async () => {
  const { c } = await app();
  const st = c.Approval.chainState({ chain: ["Manager", "Accountant"], approvals_done: [{ role: "Manager", at: "x" }] }, "TRF", 1);
  assert.equal(st.step, 1); assert.equal(st.complete, false);
});
