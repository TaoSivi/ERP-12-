const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { freshApp } = require("./helpers");

// a real response of the POS server (?hq=acct) for the restaurant "ຕ່າວ", 1–17 Oct 2026
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "pos-acct-v1.json"), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o));
const days = r => r.branches[0].days;
const sum = o => Object.keys(o || {}).reduce((s, k) => s + o[k], 0);

async function app(resp) {
  const c = await freshApp();
  c.Posin.setTransport(async () => clone(resp || FIX));
  c.Posin.setLink({ url: "http://pos.test/api/b1", auto: true, hold_on_warn: true }, "tok");
  return c;
}
const posJEs = c => c.Store.all("journal_entries").filter(j => j.source_type === "POS_DAILY");
const adjJEs = c => c.Store.all("journal_entries").filter(j => j.source_type === "POS_ADJ");

test("every day of a real POS month turns into a balanced journal", async () => {
  const c = await app();
  const d = days(FIX), keys = Object.keys(d);
  assert.equal(keys.length, 17);
  keys.forEach(k => { const L = Array.from(c.Posin.buildLines(d[k])), t = c.Posin.totals(L); assert.equal(t.dr, t.cr, k + " does not balance"); assert.ok(L.length > 4); });
});

test("one day in detail: payments Dr, sales by category / service / VAT Cr, COGS, purchases into inventory, till expenses", async () => {
  const c = await app();
  const o = days(FIX)["2026-10-01"], L = Array.from(c.Posin.buildLines(o)), by = a => L.filter(l => l.account === a).reduce((s, l) => s + l.debit - l.credit, 0);
  assert.equal(by("1110"), o.pay["ເງິນສົດ"] - o.refunds - sum(o.expenses) + o.cashDiff, "drawer: cash in, refunds out, all till expenses out");
  assert.equal(by("1120"), o.pay["ບັດ"], "card sales wait in the clearing account");
  assert.equal(by("1100"), o.pay["BCEL OnePay"]);
  assert.equal(-by("4110"), o.byCat["ອາຫານ"]); assert.equal(-by("4120"), o.byCat["ເຄື່ອງດື່ມ"]);
  assert.equal(-by("4300"), o.svc); assert.equal(-by(c.Acc.PA("VAT_OUT")), o.vat); assert.equal(-by("4200"), o.fees);
  assert.equal(by(c.Acc.PA("AR")), o.credit); assert.equal(by(c.Acc.PA("COGS")), o.cogs);
  assert.equal(by("5210"), o.expenses["ຄ່າເຊົ່າ"]); assert.equal(by("5220"), o.expenses["ໄຟຟ້າ-ນ້ຳ-ເນັດ"]);
  assert.equal(by(c.Acc.PA("INV")), o.expenses["ວັດຖຸດິບ/ສິນຄ້າ"] - o.cogs, "purchases go INTO inventory, COGS comes out");
});

test("sync posts the clean days by itself and holds the odd ones; nothing is posted twice", async () => {
  const c = await app();
  const r = await c.Posin.sync({ all: true });
  assert.equal(r.added, 17);
  assert.equal(r.posted + r.held + r.blocked, 17);
  assert.equal(r.blocked, 0);
  assert.ok(r.posted > 0, "clean days are posted without anyone touching them");
  const n = posJEs(c).length; assert.equal(n, r.posted);
  const r2 = await c.Posin.sync({ all: true });
  assert.equal(r2.added, 0); assert.equal(r2.same, 17); assert.equal(r2.posted, 0);
  assert.equal(posJEs(c).length, n, "second pull posted nothing new");
});

