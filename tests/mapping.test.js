const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

test("an item with its own COGS / inventory accounts posts its cost there; others use the posting rule", async () => {
  const c = await freshApp(), cu = c.Store.all("customers")[0], it = c.Store.where("items", i => i.type === "stock")[0];
  c.Store.update("items", it.id, { cogs_account: "5290", inventory_account: "1600" });
  const inv = c.Store.insert("invoices", { number: "I-1", customer_id: cu.id, date: "2026-10-05", due_date: "2026-10-05", currency: "LAK", fx_rate: 1, status: "draft", paid: 0 });
  c.Store.insert("invoice_lines", { invoice_id: inv.id, item_id: it.id, qty: 2, price: 30000, discount: 0, tax_code: "tax_0" });
  c.Acc.postInvoice(c.Store.get("invoices", inv.id));
  assert.equal(c.Acc.accountBalance("5290"), 44000, "2 × 22,000 cost to the item's own COGS account");
  assert.equal(c.Acc.accountBalance("1600"), -44000);
  assert.equal(c.Acc.accountBalance("5100"), 0, "the default COGS account is untouched");
});

test("every journal records who posted it, and the audit log uses the signed-in name (not a fixed one)", async () => {
  const c = await freshApp();
  c.AppCtx = { userLabel: () => "Somchai" };
  const je = c.Acc.postJournal({ date: "2026-10-05", source_type: "T", memo: "x", lines: [{ account: "1100", debit: 10, credit: 0 }, { account: "3100", debit: 0, credit: 10 }] });
  assert.equal(c.Store.get("journal_entries", je.id).posted_by, "Somchai");
  assert.equal(c.Store.all("audit_log").pop().user, "Somchai");
});
