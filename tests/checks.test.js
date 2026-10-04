// Control checks: bank reconciliation + anomaly scan. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

async function withPayments() {
  const app = await freshApp();
  const { Acc, Store } = app;
  const bank = Store.all("bank_accounts")[0];
  const it = Store.where("items", i => i.type === "stock")[0];
  const mkInv = (num, date) => {
    const inv = Store.insert("invoices", { number: num, date, customer_id: Store.all("customers")[0].id, status: "draft" });
    Store.insert("invoice_lines", { invoice_id: inv.id, item_id: it.id, qty: 1, price: 100000, discount: 0, tax_code: "tax_0" });
    Acc.postInvoice(inv); return inv;
  };
  const a = mkInv("INV-A", "2026-03-01"), b = mkInv("INV-B", "2026-03-01");
  Acc.receivePayment({ invoice_id: a.id, bank_id: bank.id, amount: 100000, date: "2026-03-05" });
  Acc.receivePayment({ invoice_id: b.id, bank_id: bank.id, amount: 100000, date: "2026-03-20" });
  return Object.assign(app, { bank });
}

test("bank match: same amount twice is matched one-to-one by date, never reusing a ledger line", async () => {
  const { Checks, Store, bank } = await withPayments();
  Checks.importStatement("2026-03-21,TRF 998,100000\n2026-03-06,TRF 120,100000", bank.id);
  assert.equal(Checks.matchBank(), 2);
  const st = Store.all("bank_statements");
  assert.notEqual(st[0].matched_line, st[1].matched_line, "each statement line has its own ledger line");
  const je = id => Store.get("journal_entries", id).date;
  assert.equal(je(st.find(s => s.date === "2026-03-06").matched_je), "2026-03-05");
  assert.equal(je(st.find(s => s.date === "2026-03-21").matched_je), "2026-03-20");
});

test("bank match: an amount with no ledger line within ±3 days stays unmatched", async () => {
  const { Checks, Store, bank } = await withPayments();
  Checks.importStatement("2026-03-15,X,100000", bank.id);
  assert.equal(Checks.matchBank(), 0);
  assert.equal(Store.all("bank_statements")[0].matched, false);
});

test("bank match: a reference that appears in the journal wins over a closer date", async () => {
  const { Checks, Store, Acc, bank } = await withPayments();
  // another receipt of the same amount, one day off, whose memo carries the bank reference
  Acc.postJournal({ date: "2026-03-07", source_type: "T", source_id: "", memo: "deposit REF-777", lines: [{ account: bank.gl_account, debit: 100000, credit: 0 }, { account: "4200", debit: 0, credit: 100000 }] });
  Checks.importStatement("2026-03-05,REF-777,100000", bank.id);
  Checks.matchBank();
  const st = Store.all("bank_statements")[0];
  assert.equal(Store.get("journal_entries", st.matched_je).memo, "deposit REF-777");
  assert.equal(st.matched_by, "ref");
});

test("bank-only items: a fee is booked Dr bank fees / Cr bank in one click and marked matched", async () => {
  const { Checks, Store, Acc, bank } = await withPayments();
  Checks.importStatement("2026-03-31,SMS FEE,-15000", bank.id);
  Checks.matchBank();
  const st = Store.all("bank_statements")[0];
  assert.equal(st.matched, false);
  Checks.postBankItem(st.id);
  assert.equal(Acc.accountBalance("5250"), 15000);
  assert.equal(Store.get("bank_statements", st.id).matched, true);
  assert.throws(() => Checks.postBankItem(st.id), /ຈັບຄູ່ແລ້ວ/);
});

test("anomaly scan: duplicate vendor, split bills under the limit, round manual journal", async () => {
  const { Checks, Store, Acc } = await freshApp();
  const v = Store.all("vendors")[0];
  Store.insert("vendors", { name: v.name + " ", tin: v.tin });               // same TIN
  Store.update("settings", "company", { approval_limit: 5000000 });
  [["2026-03-01", 3000000], ["2026-03-02", 2800000]].forEach(([d, p], i) => {
    const b = Store.insert("bills", { number: "S" + i, date: d, vendor_id: v.id, status: "draft" });
    Store.insert("bill_lines", { bill_id: b.id, account_id: "5200", qty: 1, price: p, tax_code: "tax_0" });
    Acc.postBill(b);
  });
  Acc.postJournal({ date: "2026-03-08", source_type: "MANUAL", source_id: "", memo: "adj", lines: [{ account: "5200", debit: 2000000, credit: 0 }, { account: "3100", debit: 0, credit: 2000000 }] });
  const titles = Array.from(Checks.scan("2026-03-10"), f => f.title);
  assert.ok(titles.includes("ຜູ້ສະໜອງ ຊ້ຳກັນ"));
  assert.ok(titles.includes("ບິນອາດຖືກແບ່ງຫຼົບວົງເງິນອະນຸມັດ"));
  assert.ok(titles.includes("Journal ມືຍອດກົມ"));
  assert.ok(titles.includes("Journal ມືລົງວັນອາທິດ"), "2026-03-08 is a Sunday");
});

test("guard: an invoice line whose item posts to a non-revenue account is flagged", async () => {
  const { Guard, Store } = await freshApp();
  const it = Store.insert("items", { sku: "X", name: "Wrong mapped", type: "service", sell_price: 1000, income_account: "5200", status: "active" });
  const inv = Store.insert("invoices", { number: "G1", date: new Date().toISOString().slice(0, 10), customer_id: Store.all("customers")[0].id, status: "draft" });
  Store.insert("invoice_lines", { invoice_id: inv.id, item_id: it.id, qty: 1, price: 1000, discount: 0, tax_code: "tax_0" });
  assert.ok(Array.from(Guard.review("invoice", inv).findings, f => f.rule).includes("ACCOUNT_TYPE"));
});

test("bank match: two identical receipts on the SAME day get two different ledger lines", async () => {
  const { Checks, Store, Acc, bank } = await withPayments();
  [1, 2].forEach(i => Acc.postJournal({ date: "2026-03-10", source_type: "T", source_id: "", memo: "cash sale " + i, lines: [{ account: bank.gl_account, debit: 50000, credit: 0 }, { account: "4200", debit: 0, credit: 50000 }] }));
  Checks.importStatement("2026-03-10,D1,50000\n2026-03-10,D2,50000", bank.id);
  assert.equal(Checks.matchBank(), 2);
  const [a, b] = Store.all("bank_statements");
  assert.ok(a.matched_line && b.matched_line);
  assert.notEqual(a.matched_line, b.matched_line);
});
