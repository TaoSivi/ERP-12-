// LaoBooks ↔ company server link (js/erpremote.js). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(search, mem = {}) {
  const ctx = { sessionStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } }, location: { search }, console };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "erpremote.js"), "utf8"), ctx);
  return { R: ctx.ERPRemote, mem };
}
const U = "https://stpos.store/t/clinic1/erp";

test("erp link: only a company /erp address on https (or localhost) is accepted", () => {
  const { R } = load("?erp=" + encodeURIComponent(U));
  assert.equal(R.url, U);
  for (const bad of ["http://evil.com/t/a1/erp", "https://evil.com/api", "https://evil.com/t/a1/erp/x", "javascript:alert(1)", "https://a.com/t/../erp"])
    assert.equal(load("?erp=" + encodeURIComponent(bad)).R.url, "", bad);
  assert.equal(load("?erp=" + encodeURIComponent("http://localhost:3000/t/ab/erp")).R.url, "http://localhost:3000/t/ab/erp");
  assert.equal(load("").R.url, "", "no link = normal demo / Apps Script mode");
});

test("erp link: remembered for the tab; a different company drops the old sign-in", () => {
  const first = load("?erp=" + encodeURIComponent(U)); first.mem.erp_tk = "s1.x.y";
  assert.equal(load("", first.mem).R.token(), "s1.x.y", "reload keeps url + token");
  assert.equal(load("", first.mem).R.url, U);
  const other = load("?erp=" + encodeURIComponent("https://stpos.store/t/resto2/erp"), first.mem);
  assert.equal(other.R.token(), "", "other company → sign in again");
});

test("erp link: the cPanel form /api/t/<company>/erp is accepted too", () => {
  assert.equal(load("?erp=" + encodeURIComponent("https://stdev.store/api/t/clinic1/erp")).R.url, "https://stdev.store/api/t/clinic1/erp");
  assert.equal(load("?erp=" + encodeURIComponent("https://stdev.store/api/erp")).R.url, "");
});
