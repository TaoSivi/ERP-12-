const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

function je(c, date, lines) { c.Acc.postJournal({ date, source_type: "T", memo: "t", lines: lines.map(([account, debit, credit]) => ({ account, debit, credit })) }); }
async function setup() {
  const c = await freshApp();
  je(c, "2025-03-01", [["1100", 1000000, 0], ["3100", 0, 1000000]]);
  je(c, "2025-06-01", [["1100", 500000, 0], ["4100", 0, 500000]]);
  je(c, "2025-06-02", [["5200", 200000, 0], ["1100", 0, 200000]]);
  je(c, "2026-02-01", [["1700", 300000, 0], ["1100", 0, 300000]]);
  je(c, "2026-03-01", [["5400", 50000, 0], ["1750", 0, 50000]]);
  je(c, "2026-04-01", [["1200", 400000, 0], ["4100", 0, 400000]]);
  je(c, "2026-04-02", [["5100", 100000, 0], ["2100", 0, 100000]]);
  return c;
}

test("balance sheet balances for both years and carries prior profit into retained earnings", async () => {
  const c = await setup(), p25 = c.FS.period(2025, 12), p26 = c.FS.period(2026, 12);
  const a = c.FS.bs(p25.to), b = c.FS.bs(p26.to);
  assert.ok(a.balanced && b.balanced);
  assert.equal(a.cash, 1300000); assert.equal(a.retained, 300000); assert.equal(a["t:equity"], 1300000);
  assert.equal(b.ppe, 250000); assert.equal(b.receivables, 400000); assert.equal(b.payables, 100000); assert.equal(b.retained, 300000 + 400000 - 100000 - 50000 + 2200000, "incl. the demo stock opening balance posted to 3900");
});

test("income statement uses the period only; half-year cut-off respected", async () => {
  const c = await setup(), p = c.FS.period(2026, 12), h = c.FS.period(2026, 3);
  const i = c.FS.is(p.from, p.to);
  assert.equal(i.revenue, 400000); assert.equal(i.cogs, -100000); assert.equal(i["t:gp"], 300000); assert.equal(i.admin, -50000); assert.equal(i["t:np"], 250000);
  assert.equal(c.FS.is(h.from, h.to).revenue, 0, "April sales fall outside Jan–Mar");
  assert.equal(h.to, "2026-03-31");
});

test("cash flow (indirect) ties to the cash line and equity statement closes to the balance sheet", async () => {
  const c = await setup(), p = c.FS.period(2026, 12), f = c.FS.cf(p.from, p.to, p.before);
  assert.ok(f.ties, JSON.stringify(f));
  assert.equal(f.open, 1300000); assert.equal(f.close, 1000000); assert.equal(f.net, -300000);
  assert.equal(f.capex, -300000); assert.equal(f.dep, 50000);
  const e = c.FS.eq(p.from, p.to, p.before);
  assert.equal(e.closing.total, c.FS.bs(p.to)["t:equity"]); assert.equal(e.other.total, 2200000, "demo stock opening balance (3900) is an equity movement, not profit");
});

test("mapping override moves an account to another statement line", async () => {
  const c = await setup();
  c.FS.setMap("1200", "otherCA");
  assert.equal(c.FS.bs("2026-12-31").receivables, 0); assert.equal(c.FS.bs("2026-12-31").otherCA, 400000);
  c.FS.setMap("1200", "");
  assert.equal(c.FS.bs("2026-12-31").receivables, 400000);
});

test("LT chart accounts land on sensible lines", async () => {
  const c = await freshApp();
  const k = (code, type) => c.FS.classify({ code, type });
  assert.equal(k("1021.01", "Asset"), "cash"); assert.equal(k("1213.01", "Asset"), "receivables"); assert.equal(k("2413.01", "Asset"), "ppe");
  assert.equal(k("401.01X", "Liability"), "payables"); assert.equal(k("303", "Equity"), "capital"); assert.equal(k("663", "Expense"), "fx"); assert.equal(k("7612", "Revenue"), "otherInc");
});