test("held days wait for a person; approving posts them, skipping does not", async () => {
  const resp = clone(FIX); days(resp)["2026-10-02"].cashDiff = -250000; days(resp)["2026-10-03"].cashDiff = 180000;
  const c = await app(resp); await c.Posin.sync({ all: true });
  const a = c.Posin.recOf("b1", "2026-10-02"), b = c.Posin.recOf("b1", "2026-10-03");
  assert.equal(a.status, "held"); assert.match(a.issues[0].msg, /ເງິນສົດຂາດ 250,000/);
  assert.equal(c.Store.where("journal_entries", j => j.source_id === a.id).length, 0);
  c.Posin.post(a.id, "Accountant");
  assert.equal(c.Posin.recOf("b1", "2026-10-02").status, "posted");
  c.Posin.skip(b.id, "ນັບຜິດ", "Accountant");
  assert.equal(c.Posin.recOf("b1", "2026-10-03").status, "skipped");
  await c.Posin.sync({ all: true }); // a skipped day stays skipped
  assert.equal(c.Posin.recOf("b1", "2026-10-03").status, "skipped");
  assert.equal(c.Posin.recOf("b1", "2026-10-02").status, "posted");
});

test("a day that does not balance is blocked with the reason and posts nothing", async () => {
  const resp = clone(FIX); days(resp)["2026-10-04"].pay["BCEL OnePay"] += 12345; // cash collected no longer matches the bills
  const c = await app(resp); await c.Posin.sync({ all: true });
  const r = c.Posin.recOf("b1", "2026-10-04");
  assert.equal(r.status, "blocked"); assert.match(r.issues.find(i => i.level === "block").msg, /ບໍ່ສົມດຸນ/);
  assert.equal(c.Store.where("journal_entries", j => j.source_id === r.id).length, 0);
  assert.throws(() => c.Posin.post(r.id, "Admin"), /ບໍ່ສົມດຸນ/, "even a manual approve cannot post an unbalanced day");
});

test("a locked period blocks the day; unlocking lets the next sync post it", async () => {
  const c = await app();
  c.Store.update("settings", "company", { lock_date: "2026-10-05" });
  await c.Posin.sync({ all: true });
  assert.equal(c.Posin.recOf("b1", "2026-10-05").status, "blocked");
  assert.notEqual(c.Posin.recOf("b1", "2026-10-06").status, "blocked");
  c.Store.update("settings", "company", { lock_date: "" });
  await c.Posin.sync({ all: true });
  assert.notEqual(c.Posin.recOf("b1", "2026-10-05").status, "blocked");
});

test("today is never posted (the day is not finished)", async () => {
  const resp = clone(FIX); resp.today = "2026-10-10";
  const c = await app(resp); const r = await c.Posin.sync({ all: true });
  assert.equal(r.skippedOpen, 8); assert.equal(c.Posin.recOf("b1", "2026-10-10"), null); assert.ok(c.Posin.recOf("b1", "2026-10-09"));
});

test("POS corrects a posted day: only the difference is posted, as an adjustment; same data again changes nothing", async () => {
  const c = await app(); await c.Posin.sync({ all: true });
  const id = "b1:2026-10-07";
  if (c.Posin.recOf("b1", "2026-10-07").status !== "posted") c.Posin.post(id, "Admin");
  const cash0 = c.Acc.accountBalance("1110"), misc0 = c.Acc.accountBalance("5200"), sales0 = c.Acc.accountBalance("4110");
  const resp = clone(FIX), o = days(resp)["2026-10-07"]; o.expenses["ອື່ນໆ"] = (o.expenses["ອື່ນໆ"] || 0) + 100000; // a till expense POS recorded late
  c.Posin.setTransport(async () => clone(resp));
  const r = await c.Posin.sync({ all: true });
  assert.equal(r.changed, 1); assert.equal(r.adjusted, 1);
  assert.equal(adjJEs(c).length, 1);
  assert.equal(c.Acc.accountBalance("1110") - cash0, -100000); assert.equal(c.Acc.accountBalance("5200") - misc0, 100000); assert.equal(c.Acc.accountBalance("4110") - sales0, 0, "untouched accounts do not move");
  const after = c.Posin.recOf("b1", "2026-10-07"); assert.equal(after.changed, false); assert.equal(after.adj_ids.length, 1);
  await c.Posin.sync({ all: true }); assert.equal(adjJEs(c).length, 1, "same data again → no second adjustment");
});

