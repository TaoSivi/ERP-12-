const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

const post = (c, type, amt, acct = "5200") => c.Acc.postJournal({ date: "2026-03-01", source_type: type, source_id: "x" + Math.random(), memo: "t", lines: [{ account: acct, debit: amt, credit: 0 }, { account: "1100", debit: 0, credit: amt }] });

test("journals are flagged for review by source type, by amount and by a flagged category", async () => {
  const c = await freshApp();
  assert.equal(post(c, "BILL", 1000).review, "pending");
  assert.equal(post(c, "INVOICE", 1000).review, undefined);
  c.Store.insert("settings", { id: "review", types: [], min: 5000 });
  assert.equal(post(c, "BILL", 1000).review, undefined);
  assert.equal(post(c, "INVOICE", 6000).review, "pending");
  c.Cat.save([{ name: "ຄ່າຮັບແຂກ", kind: "expense", account: "5200", review: true }]);
  assert.equal(post(c, "INVOICE", 10, "5200").review, "pending");
});

test("finance confirms a journal; the pending list shrinks", async () => {
  const c = await freshApp();
  const je = post(c, "BILL", 1000);
  assert.equal(c.Review.pending().length, 1);
  c.Review.confirm(je.id);
  assert.equal(c.Review.pending().length, 0);
  assert.equal(c.Store.get("journal_entries", je.id).review, "confirmed");
  assert.throws(() => c.Review.confirm(je.id), /ບໍ່ໄດ້ລໍກວດ/);
});

test("a correction goes through the approval gate, then reverses the old entry and posts the new one", async () => {
  const c = await freshApp();
  const je = post(c, "BILL", 1000, "5200");
  const lines = c.Store.where("journal_lines", l => l.je_id === je.id).map(l => ({ account: l.account === "5200" ? "5300" : l.account, debit: l.debit, credit: l.credit }));
  const r = c.Gate.submit("JEFIX", { je_id: je.id, lines, reason: "ຜິດໝວດ" }, "Accountant", { key: "JEFIX:" + je.id });
  assert.equal(r.pending, true); // the switch is ON by default
  assert.equal(c.Store.get("journal_entries", je.id).status, "posted"); // nothing changes before approval
  c.Gate.approve(r.doc.id, "Manager");
  assert.equal(c.Gate.get(r.doc.id).status, "posted");
  assert.equal(c.Store.get("journal_entries", je.id).status, "reversed");
  const bal = code => c.Acc.accountBalance(code);
  assert.equal(bal("5200"), 0);
  assert.equal(bal("5300"), 1000);
});

test("staff see categories (names) and ledger roles see account codes", async () => {
  const c = await freshApp();
  c.Cat.save([{ name: "ຄ່ານ້ຳມັນ", kind: "expense", account: "5200", review: false }]);
  const all = c.Store.where("accounts", a => a.type === "Expense" && !a.is_header);
  assert.ok(all.length > 1);
  c.Perms.configure({ base: { Sales: ["dashboard"], Accountant: ["gl"] }, modules: [["gl", "GL"]] });
  c.AppCtx = { currentRole: () => "Sales" };
  assert.deepEqual(Array.from(c.Cat.accounts(all, "expense")).map(a => a.code), ["5200"]);
  assert.equal(c.Cat.label(all.find(a => a.code === "5200"), "expense"), "ຄ່ານ້ຳມັນ");
  c.AppCtx = { currentRole: () => "Accountant" };
  assert.equal(c.Cat.accounts(all, "expense").length, all.length);
});
