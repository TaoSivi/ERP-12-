const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");
const sale = o => Object.assign({ id: "S1", source: "shop", type: "sale", date: "2026-10-05", amount: 100000, vat: 10000, pay: "cash" }, o);

test("sale / expense / journal post balanced entries; same id twice posts once", async () => {
  const c = await freshApp();
  assert.equal(c.ExtIn.process(sale()).status, "posted");
  assert.equal(c.ExtIn.process(sale()).status, "posted");
  assert.equal(c.Acc.accountBalance("4100"), 100000); assert.equal(c.Acc.accountBalance("2200"), 10000); assert.equal(c.Acc.accountBalance("1110"), 110000);
  assert.equal(c.Store.where("journal_entries", j => j.source_type === "EXT:shop").length, 1);
  assert.equal(c.ExtIn.process({ id: "E1", source: "shop", type: "expense", date: "2026-10-06", amount: 20000, pay: "credit" }).status, "posted");
  assert.equal(c.Acc.accountBalance("2100"), 20000);
  assert.equal(c.ExtIn.process({ id: "J1", source: "hr", type: "journal", date: "2026-10-07", lines: [{ account: "5300", debit: 5000, credit: 0 }, { account: "1100", debit: 0, credit: 5000 }] }).status, "posted");
});

test("bad records are blocked with a reason and post nothing", async () => {
  const c = await freshApp(), n = c.Store.all("journal_entries").length;
  const unbalanced = { id: "J", source: "x", type: "journal", date: "2026-10-01", lines: [{ account: "1100", debit: 10, credit: 0 }, { account: "4100", debit: 0, credit: 9 }] };
  for (const bad of [sale({ id: "a b" }), sale({ date: "2026-13-40" }), sale({ amount: -5 }), sale({ account: "9999" }), sale({ pay: "gold" }), unbalanced]) {
    const r = c.ExtIn.process(bad); assert.equal(r.status, "blocked"); assert.ok(r.error);
  }
  assert.equal(c.Store.all("journal_entries").length, n);
});

test("pull posts, acks, needs a URL; tokens are random and kept out of the DB", async () => {
  const c = await freshApp(), calls = []; c.crypto = require("node:crypto").webcrypto;
  await assert.rejects(c.ExtIn.pull(), /URL/);
  c.ExtIn.setUrl("https://script.example/exec"); const t = c.ExtIn.newTokens();
  assert.notEqual(t.ingest, t.read); assert.match(t.ingest, /^ing_[0-9a-f]{48}$/);
  c.ExtIn.setTransport(async (url, body) => { calls.push(body); return body.action === "pull" ? { ok: true, records: [sale(), sale({ id: "S2", amount: -1 })] } : { ok: true }; });
  const r = await c.ExtIn.pull();
  assert.equal(r.posted, 1); assert.equal(r.blocked, 1);
  assert.equal(calls[0].token, t.read); assert.deepEqual(Array.from(calls[1].ids).sort(), ["shop:S1", "shop:S2"]);
  const all = JSON.stringify(c.Store.all("settings")); assert.ok(!all.includes(t.ingest) && !all.includes(t.read));
});
