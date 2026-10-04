// UI helper rules (no browser needed). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadUI() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "ui.js"), "utf8"), ctx, { filename: "ui.js" });
  return ctx.UI;
}
const btn = (cls, id) => `<button class="btn ${cls}" id="${id}">${id}</button>`;

test("page actions: with many buttons only the primary stays visible, the rest go into the menu", () => {
  const UI = loadUI();
  const html = ["a", "b", "c", "d", "e"].map(i => btn("btn-ghost", i)).join("") + btn("btn-primary", "main");
  const r = UI.splitActions(html);
  assert.equal(r.visible.length, 1);
  assert.ok(r.visible[0].includes('id="main"'));
  assert.equal(r.more.length, 5);
});

test("page actions: three or fewer buttons are all shown", () => {
  const UI = loadUI();
  const r = UI.splitActions(btn("btn-ghost", "a") + btn("btn-ghost", "b") + btn("btn-primary", "c"));
  assert.equal(r.visible.length, 3);
  assert.equal(r.more.length, 0);
});

test("page actions: status pills always stay visible; with no primary the last button is kept", () => {
  const UI = loadUI();
  const html = '<span class="role-pill">Manager</span>' + ["a", "b", "c", "d"].map(i => btn("btn-ghost", i)).join("");
  const r = UI.splitActions(html);
  assert.ok(r.visible.some(h => h.includes("role-pill")));
  assert.ok(r.visible.some(h => h.includes('id="d"')));
  assert.equal(r.more.length, 3);
});

test("pageHead renders the overflow menu and keeps every button id", () => {
  const UI = loadUI();
  const out = UI.pageHead("T", "S", ["a", "b", "c", "d"].map(i => btn("btn-ghost", i)).join("") + btn("btn-primary", "go"));
  assert.ok(out.includes("more-menu"));
  ["a", "b", "c", "d", "go"].forEach(id => assert.ok(out.includes('id="' + id + '"'), id));
});