test("mapping: a payment method and a till-expense category can be redirected or skipped", async () => {
  const c = await app();
  c.Posin.setMapping({ methods: { "BCEL OnePay": "1120" }, exp: { "ຄ່າເຊົ່າ": "SKIP" } });
  const o = days(FIX)["2026-10-01"], L = Array.from(c.Posin.buildLines(o)), by = a => L.filter(l => l.account === a).reduce((s, l) => s + l.debit - l.credit, 0);
  assert.equal(by("1120"), o.pay["ບັດ"] + o.pay["BCEL OnePay"]); assert.equal(by("1100"), 0); assert.equal(by("5210"), 0);
  const t = c.Posin.totals(L); assert.equal(t.dr, t.cr, "skipping an expense keeps the journal balanced");
});

test("reconcile: what POS said equals what the ledger holds", async () => {
  const c = await app(); await c.Posin.sync({ all: true });
  c.Posin.recs().filter(r => r.status === "held").forEach(r => c.Posin.post(r.id, "Admin"));
  const rc = c.Posin.reconcile("2026-10");
  assert.equal(rc.days, 17); assert.equal(rc.gl.sales, rc.pos.sales); assert.equal(rc.gl.svc, rc.pos.svc); assert.equal(rc.gl.vat, rc.pos.vat); assert.equal(rc.gl.tips, rc.pos.tips);
});

test("wrong token and a missing URL are reported in words", async () => {
  const c = await app(); c.Posin.setTransport(async () => ({ ok: false, err: "token" }));
  await assert.rejects(() => c.Posin.sync({ all: true }), /token/);
  c.Posin.setLink({ url: "" });
  await assert.rejects(() => c.Posin.sync({}), /URL/);
});

test("sales far from normal are flagged against the SAME weekday; a normal weekend is not", async () => {
  const c = await app();
  const norm = (c2, d) => c2.Posin.check(days(FIX)[d], c2.Posin.mapping(), { norm: { avg: 8000000, tol: 0.6, basis: "x" }, link: c2.Posin.link() });
  assert.ok(norm(c, "2026-10-10").some(i => i.level === "warn" && /ຕ່າງຈາກປົກກະຕິ/.test(i.msg)), "16M vs 8M is far");
  // a month where weekends really are double: Saturdays/Sundays are compared with weekends, so none is held for that reason
  const resp = clone(FIX), d = days(resp);
  Object.keys(d).forEach(k => { const dw = new Date(k + "T12:00:00Z").getUTCDay(); if (dw === 0 || dw === 6) { Object.keys(d[k].pay).forEach(m => { d[k].pay[m] = 0; }); } });
  const c2 = await app(FIX); await c2.Posin.sync({ all: true });
  const heldForSales = c2.Posin.recs().filter(r => r.status === "held" && r.issues.some(i => /ຕ່າງຈາກປົກກະຕິ/.test(i.msg)));
  assert.ok(heldForSales.length <= 1, "at most the first weekend (no history yet) is held, got " + heldForSales.map(r => r.date));
});

test("the default pull window reaches back ~2 months (late POS corrections); long first imports are cut into 90-day pieces", async () => {
  const c = await app(); const asked = [];
  c.Posin.setTransport(async a => { asked.push([a.from, a.to]); return clone(FIX); });
  await c.Posin.sync({});
  const t = new Date().toISOString().slice(0, 10), back = Math.round((Date.parse(t) - Date.parse(asked[0][0])) / 86400000);
  assert.ok(back >= 61 && back <= 63, "window starts " + back + " days back"); assert.equal(asked.length, 1);
  asked.length = 0; await c.Posin.sync({ from: "2026-01-01", to: "2026-08-01" });
  assert.equal(asked.length, 3, "213 days = 3 pieces of at most 90 days"); asked.forEach(p => assert.ok((Date.parse(p[1]) - Date.parse(p[0])) / 86400000 <= 89));
  assert.equal(asked[0][0], "2026-01-01"); assert.equal(asked[2][1], "2026-08-01");
});
