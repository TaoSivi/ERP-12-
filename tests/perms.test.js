const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

const BASE = { Admin: null, Accountant: ["dashboard", "invoices", "customers"], Sales: ["dashboard", "invoices", "customers"], Viewer: ["dashboard", "reports"], Manager: null };
async function app() {
  const c = await freshApp();
  c.Perms.configure({ base: BASE, modules: [["invoices", "Invoice"], ["customers", "Customers"], ["reports", "Reports"]] });
  return c;
}
// arrays from the vm sandbox belong to another realm; copy before deepEqual
const A = x => Array.from(x);
const btn = attrs => ({ getAttribute: k => attrs[k] || null, hasAttribute: k => k in attrs });

test("defaults: staff roles cannot post or delete; Accountant and Manager can", async () => {
  const { Perms } = await app();
  assert.deepEqual(A(Perms.get("Sales", "invoices")), ["view", "create", "edit", "export"]);
  assert.deepEqual(A(Perms.get("Accountant", "invoices")), A(Perms.ALL));
  assert.equal(Perms.can("Sales", "invoices", "post"), false);
  assert.equal(Perms.can("Sales", "invoices", "delete"), false);
  assert.deepEqual(A(Perms.get("Sales", "gl")), []);
  assert.equal(Perms.can("Sales", "gl", "view"), false);
  assert.equal(Perms.can("Manager", "gl", "delete"), true); // base null = all modules
});

test("defaults: Viewer is read-only (view + export)", async () => {
  const { Perms } = await app();
  assert.deepEqual(A(Perms.get("Viewer", "reports")), ["view", "export"]);
  assert.equal(Perms.can("Viewer", "reports", "create"), false);
});

test("Admin is always full and cannot be edited", async () => {
  const { Perms } = await app();
  Perms.set("Admin", "invoices", []);
  assert.deepEqual(A(Perms.get("Admin", "invoices")), A(Perms.ALL));
});

test("set: per-module override persists and only affects that role + module", async () => {
  const { Perms } = await app();
  Perms.set("Sales", "invoices", ["view", "create"]);
  assert.equal(Perms.can("Sales", "invoices", "create"), true);
  assert.equal(Perms.can("Sales", "invoices", "post"), false);
  assert.equal(Perms.can("Sales", "invoices", "delete"), false);
  assert.deepEqual(A(Perms.get("Sales", "customers")), ["view", "create", "edit", "export"]); // untouched module keeps defaults
  assert.equal(Perms.isCustom("Sales"), true);
});

test("Admin can grant post to a staff role without touching other roles", async () => {
  const { Perms } = await app();
  Perms.set("Sales", "invoices", ["view", "create", "post"]);
  assert.equal(Perms.can("Sales", "invoices", "post"), true);
  assert.equal(Perms.can("Accountant", "invoices", "delete"), true);
});

test("set: any function implies view; clearing everything hides the module", async () => {
  const { Perms } = await app();
  Perms.set("Sales", "invoices", ["post"]);
  assert.deepEqual(A(Perms.get("Sales", "invoices")), ["view", "post"]);
  Perms.set("Sales", "invoices", []);
  assert.equal(Perms.can("Sales", "invoices", "view"), false);
});

test("the dashboard can never be switched off", async () => {
  const { Perms } = await app();
  Perms.set("Sales", "dashboard", []);
  assert.equal(Perms.can("Sales", "dashboard", "view"), true);
});

test("reset returns a role to defaults", async () => {
  const { Perms } = await app();
  Perms.set("Sales", "invoices", ["view"]);
  Perms.reset("Sales");
  assert.equal(Perms.isCustom("Sales"), false);
  assert.deepEqual(A(Perms.get("Sales", "invoices")), ["view", "create", "edit", "export"]);
});

test("classify maps buttons to functions; reports launchers and unknown ids stay ungated", async () => {
  const { Perms } = await app();
  const f = id => Perms.classify(btn({ id }));
  assert.equal(f("add"), "create");
  assert.equal(f("addPO"), "create");
  assert.equal(f("qexp"), "create"); // Quick Expense creates, it is not an export
  assert.equal(f("post"), "post");
  assert.equal(f("pos-pay"), "create"); // till payment is the cashier's core job
  assert.equal(f("receive"), "post");
  assert.equal(f("voidinv"), "delete");
  assert.equal(f("iprint"), "export");
  assert.equal(f("v-imp"), "export");
  assert.equal(f("edit"), "edit");
  assert.equal(f("r-exp"), null); // report launcher, not export
  assert.equal(f("r-csv"), "export");
  assert.equal(f("s-save"), null);
  assert.equal(Perms.classify(btn({ "data-ud": "1" })), "delete");
  assert.equal(Perms.classify(btn({ "data-ue": "1" })), "edit");
});
