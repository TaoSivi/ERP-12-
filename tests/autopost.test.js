// Auto-Posting engine. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");
// the month-end engine posts by itself in these tests: the approval gate for depreciation is switched off here (gate.test.js covers it ON)
const fresh = async () => { const c = await freshApp(); c.Gate.setOn("DEPR", false); return c; };

function balanced(Acc, Store) {
  let dr = 0, cr = 0;
  const ok = new Set(Store.all("journal_entries").filter(j => j.status === "posted" || j.status === "reversed").map(j => j.id));
  Store.all("journal_lines").filter(l => ok.has(l.je_id)).forEach(l => { dr += l.debit; cr += l.credit; });
  return Acc.round(dr) === Acc.round(cr);
}
const asset = (S, o = {}) => S.insert("assets", Object.assign({ name: "Truck", category: "Vehicle", cost: 1200000, life_months: 12, date: "2026-01-15", method: "straight", acc_dep: 0, status: "active" }, o));

test("depreciation: one JE per completed month, never twice", async () => {
  const { Autopost, Acc, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01" });
  const a = asset(Store);
  const r1 = Autopost.run("2026-04-10");            // Jan, Feb, Mar are complete; April is not
  assert.equal(r1.posted.length, 3);
  assert.equal(Store.get("assets", a.id).acc_dep, 300000);
  assert.equal(Acc.accountBalance("5400"), 300000);
  assert.equal(Acc.accountBalance("1750"), -300000, "contra-asset: credit balance");
  const r2 = Autopost.run("2026-04-10");
  assert.equal(r2.posted.length, 0, "second run posts nothing");
  assert.equal(Store.get("assets", a.id).acc_dep, 300000);
  assert.ok(balanced(Acc, Store));
  // next month ends → exactly one more
  assert.equal(Autopost.run("2026-05-01").posted.length, 1);
  assert.equal(Store.get("assets", a.id).acc_dep, 400000);
});

test("start period: nothing before it is back-filled", async () => {
  const { Autopost, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-03" });
  asset(Store);
  const r = Autopost.run("2026-04-10");
  assert.deepEqual(Array.from(r.posted, p => p.key.split(":")[2]), ["2026-03"]);
});

test("depreciation never exceeds cost and an asset acquired later starts later", async () => {
  const { Autopost, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01" });
  const small = asset(Store, { cost: 200000, life_months: 2, date: "2026-01-02" });
  const late = asset(Store, { cost: 600000, life_months: 6, date: "2026-03-20" });
  Autopost.run("2026-08-01");
  assert.equal(Store.get("assets", small.id).acc_dep, 200000, "stops at cost");
  assert.equal(Store.get("assets", late.id).acc_dep, 500000, "Mar..Jul = 5 completed months");
  Autopost.run("2027-06-01");
  assert.equal(Store.get("assets", late.id).acc_dep, 600000, "capped at cost");
});

test("locked periods are skipped and reported, open ones still post", async () => {
  const { Autopost, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01" });
  asset(Store);
  Store.update("settings", "company", { lock_date: "2026-02-28" });
  const r = Autopost.run("2026-04-10");
  assert.equal(r.skipped.length, 2);
  assert.equal(r.posted.length, 1);
  assert.equal(r.posted[0].date, "2026-03-31");
});

test("a manual run and the engine cannot double-post the same month", async () => {
  const { Autopost, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-04" });
  const a = asset(Store);
  Autopost.manual("DEPR", "", "2026-04-10");                    // someone clicks the button mid-April
  assert.throws(() => Autopost.manual("DEPR", "", "2026-04-20"), /ບໍ່ບັນທຶກຊ້ຳ/);
  Autopost.run("2026-05-02");                                     // engine at month-end: April already done
  assert.equal(Store.get("assets", a.id).acc_dep, 100000, "April counted once");
});

test("prepaid: amortises monthly from the capitalise month and stops at the total", async () => {
  const { Autopost, Acc, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01" });
  const pp = Store.insert("prepaids", { name: "Insurance", total: 120000, periods: 12, amortised: 0, status: "new" });
  Acc.capitalisePrepaid(pp, Store.all("bank_accounts")[0].id, "2026-01-05");
  assert.equal(Store.get("prepaids", pp.id).start, "2026-01");
  Autopost.run("2026-04-10");
  assert.equal(Store.get("prepaids", pp.id).amortised, 30000);
  assert.equal(Acc.accountBalance("1600"), 90000);
  assert.equal(Autopost.run("2026-04-10").posted.length, 0);
  Autopost.run("2027-12-31");
  assert.equal(Store.get("prepaids", pp.id).amortised, 120000, "never above total");
  assert.equal(Acc.accountBalance("1600"), 0);
  assert.ok(balanced(Acc, Store));
});

test("deferred revenue: recognised monthly", async () => {
  const { Autopost, Acc, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01" });
  const df = Store.insert("deferreds", { name: "Annual fee", total: 60000, periods: 6, recognised: 0, status: "new" });
  Acc.bookDeferred(df, Store.all("bank_accounts")[0].id, "2026-01-03");
  Autopost.run("2026-04-01");                                     // Jan, Feb, Mar complete
  assert.equal(Store.get("deferreds", df.id).recognised, 30000);
  assert.equal(Acc.accountBalance("2500"), 30000);
});

test("recurring journal: only auto ones, on their day, once per month", async () => {
  const { Autopost, Acc, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01" });
  const rent = Store.insert("recurring", { name: "Rent", amount: 5000000, account: "5200", auto: true, day: 5 });
  Store.insert("recurring", { name: "Manual only", amount: 999, account: "5200" });
  const r = Autopost.run("2026-03-20");
  assert.equal(r.posted.length, 3, "Jan 5, Feb 5, Mar 5");
  assert.equal(Acc.accountBalance("5200"), 15000000);
  assert.equal(Autopost.run("2026-03-20").posted.length, 0);
  assert.equal(Autopost.run("2026-04-04").posted.length, 0, "Apr 5 is not here yet");
  assert.equal(Autopost.run("2026-04-05").posted.length, 1);
  assert.ok(balanced(Acc, Store));
  assert.ok(rent.id);
});

test("recurring invoice: issued and posted automatically", async () => {
  const { Autopost, Acc, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-02" });
  const item = Store.where("items", i => i.type === "service")[0];
  Store.insert("recurring", { rtype: "invoice", name: "Support", customer_id: Store.all("customers")[0].id, item_id: item.id, qty: 1, price: 1000000, tax_code: "tax_0", auto: true, day: 1 });
  const r = Autopost.run("2026-03-10");
  assert.equal(r.posted.length, 2);
  assert.equal(Store.all("invoices").filter(i => i.status === "posted").length, 2);
  assert.equal(Acc.accountBalance("1200"), 2000000);
  assert.ok(balanced(Acc, Store));
});

test("a failure is reported, leaves no orphan, and does not stop other tasks", async () => {
  const { Autopost, Acc, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-03" });
  asset(Store, { date: "2026-03-01" });
  // recurring invoice pointing to a deleted item → postInvoice throws "no lines/total"
  Store.insert("recurring", { rtype: "invoice", name: "Broken", customer_id: Store.all("customers")[0].id, item_id: "gone", qty: 0, price: 0, auto: true, day: 1 });
  const before = Store.all("invoices").length;
  const r = Autopost.run("2026-04-10");
  assert.equal(r.errors.length >= 1, true);
  assert.equal(Store.all("invoices").length, before, "no half-made invoice");
  assert.equal(r.posted.some(p => p.type === "DEPR"), true, "depreciation still posted");
  assert.ok(balanced(Acc, Store));
});

/* ---------- accruals, VAT close, profit-tax provision, auto-lock ---------- */
function postInv(S, A, date, qty, price) {
  const it = S.where("items", i => i.type === "stock")[0];
  const inv = S.insert("invoices", { number: "I" + Math.random(), date, customer_id: S.all("customers")[0].id, status: "draft" });
  S.insert("invoice_lines", { invoice_id: inv.id, item_id: it.id, qty, price, discount: 0, tax_code: "tax_out10" });
  A.postInvoice(inv);
}
function postBill(S, A, date, price) {
  const b = S.insert("bills", { number: "B" + Math.random(), date, vendor_id: S.all("vendors")[0].id, status: "draft" });
  S.insert("bill_lines", { bill_id: b.id, account_id: "5210", qty: 1, price, tax_code: "tax_in10", description: "rent" });
  A.postBill(b);
}

test("accrual: posted at month-end and reversed on the 1st, in ONE run", async () => {
  const { Autopost, Acc, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01" });
  Store.insert("accruals", { name: "Electricity", account: "5220", amount: 1000000, active: true });
  const r = Autopost.run("2026-02-15");                      // Jan accrual + its Feb-1 reversal
  assert.deepEqual(Array.from(r.posted, p => p.type), ["ACCRUAL", "ACCRUAL_REV"]);
  assert.equal(Acc.accountBalance("2160"), 0, "accrued liability reversed");
  assert.equal(Autopost.run("2026-02-15").posted.length, 0, "idempotent");
  Autopost.run("2026-03-01");                                  // Feb accrual (28th) + reversal (Mar 1)
  assert.equal(Store.where("journal_entries", j => j.source_type === "ACCRUAL").length, 2);
  assert.equal(Store.where("journal_entries", j => j.source_type === "ACCRUAL_REV").length, 2);
  assert.ok(balanced(Acc, Store));
});

test("accrual reversal waits for the 1st of the next month", async () => {
  const { Autopost, Acc, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01" });
  Store.insert("accruals", { name: "Interest", account: "5200", amount: 500000, active: true });
  Autopost.run("2026-01-31");                                  // Jan just ended: accrual only
  assert.equal(Acc.accountBalance("2160"), 500000);
});

test("VAT close (opt-in): the month's output − input moves to net VAT payable", async () => {
  const { Autopost, Acc, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01", vat_close: true });
  postInv(Store, Acc, "2026-01-10", 10, 35000);              // output VAT 35,000
  postBill(Store, Acc, "2026-01-12", 200000);                // input VAT 20,000
  const r = Autopost.run("2026-02-05");
  assert.ok(r.posted.some(p => p.type === "VAT_CLOSE"));
  assert.equal(Acc.accountBalance("2200"), 0);
  assert.equal(Acc.accountBalance("1400"), 0);
  assert.equal(Acc.accountBalance("2250"), 15000);
  assert.equal(Autopost.run("2026-02-05").posted.length, 0);
  assert.ok(balanced(Acc, Store));
});

test("profit-tax provision (opt-in): tops up to YTD profit × rate, no double counting", async () => {
  const { Autopost, Acc, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01", ptax_rate: 20 });
  postInv(Store, Acc, "2026-01-10", 10, 35000);              // profit 350,000 − 220,000 = 130,000
  Autopost.run("2026-02-05");
  assert.equal(Acc.accountBalance("5600"), 26000);
  assert.equal(Acc.accountBalance("2600"), 26000);
  Autopost.run("2026-03-05");                                  // Feb: no new profit → no new provision
  assert.equal(Acc.accountBalance("5600"), 26000);
  postInv(Store, Acc, "2026-03-03", 5, 35000);               // +65,000 profit in March
  Autopost.run("2026-04-02");
  assert.equal(Acc.accountBalance("5600"), 39000, "20% of 195,000");
});

test("auto-lock (opt-in): locks last month N days after it ends, but not while something failed", async () => {
  const { Autopost, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01", autolock_days: 5 });
  Autopost.run("2026-02-03");
  assert.equal((Store.get("settings", "company") || {}).lock_date || "", "", "only 3 days after month-end");
  const r = Autopost.run("2026-02-06");
  assert.equal(r.locked, "2026-01-31");
  assert.equal(Store.get("settings", "company").lock_date, "2026-01-31");
});

test("auto-lock does not lock a month that still has a failing task", async () => {
  const { Autopost, Store } = await fresh();
  Autopost.setConfig({ enabled: true, start: "2026-01", autolock_days: 5 });
  Store.insert("recurring", { rtype: "invoice", name: "Broken", customer_id: Store.all("customers")[0].id, item_id: "gone", qty: 0, price: 0, auto: true, day: 3 });
  const r = Autopost.run("2026-02-10");
  assert.ok(r.errors.length);
  assert.equal(r.locked, undefined);
});
