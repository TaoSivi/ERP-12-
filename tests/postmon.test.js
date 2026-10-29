const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");
const je = (c, date, lines) => c.Acc.postJournal({ date, source_type: "T", memo: "t", lines: lines.map(([account, debit, credit]) => ({ account, debit, credit })) });

test("health: balanced books and matching sub-ledgers report ok; a one-sided journal row is caught", async () => {
  const c = await freshApp();
  je(c, "2026-10-01", [["1100", 1000, 0], ["3100", 0, 1000]]);
  let h = c.PostMon.health();
  assert.equal(h.unbalanced.length, 0); assert.ok(h.subledgers.every(s => s.ok), JSON.stringify(h.subledgers));
  c.Store.insert("journal_lines", { je_id: c.Store.all("journal_entries").pop().id, account: "1100", debit: 50, credit: 0 }); // tampering: a row without its pair
  assert.equal(c.PostMon.health().unbalanced.length, 1);
});

test("closePeriod: snapshots the trial balance, then locks — older dates can no longer be posted; cannot move the lock back", async () => {
  const c = await freshApp();
  je(c, "2026-09-10", [["1100", 5000, 0], ["3100", 0, 5000]]);
  const snap = c.PostMon.closePeriod("2026-09-30");
  assert.equal(snap.dr, snap.cr); assert.ok(snap.rows.some(r => r.code === "1100" && r.net === 5000));
  assert.equal(c.Store.get("settings", "company").lock_date, "2026-09-30");
  assert.throws(() => je(c, "2026-09-20", [["1100", 1, 0], ["3100", 0, 1]]), /ລັອກ/);
  assert.throws(() => c.PostMon.closePeriod("2026-08-31"), /ກ່ອນວັນລັອກ/);
  assert.equal(c.PostMon.snapshots().length, 1);
});

test("posting-rule history keeps every version; bySource counts journals per module", async () => {
  const c = await freshApp();
  c.PostMon.logRules({ REV: "4110" }, "a"); c.PostMon.logRules({ REV: "4120" }, "b");
  const h = c.PostMon.ruleHistory(); assert.equal(h.length, 2); assert.equal(h[0].rules.REV, "4120"); assert.equal(h[1].rules.REV, "4110");
  je(c, "2026-10-01", [["1100", 10, 0], ["3100", 0, 10]]);
  assert.ok(c.PostMon.bySource(365).some(s => s.source === "T" && s.count === 1));
});
