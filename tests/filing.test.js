const test = require("node:test"), assert = require("node:assert");
const { freshApp } = require("./helpers");

test("a new bill is filed once in its folder and only finance/creator sees it", async () => {
  const c = await freshApp(), { Store, Filing } = c;
  const b = Store.insert("bills", { number: "B-1", status: "draft", lines: [] });
  Store.insert("payments", { type: "pay", number: "P-1" });
  const docs = Store.all("documents");
  assert.equal(docs.filter(d => d.ref_id === b.id).length, 1);
  assert.ok(docs.every(d => d.auto && d.folder_id));
  Filing.file("bills", b); // idempotent
  assert.equal(Store.all("documents").length, 2);
  c.localStorage.setItem("laobooks_role", "Sales");
  assert.equal(Filing.visible(docs[0]), false);
  c.localStorage.setItem("laobooks_role", "Admin");
  assert.equal(Filing.visible(docs[0]), true);
  Store.remove("bills", b.id);
  assert.equal(Filing.alive(docs[0]), false);
});
