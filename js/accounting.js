/* ============================================================
   LaoBooks ERP – Accounting Engine
   Double-entry journal, VAT, FIFO costing, gap-free numbering.
   ============================================================ */
(function () {
  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const POSTING_DEFAULTS = { AR:"1200", REV:"4100", VAT_OUT:"2200", VAT_IN:"1400", INV:"1300", COGS:"5100", AP:"2100", GRIR:"1500", RETENTION:"1250", WHT:"2400", PIT:"2300", LSSO_PAY:"2350", SALARY:"5300", LSSO_EXP:"5350", DEPR:"5400", ACC_DEPR:"1750", PREPAID:"1600", DEFERRED:"2500", BADDEBT:"5500", FX:"4900", PTAX_EXP:"5600", PTAX_PAY:"2600", RETAINED:"3200", OTHER_INC:"4200", GEN_EXP:"5200", OBE:"3900", EMP_ADV:"1450", EMP_PAY:"2150", ACCRUED:"2160", VAT_PAY:"2250", BANK_FEE:"5250" };
  function PA(role) { const m = Store.get("settings", "posting") || {}; return m[role] || POSTING_DEFAULTS[role]; }

  /* ---------- Chart of accounts helpers ---------- */
  function acc(code) { return Store.where("accounts", a => a.code === String(code))[0] || null; }
  function accName(code) { const a = acc(code); return a ? a.code + " " + a.name : code; }

  /* ---------- Numbering (gap-free per year) ---------- */
  function docYear(d) { return (d || new Date().toISOString()).slice(0, 4); }
  function nextNumber(prefix, collection, dateStr) {
    const yr = docYear(dateStr);
    const rows = Store.all(collection).filter(r => (r.number || "").startsWith(prefix + "-" + yr + "-"));
    let max = 0;
    rows.forEach(r => {
      const n = parseInt((r.number || "").split("-").pop(), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return prefix + "-" + yr + "-" + String(max + 1).padStart(4, "0");
  }

  /* ---------- Voucher numbers: KIND-ENTITY-MONYY-SEQ (e.g. PV-LT-JAN26-004) ----------
     KIND  PV payment · RV receipt · JV journal · ADJ adjustment
     ENTITY comes from Settings (entity_code). SEQ restarts every month per kind + entity.
     The currency is a field of the voucher, not part of its number (as in the 2026 books). */
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  function entityCode() { const c = Store.get("settings", "company") || {}; return String(c.entity_code || "MAIN").trim().toUpperCase() || "MAIN"; }
  function nextVoucher(kind, collection, dateStr) {
    const d = dateStr || new Date().toISOString().slice(0, 10);
    const prefix = kind + "-" + entityCode() + "-" + MON[Number(d.slice(5, 7)) - 1] + d.slice(2, 4) + "-";
    let max = 0;
    Store.all(collection).forEach(r => {
      if (!String(r.number || "").startsWith(prefix)) return;
      const n = parseInt(String(r.number).slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return prefix + String(max + 1).padStart(3, "0");
  }

  /* ---------- Tax ---------- */
  function taxRate(taxCodeId) {
    const t = Store.get("taxcodes", taxCodeId);
    return t ? Number(t.rate) || 0 : 0;
  }

  /* ---------- FIFO lots ---------- */
  // Rebuild remaining lots for an item by replaying stock_moves in order.
  function lotsFor(itemId) {
    const moves = Store.where("stock_moves", m => m.item_id === itemId)
      .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0)); // replay in ENTRY order (the order stock was really consumed); seq is numeric — as text "…18"+"10" sorted before "…18"+"9"
    const lots = [];
    moves.forEach(m => {
      if (m.type === "in") lots.push({ qty: Number(m.qty), cost: Number(m.unit_cost) });
      else {
        let need = Number(m.qty);
        while (need > 0 && lots.length) {
          const lot = lots[0];
          const take = Math.min(need, lot.qty);
          lot.qty -= take; need -= take;
          if (lot.qty <= 0.0000001) lots.shift();
        }
      }
    });
    return lots;
  }
  function stockQty(itemId) { return lotsFor(itemId).reduce((s, l) => s + l.qty, 0); }
  function stockValue(itemId) { return lotsFor(itemId).reduce((s, l) => s + l.qty * l.cost, 0); }

  // Consume FIFO qty and return total COGS (does not record the move).
  function computeCOGS(itemId, qty) {
    const lots = lotsFor(itemId);
    let need = Number(qty), cogs = 0;
    for (const lot of lots) {
      if (need <= 0) break;
      const take = Math.min(need, lot.qty);
      cogs += take * lot.cost; need -= take;
    }
    // if not enough stock, value the shortfall at last known cost (or 0)
    if (need > 0) {
      const last = lots.length ? lots[lots.length - 1].cost : 0;
      cogs += need * last;
    }
    return round(cogs);
  }
  function recordMove(itemId, type, qty, unitCost, refType, refId, date) {
    const seq = Store.all("stock_moves").length + 1;
    Store.insert("stock_moves", {
      date: date || new Date().toISOString().slice(0, 10),
      item_id: itemId, type, qty: Number(qty), unit_cost: Number(unitCost) || 0,
      ref_type: refType, ref_id: refId, seq
    });
    // refresh cached qty/avg on item
    const it = Store.get("items", itemId);
    if (it) {
      const q = stockQty(itemId), v = stockValue(itemId);
      Store.update("items", itemId, { qty: round(q), avg_cost: q ? round(v / q) : it.avg_cost });
    }
  }

  /* ---------- Period lock ---------- */
  // Throws if `date` is on/before the company lock date. Call it at the TOP of any function
  // that writes documents/stock before posting, so a locked period never leaves half-saved
  // records behind (e.g. stock moved out but no journal).
  function assertOpen(date) {
    const s = Store.get("settings", "company");
    const d = date || new Date().toISOString().slice(0, 10);
    if (s && s.lock_date && d <= s.lock_date)
      throw new Error("ວັນທີ " + d + " ຢູ່ກ່ອນວັນລັອກບັນຊີ (" + s.lock_date + ")");
  }

  /* ---------- Journal ---------- */
  // lines: [{account: code, debit, credit, memo}]
  function postJournal({ date, source_type, source_id, memo, lines }) {
    // every line must hit a real, postable account with a non-negative amount (the form UIs enforce this, the engine must too)
    (lines || []).forEach(l => {
      const a = acc(l.account);
      if (!a) throw new Error("ບໍ່ພົບບັນຊີ " + l.account);
      if (Number(a.is_header)) throw new Error("ລົງບັນຊີໃສ່ບັນຊີຫົວໝວດບໍ່ໄດ້: " + a.code + " " + a.name);
      if ((Number(l.debit) || 0) < 0 || (Number(l.credit) || 0) < 0) throw new Error("ຍອດ Dr/Cr ຕິດລົບບໍ່ໄດ້ (" + a.code + ")");
    });
    const cleaned = lines
      .map(l => ({ account: String(l.account), account_name: accName(l.account), debit: round(l.debit || 0), credit: round(l.credit || 0), memo: l.memo || "" }))
      .filter(l => l.debit || l.credit);
    // ---- posting-rule splits: divide a side's amount equally across added accounts ----
    const _sp = Store.get("settings", "posting_split");
    if (_sp) {
      const out = [];
      cleaned.forEach(l => {
        const side = l.debit > 0 ? "Dr" : "Cr";
        const cfg = _sp[l.account + "|" + side];
        if (cfg && cfg.length) {
          const amt = side === "Dr" ? l.debit : l.credit;
          const part = round(amt / (cfg.length + 1)); let used = 0;
          cfg.forEach(c => { const code = String(c.code || c); used = round(used + part); out.push({ account: code, account_name: accName(code), debit: side === "Dr" ? part : 0, credit: side === "Cr" ? part : 0, memo: l.memo }); });
          const rem = round(amt - used); if (side === "Dr") l.debit = rem; else l.credit = rem;
        }
        out.push(l);
      });
      cleaned.length = 0; out.filter(x => x.debit || x.credit).forEach(x => cleaned.push(x));
    }
    const td = round(cleaned.reduce((s, l) => s + l.debit, 0));
    const tc = round(cleaned.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(td - tc) > 0.5) throw new Error("Journal ບໍ່ສົມດຸນ: Dr " + td + " ≠ Cr " + tc);

    assertOpen(date);

    const je = Store.insert("journal_entries", {
      number: nextNumber("JE", "journal_entries", date),
      date: date || new Date().toISOString().slice(0, 10),
      source_type, source_id, memo: memo || "",
      total_debit: td, total_credit: tc, status: "posted",
      created_at: new Date().toISOString()
    });
    cleaned.forEach(l => Store.insert("journal_lines", { je_id: je.id, account: l.account, account_name: l.account_name, debit: l.debit, credit: l.credit, memo: l.memo }));
    audit("post", "journal_entries", je.id, je.number + " Dr/Cr " + td);
    return je;
  }

  function reverseJournal(sourceType, sourceId, date, memo) {
    const orig = Store.where("journal_entries", j => j.source_type === sourceType && j.source_id === sourceId && j.status === "posted");
    orig.forEach(je => {
      const lines = Store.where("journal_lines", l => l.je_id === je.id)
        .map(l => ({ account: l.account, debit: l.credit, credit: l.debit, memo: "Reverse: " + (l.memo || "") }));
      postJournal({ date: date || new Date().toISOString().slice(0,10), source_type: sourceType + "_VOID", source_id: sourceId, memo: memo || ("ຍົກເລີກ " + je.number), lines });
      Store.update("journal_entries", je.id, { status: "reversed" });
    });
  }

  /* ---------- Invoice ---------- */
  function invoiceTotals(lines) {
    let sub = 0, disc = 0, vat = 0;
    lines.forEach(l => {
      const gross = (Number(l.qty) || 0) * (Number(l.price) || 0);
      const d = Number(l.discount) || 0;
      const net = gross - d;
      sub += gross; disc += d;
      vat += net * taxRate(l.tax_code) / 100;
    });
    return { subtotal: round(sub), discount: round(disc), vat: round(vat), total: round(sub - disc + vat) };
  }

  function postInvoice(inv) {
    assertOpen(inv.date);
    const lines = Store.where("invoice_lines", l => l.invoice_id === inv.id);
    const t = invoiceTotals(lines);
    if (!lines.length || !(t.total > 0)) throw new Error("Post ບໍ່ໄດ້: Invoice ຕ້ອງມີລາຍການ ແລະ ຍອດລວມ > 0 (ກວດຈຳນວນ/ລາຄາ)");
    if (lines.some(l => (Number(l.qty) || 0) <= 0 || (Number(l.price) || 0) < 0)) throw new Error("Post ບໍ່ໄດ້: ມີແຖວທີ່ຈຳນວນ ≤ 0 ຫຼື ລາຄາຕິດລົບ");
    if (inv.status === "pending") throw new Error("Post ບໍ່ໄດ້: ລໍຖ້າ Manager/Admin ອະນຸມັດກ່ອນ");
    if (inv.status === "rejected") throw new Error("Post ບໍ່ໄດ້: ເອກະສານຖືກປະຕິເສດແລ້ວ");
    const lakRate = Number(inv.fx_rate) || 1;
    const scale = v => round(v * lakRate);

    const jl = [];
    const _ret = round(scale(t.total) * (Number(inv.retention_pct) || 0) / 100);
    jl.push({ account: PA("AR"), debit: scale(t.total) - _ret, credit: 0, memo: "ລູກໜີ້ " + inv.number }); // AR
    if (_ret) jl.push({ account: PA("RETENTION"), debit: _ret, credit: 0, memo: "ເງິນຄ້ຳປະກັນ " + inv.number });
    // revenue per line (net of discount) grouped by income account
    const revByAcc = {};
    lines.forEach(l => {
      const it = Store.get("items", l.item_id);
      const racc = (it && it.income_account) || "4100";
      const net = (Number(l.qty) || 0) * (Number(l.price) || 0) - (Number(l.discount) || 0);
      revByAcc[racc] = (revByAcc[racc] || 0) + net;
    });
    Object.entries(revByAcc).forEach(([a, v]) => jl.push({ account: a, debit: 0, credit: scale(v), memo: "ລາຍຮັບຂາຍ" }));
    if (t.vat) jl.push({ account: PA("VAT_OUT"), debit: 0, credit: scale(t.vat), memo: "VAT ຂາຍ" });

    // COGS + inventory for stock items
    let totalCogs = 0;
    lines.forEach(l => {
      const it = Store.get("items", l.item_id);
      if (it && it.type === "stock") {
        const cogs = computeCOGS(it.id, l.qty);
        if (cogs) {
          totalCogs += cogs;
          recordMove(it.id, "out", l.qty, cogs / (Number(l.qty) || 1), "INVOICE", inv.id, inv.date);
        }
      }
    });
    if (totalCogs) {
      jl.push({ account: PA("COGS"), debit: round(totalCogs), credit: 0, memo: "ຕົ້ນທຶນຂາຍ" });
      jl.push({ account: PA("INV"), debit: 0, credit: round(totalCogs), memo: "ຕັດສິນຄ້າ (FIFO)" });
    }

    const je = postJournal({ date: inv.date, source_type: "INVOICE", source_id: inv.id, memo: "Invoice " + inv.number, lines: jl });
    Store.update("invoices", inv.id, Object.assign({ status: "posted", je_id: je.id, paid: 0 }, t));
    return je;
  }

  /* ---------- Bill ---------- */
  function billTotals(lines) {
    let sub = 0, vat = 0;
    lines.forEach(l => {
      const net = (Number(l.qty) || 1) * (Number(l.price) || 0);
      sub += net; vat += net * taxRate(l.tax_code) / 100;
    });
    return { subtotal: round(sub), vat: round(vat), total: round(sub + vat) };
  }
  function postBill(bill) {
    assertOpen(bill.date);
    const lines = Store.where("bill_lines", l => l.bill_id === bill.id);
    const t = billTotals(lines);
    if (!lines.length || !(t.total > 0)) throw new Error("Post ບໍ່ໄດ້: Bill ຕ້ອງມີລາຍການ ແລະ ຍອດລວມ > 0 (ກວດຈຳນວນ/ລາຄາ)");
    if (bill.status === "pending") throw new Error("Post ບໍ່ໄດ້: ລໍຖ້າ Manager/Admin ອະນຸມັດກ່ອນ");
    if (bill.status === "rejected") throw new Error("Post ບໍ່ໄດ້: ເອກະສານຖືກປະຕິເສດແລ້ວ");
    const rate = Number(bill.fx_rate) || 1;
    const scale = v => round(v * rate);
    const jl = [];
    lines.forEach(l => {
      const net = (Number(l.qty) || 1) * (Number(l.price) || 0);
      const a = l.account_id || "5200";
      jl.push({ account: a, debit: scale(net), credit: 0, memo: l.description || "ຄ່າໃຊ້ຈ່າຍ" });
      // if expense account is inventory, add stock
      if (a === "1300" && l.item_id) recordMove(l.item_id, "in", l.qty, l.price, "BILL", bill.id, bill.date);
    });
    if (t.vat) jl.push({ account: PA("VAT_IN"), debit: scale(t.vat), credit: 0, memo: "VAT ຊື້" });
    jl.push({ account: PA("AP"), debit: 0, credit: scale(t.total), memo: "ເຈົ້າໜີ້ " + bill.number });
    const je = postJournal({ date: bill.date, source_type: "BILL", source_id: bill.id, memo: "Bill " + bill.number, lines: jl });
    Store.update("bills", bill.id, Object.assign({ status: "posted", je_id: je.id, paid: 0 }, t));
    return je;
  }

  /* ---------- Payments ---------- */
  function receivePayment({ invoice_id, bank_id, amount, date }) {
    assertOpen(date);
    const inv = Store.get("invoices", invoice_id);
    const bank = Store.get("bank_accounts", bank_id);
    const amt = round(amount);
    if (!inv || !bank) throw new Error("ບໍ່ພົບ Invoice ຫຼື ບັນຊີທະນາຄານ");
    if (!(amt > 0)) throw new Error("ຈຳນວນເງິນຕ້ອງ > 0");
    const open = round(Number(inv.total) - (Number(inv.paid) || 0));
    if (amt > open + 0.5) throw new Error("ຮັບເກີນຍອດຄ້າງ (ຄ້າງ " + open + ")");
    const pay = Store.insert("payments", {
      number: nextNumber("RC", "payments", date), date, type: "receive",
      party_type: "customer", party_id: inv.customer_id, bank_account: bank_id,
      ref_type: "INVOICE", ref_id: invoice_id, amount: amt, currency: "LAK", status: "posted"
    });
    postJournal({ date, source_type: "PAYMENT", source_id: pay.id, memo: "ຮັບເງິນ " + inv.number,
      lines: [ { account: bank.gl_account, debit: amt, credit: 0, memo: "ຮັບເຂົ້າ " + bank.name }, { account: PA("AR"), debit: 0, credit: amt, memo: "ຫຼຸດລູກໜີ້" } ] });
    const paid = round((Number(inv.paid) || 0) + amt);
    Store.update("invoices", invoice_id, { paid, status: paid >= Number(inv.total) - 0.5 ? "paid" : "partial" });
    return pay;
  }
  function payBill({ bill_id, bank_id, amount, date }) {
    assertOpen(date);
    const bill = Store.get("bills", bill_id);
    const bank = Store.get("bank_accounts", bank_id);
    const amt = round(amount);
    if (!bill || !bank) throw new Error("ບໍ່ພົບ Bill ຫຼື ບັນຊີທະນາຄານ");
    if (!(amt > 0)) throw new Error("ຈຳນວນເງິນຕ້ອງ > 0");
    const open = round(Number(bill.total) - (Number(bill.paid) || 0));
    if (amt > open + 0.5) throw new Error("ຈ່າຍເກີນຍອດຄ້າງ (ຄ້າງ " + open + ")");
    const pay = Store.insert("payments", {
      number: nextNumber("PV", "payments", date), date, type: "pay",
      party_type: "vendor", party_id: bill.vendor_id, bank_account: bank_id,
      ref_type: "BILL", ref_id: bill_id, amount: amt, currency: "LAK", status: "posted"
    });
    postJournal({ date, source_type: "PAYMENT", source_id: pay.id, memo: "ຈ່າຍ " + bill.number,
      lines: [ { account: PA("AP"), debit: amt, credit: 0, memo: "ຫຼຸດເຈົ້າໜີ້" }, { account: bank.gl_account, debit: 0, credit: amt, memo: "ຈ່າຍຈາກ " + bank.name } ] });
    const paid = round((Number(bill.paid) || 0) + amt);
    Store.update("bills", bill_id, { paid, status: paid >= Number(bill.total) - 0.5 ? "paid" : "partial" });
    return pay;
  }

  /* ---------- Reporting aggregations ---------- */
  function accountMovements() {
    // returns {code: {debit, credit}}
    const map = {};
    Store.all("journal_lines").forEach(l => {
      const je = Store.get("journal_entries", l.je_id);
      // FIX v1.1: ຕ້ອງນັບທັງ "posted" ແລະ "reversed" — ເພາະ reverseJournal ສ້າງ JE ກັບລາຍການຕ່າງຫາກແລ້ວ
      // ຖ້າຕັດ JE ເດີມອອກນຳ ຈະຫັກຊ້ຳ 2 ເທື່ອ (void ແລ້ວຍອດຕິດລົບ)
      if (!je || (je.status !== "posted" && je.status !== "reversed")) return;
      if (!map[l.account]) map[l.account] = { debit: 0, credit: 0 };
      map[l.account].debit += Number(l.debit) || 0;
      map[l.account].credit += Number(l.credit) || 0;
    });
    return map;
  }
  function accountBalance(code) {
    const m = accountMovements()[String(code)] || { debit: 0, credit: 0 };
    const a = acc(code);
    const type = a ? a.type : "Asset";
    // Asset/Expense: debit-normal ; Liability/Equity/Revenue: credit-normal
    if (type === "Asset" || type === "Expense") return round(m.debit - m.credit);
    return round(m.credit - m.debit);
  }
  function sumByType(type) {
    return Store.where("accounts", a => a.type === type && !a.is_header)
      .reduce((s, a) => s + accountBalance(a.code), 0);
  }
  function plData() {
    const revenue = sumByType("Revenue");
    const expense = sumByType("Expense");
    const cogs = accountBalance("5100");
    const grossProfit = round(revenue - cogs);
    const otherExp = round(expense - cogs);
    return { revenue: round(revenue), cogs: round(cogs), grossProfit, expense: round(otherExp), net: round(revenue - expense) };
  }
  function arOutstanding() { return Store.where("invoices", i => i.status === "posted" || i.status === "partial" || i.status === "paid").reduce((s, i) => s + (Number(i.total) - (Number(i.paid) || 0)), 0); }
  function apOutstanding() { return Store.where("bills", b => b.status === "posted" || b.status === "partial" || b.status === "paid").reduce((s, b) => s + (Number(b.total) - (Number(b.paid) || 0)), 0); }
  function cashBalance() { return Store.all("bank_accounts").reduce((s, b) => s + accountBalance(b.gl_account) + (Number(b.opening_balance)||0), 0); }

  function aging(kind) {
    // kind = 'ar' or 'ap'
    const rows = kind === "ar"
      ? Store.where("invoices", i => (i.status === "posted" || i.status === "partial"))
      : Store.where("bills", b => (b.status === "posted" || b.status === "partial"));
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, ">90": 0 };
    const today = new Date();
    rows.forEach(r => {
      const bal = Number(r.total) - (Number(r.paid) || 0);
      if (bal <= 0) return;
      const due = new Date(r.due_date || r.date);
      const days = Math.floor((today - due) / 86400000);
      if (days <= 30) buckets["0-30"] += bal;
      else if (days <= 60) buckets["31-60"] += bal;
      else if (days <= 90) buckets["61-90"] += bal;
      else buckets[">90"] += bal;
    });
    return buckets;
  }

  /* ---------- Credit Note (customer return / correction) ---------- */
  function postCreditNote(cn) {
    assertOpen(cn.date);
    const lines = Store.where("cn_lines", l => l.cn_id === cn.id);
    const t = invoiceTotals(lines);
    const jl = [];
    jl.push({ account: PA("AR"), debit: 0, credit: t.total, memo: "ຫຼຸດລູກໜີ້ CN " + cn.number });
    const rev = {};
    lines.forEach(l => { const it = Store.get("items", l.item_id); const racc = (it && it.income_account) || "4100"; const net = (Number(l.qty) || 0) * (Number(l.price) || 0) - (Number(l.discount) || 0); rev[racc] = (rev[racc] || 0) + net; });
    Object.entries(rev).forEach(([a, v]) => jl.push({ account: a, debit: v, credit: 0, memo: "ຄືນລາຍຮັບ" }));
    if (t.vat) jl.push({ account: PA("VAT_OUT"), debit: t.vat, credit: 0, memo: "ຄືນ VAT" });
    let cogs = 0;
    lines.forEach(l => { const it = Store.get("items", l.item_id); if (it && it.type === "stock" && cn.return_stock) { const c = (Number(it.avg_cost) || 0) * (Number(l.qty) || 0); recordMove(it.id, "in", l.qty, it.avg_cost || 0, "CN", cn.id); cogs += c; } });
    if (cogs) { jl.push({ account: PA("INV"), debit: round(cogs), credit: 0, memo: "ຄືນສິນຄ້າ" }); jl.push({ account: PA("COGS"), debit: 0, credit: round(cogs), memo: "ຄືນ COGS" }); }
    const je = postJournal({ date: cn.date, source_type: "CREDIT_NOTE", source_id: cn.id, memo: "CN " + cn.number, lines: jl });
    Store.update("credit_notes", cn.id, Object.assign({ status: "posted", je_id: je.id }, t));
    if (cn.invoice_id) { const inv = Store.get("invoices", cn.invoice_id); if (inv) { const paid = round((Number(inv.paid) || 0) + t.total); Store.update("invoices", inv.id, { paid, status: paid >= Number(inv.total) - 0.5 ? "paid" : "partial" }); } }
    audit("post", "credit_notes", cn.id, cn.number);
    return je;
  }

  /* ---------- Purchase Return (Debit Note to vendor) ---------- */
  function postDebitNote(dn) {
    assertOpen(dn.date);
    const lines = Store.where("dn_lines", l => l.dn_id === dn.id);
    let total = 0;
    lines.forEach(l => {
      const it = Store.get("items", l.item_id);
      total += (Number(l.qty) || 0) * (Number(l.price) || 0);
      if (it && it.type === "stock") recordMove(it.id, "out", l.qty, l.price, "DN", dn.id, dn.date);
    });
    const jl = [
      { account: PA("AP"), debit: round(total), credit: 0, memo: "ຫຼຸດເຈົ້າໜີ້ DN " + dn.number },
      { account: PA("INV"), debit: 0, credit: round(total), memo: "ສົ່ງຄືນສິນຄ້າ" }
    ];
    const je = postJournal({ date: dn.date, source_type: "DEBIT_NOTE", source_id: dn.id, memo: "DN " + dn.number, lines: jl });
    Store.update("debit_notes", dn.id, { status: "posted", je_id: je.id, total: round(total) });
    audit("post", "debit_notes", dn.id, dn.number);
    return je;
  }

  /* ---------- Bank transfer ---------- */
  function bankTransfer({ from_id, to_id, amount, fee, date }) {
    assertOpen(date);
    const from = Store.get("bank_accounts", from_id), to = Store.get("bank_accounts", to_id);
    const amt = round(amount), f = round(fee || 0);
    const jl = [{ account: to.gl_account, debit: amt, credit: 0, memo: "ໂອນເຂົ້າ " + to.name }];
    if (f) jl.push({ account: PA("GEN_EXP"), debit: f, credit: 0, memo: "ຄ່າທຳນຽມໂອນ" });
    jl.push({ account: from.gl_account, debit: 0, credit: amt + f, memo: "ໂອນອອກ " + from.name });
    const pay = Store.insert("payments", { number: nextNumber("TR", "payments", date), date, type: "transfer", party_type: "bank", party_id: to_id, bank_account: from_id, ref_type: "TRANSFER", ref_id: to_id, amount: amt, currency: "LAK", status: "posted" });
    postJournal({ date, source_type: "TRANSFER", source_id: pay.id, memo: "ໂອນເງິນ " + from.name + " → " + to.name, lines: jl });
    return pay;
  }

  /* ---------- Customer advance / deposit ---------- */
  function customerAdvance({ customer_id, bank_id, amount, date }) {
    assertOpen(date);
    const bank = Store.get("bank_accounts", bank_id);
    const amt = round(amount);
    const pay = Store.insert("payments", { number: nextNumber("ADV", "payments", date), date, type: "receive", party_type: "customer", party_id: customer_id, bank_account: bank_id, ref_type: "ADVANCE", ref_id: customer_id, amount: amt, currency: "LAK", status: "posted" });
    postJournal({ date, source_type: "ADVANCE", source_id: pay.id, memo: "ຮັບເງິນມັດຈຳ", lines: [{ account: bank.gl_account, debit: amt, credit: 0, memo: "ຮັບເງິນລ່ວງໜ້າ" }, { account: PA("DEFERRED"), debit: 0, credit: amt, memo: "ເງິນຮັບລ່ວງໜ້າ (ໜີ້ສິນ)" }] });
    return pay;
  }

  /* ---------- Stock adjustment ---------- */
  // kind "usage" = ingredients/goods consumed in the business (→ COGS 5100); default = loss / count difference (→ general expense)
  function stockAdjust({ item_id, qtyDelta, reason, date, kind }) {
    assertOpen(date);
    const it = Store.get("items", item_id);
    const cost = Number(it.avg_cost) || 0;
    const value = round(Math.abs(qtyDelta) * cost);
    const exp = kind === "usage" ? PA("COGS") : PA("GEN_EXP");
    if (qtyDelta >= 0) recordMove(item_id, "in", qtyDelta, cost, "ADJUST", "", date);
    else recordMove(item_id, "out", -qtyDelta, cost, "ADJUST", "", date);
    const jl = qtyDelta >= 0
      ? [{ account: PA("INV"), debit: value, credit: 0, memo: "ປັບເພີ່ມ stock" }, { account: exp, debit: 0, credit: value, memo: reason || "ປັບ stock" }]
      : [{ account: exp, debit: value, credit: 0, memo: reason || "ປັບຫຼຸດ stock" }, { account: PA("INV"), debit: 0, credit: value, memo: "ປັບຫຼຸດ stock" }];
    if (value) postJournal({ date: date || new Date().toISOString().slice(0, 10), source_type: "STOCK_ADJ", source_id: item_id, memo: "ປັບ stock " + it.name, lines: jl });
    audit("adjust", "items", item_id, (qtyDelta >= 0 ? "+" : "") + qtyDelta + " " + (reason || ""));
  }

  /* ---------- Asset disposal ---------- */
  function disposeAsset(asset, proceeds, bank_id, date) {
    assertOpen(date);
    const cost = Number(asset.cost), acc0 = Number(asset.acc_dep), nbv = cost - acc0, p = round(proceeds || 0);
    const bank = bank_id ? Store.get("bank_accounts", bank_id) : null;
    const jl = [];
    if (p && bank) jl.push({ account: bank.gl_account, debit: p, credit: 0, memo: "ຮັບເງິນຂາຍຊັບ" });
    if (acc0) jl.push({ account: PA("ACC_DEPR"), debit: round(acc0), credit: 0, memo: "ລ້າງເສື່ອມສະສົມ" });
    jl.push({ account: "1700", debit: 0, credit: round(cost), memo: "ຕັດຕົ້ນທຶນຊັບ" });
    const gain = round(p - nbv);
    if (gain > 0) jl.push({ account: PA("OTHER_INC"), debit: 0, credit: gain, memo: "ກຳໄລຈາກການຂາຍຊັບ" });
    else if (gain < 0) jl.push({ account: PA("GEN_EXP"), debit: -gain, credit: 0, memo: "ຂາດທຶນຈາກການຂາຍຊັບ" });
    postJournal({ date: date || new Date().toISOString().slice(0, 10), source_type: "DISPOSE", source_id: asset.id, memo: "ຂາຍ/ກຳຈັດ " + asset.name, lines: jl });
    Store.update("assets", asset.id, { status: "disposed" });
  }

  /* ---------- Prepaid ---------- */
  function capitalisePrepaid(pp, bank_id, date) {
    assertOpen(date);
    const bank = bank_id ? Store.get("bank_accounts", bank_id) : null;
    postJournal({ date, source_type: "PREPAID_CAP", source_id: pp.id, memo: "ນຳເຂົ້າຄ່າລ່ວງໜ້າ " + pp.name, lines: [{ account: PA("PREPAID"), debit: Number(pp.total), credit: 0, memo: pp.name }, { account: bank ? bank.gl_account : "2100", debit: 0, credit: Number(pp.total), memo: "ຈ່າຍລ່ວງໜ້າ" }] });
    Store.update("prepaids", pp.id, { status: "active", start: String(date || new Date().toISOString()).slice(0, 7) });
  }
  function amortisePrepaid(pp, date) {
    assertOpen(date);
    const per = round(Number(pp.total) / Number(pp.periods || 1));
    const remain = Number(pp.total) - Number(pp.amortised || 0);
    const amt = Math.min(per, remain);
    if (amt <= 0) return;
    postJournal({ date, source_type: "PREPAID_AMT", source_id: pp.id, memo: "ຕັດຄ່າລ່ວງໜ້າ " + pp.name, lines: [{ account: PA("GEN_EXP"), debit: amt, credit: 0, memo: "ຄ່າໃຊ້ຈ່າຍງວດ" }, { account: PA("PREPAID"), debit: 0, credit: amt, memo: "ຫຼຸດຄ່າລ່ວງໜ້າ" }] });
    Store.update("prepaids", pp.id, { amortised: round(Number(pp.amortised || 0) + amt) });
  }

  /* ---------- Deferred revenue ---------- */
  function bookDeferred(df, bank_id, date) {
    assertOpen(date);
    const bank = Store.get("bank_accounts", bank_id);
    postJournal({ date, source_type: "DEFERRED_BOOK", source_id: df.id, memo: "ຮັບເງິນລ່ວງໜ້າ " + df.name, lines: [{ account: bank.gl_account, debit: Number(df.total), credit: 0, memo: "ຮັບເງິນ" }, { account: PA("DEFERRED"), debit: 0, credit: Number(df.total), memo: "ລາຍຮັບຮັບລ່ວງໜ້າ" }] });
    Store.update("deferreds", df.id, { status: "active", start: String(date || new Date().toISOString()).slice(0, 7) });
  }
  function recogniseDeferred(df, date) {
    assertOpen(date);
    const per = round(Number(df.total) / Number(df.periods || 1));
    const remain = Number(df.total) - Number(df.recognised || 0);
    const amt = Math.min(per, remain);
    if (amt <= 0) return;
    postJournal({ date, source_type: "DEFERRED_REC", source_id: df.id, memo: "ຮັບຮອງລາຍຮັບ " + df.name, lines: [{ account: PA("DEFERRED"), debit: amt, credit: 0, memo: "ຫຼຸດລາຍຮັບລ່ວງໜ້າ" }, { account: "4100", debit: 0, credit: amt, memo: "ຮັບຮອງລາຍຮັບ" }] });
    Store.update("deferreds", df.id, { recognised: round(Number(df.recognised || 0) + amt) });
  }

  /* ---------- Year-end close ---------- */
  function yearEndClose(date) {
    assertOpen(date);
    const jl = [];
    let net = 0;
    Store.where("accounts", a => (a.type === "Revenue" || a.type === "Expense") && !a.is_header).forEach(a => {
      const bal = accountBalance(a.code);
      if (Math.abs(bal) < 0.5) return;
      if (a.type === "Revenue") { jl.push({ account: a.code, debit: bal, credit: 0, memo: "ປິດ " + a.name }); net += bal; }
      else { jl.push({ account: a.code, debit: 0, credit: bal, memo: "ປິດ " + a.name }); net -= bal; }
    });
    if (!jl.length) throw new Error("ບໍ່ມີຍອດ Revenue/Expense ໃຫ້ປິດ");
    if (net >= 0) jl.push({ account: PA("RETAINED"), debit: 0, credit: round(net), memo: "ໂອນເຂົ້າກຳໄລສະສົມ" });
    else jl.push({ account: PA("RETAINED"), debit: round(-net), credit: 0, memo: "ໂອນຂາດທຶນ" });
    return postJournal({ date: date || new Date().toISOString().slice(0, 10), source_type: "YEAR_END", source_id: "", memo: "ປິດສິ້ນປີບັນຊີ", lines: jl });
  }

  /* ---------- Cash flow (simple, from payments) ---------- */
  function cashFlow() {
    const inflow = Store.where("payments", p => p.type === "receive").reduce((s, p) => s + Number(p.amount), 0);
    const outflow = Store.where("payments", p => p.type === "pay").reduce((s, p) => s + Number(p.amount), 0);
    return { inflow: round(inflow), outflow: round(outflow), net: round(inflow - outflow) };
  }

  /* ---------- Cash flow from the LEDGER (direct method) ----------
     Every journal that touches a cash/bank account counts, whatever created it (POS summary, request,
     payroll, manual entry, payment). The old report only summed the payments table and missed all of these. */
  function cashAccountCodes() {
    const gl = new Set(Store.all("bank_accounts").map(b => String(b.gl_account)));
    return new Set(Store.where("accounts", a => !Number(a.is_header) && a.type === "Asset" && (gl.has(a.code) || /ເງິນສົດ|ເງິນຝາກ|ທະນາຄານ|cash|bank/i.test(a.name))).map(a => a.code));
  }
  const CF_LABEL = { POS_DAILY: "ຂາຍໜ້າຮ້ານ (POS)", POS_ADJ: "ປັບຍອດ POS (POS ແກ້ໄຂພາຍຫຼັງ)", PAYMENT: "ຮັບ/ຈ່າຍ ຕາມເອກະສານ (Invoice/Bill)", REQUEST: "ຄຳຂໍເບີກ / ຈ່າຍ", PAYROLL: "ເງິນເດືອນ", GRN: "ຮັບເຄື່ອງ", MANUAL: "Journal ມື", QUICK: "Quick Record", OPENING: "ຍອດຍົກມາ", PROFIT_TAX: "ອາກອນ", WHT: "ອາກອນ", ASSET: "ຊື້ຊັບສິນ" };
  function cashFlowGL(from, to) {
    const cash = cashAccountCodes(), f = from || "0000-00-00", t = to || "9999-12-31", acct = {};
    Store.all("accounts").forEach(a => { acct[a.code] = a; });
    const rows = {}; let opening = 0, closing = 0;
    Store.all("journal_entries").forEach(j => {
      if (j.status === "void") return;
      const ls = Store.where("journal_lines", l => l.je_id === j.id);
      const net = ls.filter(l => cash.has(String(l.account))).reduce((x, l) => x + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
      if (!net) return;
      if (j.date < f) { opening += net; return; }
      if (j.date > t) return;
      closing += net;
      const other = ls.filter(l => !cash.has(String(l.account)));
      const assetPay = j.source_type === "PAYMENT" && (() => { const p = Store.get("payments", j.source_id); const b = p && p.ref_type === "BILL" ? Store.get("bills", p.ref_id) : null; return !!(b && b.po_id && Store.where("po_lines", pl => pl.po_id === b.po_id).some(pl => pl.kind === "asset")); })();
      const section = assetPay || other.some(l => /^17/.test(String(l.account))) ? "ລົງທຶນ (ຊັບສິນຖາວອນ)" : other.some(l => (acct[l.account] || {}).type === "Equity") ? "ການເງິນ (ທຶນ / ກູ້ຢືມ)" : "ດຳເນີນງານ";
      const label = CF_LABEL[j.source_type] || j.source_type || "ອື່ນໆ";
      const k = section + "|" + label;
      rows[k] = rows[k] || { section, label, inflow: 0, outflow: 0 };
      if (net > 0) rows[k].inflow += net; else rows[k].outflow += -net;
    });
    const list = Object.values(rows).map(r => ({ section: r.section, label: r.label, inflow: round(r.inflow), outflow: round(r.outflow) }));
    const inflow = round(list.reduce((s2, r) => s2 + r.inflow, 0)), outflow = round(list.reduce((s2, r) => s2 + r.outflow, 0));
    return { opening: round(opening), rows: list, inflow, outflow, net: round(inflow - outflow), closing: round(opening + inflow - outflow) };
  }

  /* ---------- Bad debt write-off ---------- */
  function writeOffBadDebt(invoiceId, amount, date) {
    assertOpen(date);
    const inv = Store.get("invoices", invoiceId); const amt = round(amount);
    postJournal({ date: date || new Date().toISOString().slice(0, 10), source_type: "BAD_DEBT", source_id: invoiceId, memo: "ຕັດໜີ້ສູນ " + inv.number, lines: [{ account: PA("BADDEBT"), debit: amt, credit: 0, memo: "ໜີ້ສູນ" }, { account: PA("AR"), debit: 0, credit: amt, memo: "ຫຼຸດລູກໜີ້" }] });
    const paid = round((Number(inv.paid) || 0) + amt);
    Store.update("invoices", invoiceId, { paid, status: paid >= Number(inv.total) - 0.5 ? "paid" : "partial" });
  }

  /* ---------- FX adjustment ---------- */
  function fxAdjust({ account, amount, gain, date, memo }) {
    assertOpen(date);
    const amt = round(amount);
    const jl = [];
    if (gain) { jl.push({ account: account, debit: amt, credit: 0, memo: memo || "FX" }); jl.push({ account: PA("FX"), debit: 0, credit: amt, memo: "FX Gain" }); }
    else { jl.push({ account: PA("FX"), debit: amt, credit: 0, memo: "FX Loss" }); jl.push({ account: account, debit: 0, credit: amt, memo: memo || "FX" }); }
    postJournal({ date: date || new Date().toISOString().slice(0, 10), source_type: "FX_ADJ", source_id: "", memo: memo || "ປັບ FX", lines: jl });
  }

  /* ---------- Landed cost ---------- */
  function landedCost({ amount, date }) {
    assertOpen(date);
    const amt = round(amount);
    postJournal({ date: date || new Date().toISOString().slice(0, 10), source_type: "LANDED", source_id: "", memo: "Landed Cost", lines: [{ account: PA("INV"), debit: amt, credit: 0, memo: "ເພີ່ມມູນຄ່າສິນຄ້າ" }, { account: PA("AP"), debit: 0, credit: amt, memo: "ຄ່າຂົນສົ່ງ/ພາສີ" }] });
  }

  /* ---------- ECL (IFRS 9) ---------- */
  function computeECL() {
    const b = aging("ar");
    return round(b["0-30"] * 0.05 + b["31-60"] * 0.15 + b["61-90"] * 0.5 + b[">90"] * 1);
  }
  function recogniseECL(amount, date) {
    assertOpen(date);
    const amt = round(amount);
    postJournal({ date: date || new Date().toISOString().slice(0, 10), source_type: "ECL", source_id: "", memo: "ECL (IFRS 9)", lines: [{ account: PA("BADDEBT"), debit: amt, credit: 0, memo: "ຄ່າຄາດຄະເນໜີ້ສູນ" }, { account: PA("AR"), debit: 0, credit: amt, memo: "ຄ່າເຜື່ອໜີ້ສົງໄສ" }] });
  }

  /* ---------- NRV write-down (IAS 2) ---------- */
  function nrvWritedown(itemId, newValue, date) {
    assertOpen(date);
    const it = Store.get("items", itemId); const cur = stockValue(itemId); const down = round(cur - newValue);
    if (down <= 0) return 0;
    postJournal({ date: date || new Date().toISOString().slice(0, 10), source_type: "NRV", source_id: itemId, memo: "NRV write-down " + it.name, lines: [{ account: PA("COGS"), debit: down, credit: 0, memo: "ລົດມູນຄ່າສິນຄ້າ" }, { account: PA("INV"), debit: 0, credit: down, memo: "NRV" }] });
    const q = stockQty(itemId); if (q > 0) Store.update("items", itemId, { avg_cost: round(newValue / q) });
    return down;
  }

  /* ---------- Impairment (IAS 36) ---------- */
  function impairAsset(asset, amount, date) {
    assertOpen(date);
    const amt = round(amount);
    postJournal({ date: date || new Date().toISOString().slice(0, 10), source_type: "IMPAIR", source_id: asset.id, memo: "Impairment " + asset.name, lines: [{ account: PA("GEN_EXP"), debit: amt, credit: 0, memo: "ຂາດທຶນຈາກການດ້ອຍຄ່າ" }, { account: PA("ACC_DEPR"), debit: 0, credit: amt, memo: "ດ້ອຍຄ່າສະສົມ" }] });
    Store.update("assets", asset.id, { acc_dep: round(Number(asset.acc_dep) + amt) });
  }

  /* ---------- Working capital ---------- */
  function workingCapital() {
    const ar = arOutstanding(), ap = apOutstanding();
    const inv = Store.where("items", i => i.type === "stock").reduce((s, i) => s + stockValue(i.id), 0);
    const rev = Math.abs(sumByType("Revenue")), cogs = Math.abs(accountBalance("5100"));
    const purch = Store.where("bills", b => b.status !== "draft" && b.status !== "void").reduce((s, b) => s + Number(b.total || 0), 0) || cogs;
    const days = (x, base) => base > 0 ? Math.round(x / base * 365) : null; // no base (e.g. a service company has no COGS) → n/a, not a nonsense number
    const dso = days(ar, rev), dpo = days(ap, purch), dio = days(inv, cogs);
    return { dso, dpo, dio, ccc: dso == null || dpo == null ? null : round((dio || 0) + dso - dpo), ar: round(ar), ap: round(ap), inv: round(inv) };
  }

  /* ---------- Catch-up depreciation & Project P&L (batch 5) ---------- */
  function depreciateCatchUp(n, date) {
    assertOpen(date);
    const act = Store.where("assets", a => a.status === "active" && Number(a.acc_dep) < Number(a.cost));
    let total = 0;
    act.forEach(a => { const monthly = Number(a.cost) / Number(a.life_months || 1); const amt = Math.min(monthly * n, Number(a.cost) - Number(a.acc_dep)); total += amt; Store.update("assets", a.id, { acc_dep: round(Number(a.acc_dep) + amt) }); });
    if (total <= 0) throw new Error("ບໍ່ມີຄ່າເສື່ອມ");
    return postJournal({ date: date || new Date().toISOString().slice(0, 10), source_type: "DEPR_CATCHUP", source_id: "", memo: "ຄ່າເສື່ອມ catch-up " + n + " ເດືອນ", lines: [{ account: PA("DEPR"), debit: round(total), credit: 0, memo: "ຄ່າເສື່ອມ" }, { account: PA("ACC_DEPR"), debit: 0, credit: round(total), memo: "ເສື່ອມສະສົມ" }] });
  }
  function projectPL(projectId) {
    const inv = Store.where("invoices", i => i.project_id === projectId && i.status !== "draft").reduce((s, i) => s + Number(i.total), 0);
    const bill = Store.where("bills", b => b.project_id === projectId && b.status !== "draft").reduce((s, b) => s + Number(b.total), 0);
    return { revenue: round(inv), cost: round(bill), profit: round(inv - bill) };
  }

  /* ---------- Void (reverse) documents (batch 9) ---------- */
  function voidInvoice(inv) {
    reverseJournal("INVOICE", inv.id);
    Store.where("stock_moves", m => m.ref_type === "INVOICE" && m.ref_id === inv.id).forEach(m => { recordMove(m.item_id, m.type === "out" ? "in" : "out", m.qty, m.unit_cost, "INVOICE_VOID", inv.id); });
    Store.update("invoices", inv.id, { status: "void" });
    audit("void", "invoices", inv.id, inv.number);
  }
  function voidBill(bill) {
    reverseJournal("BILL", bill.id);
    Store.where("stock_moves", m => m.ref_type === "BILL" && m.ref_id === bill.id).forEach(m => { recordMove(m.item_id, m.type === "in" ? "out" : "in", m.qty, m.unit_cost, "BILL_VOID", bill.id); });
    Store.update("bills", bill.id, { status: "void" });
    audit("void", "bills", bill.id, bill.number);
  }
  function voidPayment(pay) {
    reverseJournal("PAYMENT", pay.id);
    if (pay.ref_type === "INVOICE") { const inv = Store.get("invoices", pay.ref_id); if (inv) { const paid = round((Number(inv.paid) || 0) - Number(pay.amount)); Store.update("invoices", inv.id, { paid: Math.max(0, paid), status: paid <= 0.5 ? "posted" : "partial" }); } }
    if (pay.ref_type === "BILL") { const b = Store.get("bills", pay.ref_id); if (b) { const paid = round((Number(b.paid) || 0) - Number(pay.amount)); Store.update("bills", b.id, { paid: Math.max(0, paid), status: paid <= 0.5 ? "posted" : "partial" }); } }
    Store.update("payments", pay.id, { status: "void" });
    audit("void", "payments", pay.id, pay.number);
  }

  /* ---------- Void GRN (batch 18) ---------- */
  function voidGRN(poId) {
    reverseJournal("GRN", poId);
    Store.where("stock_moves", m => m.ref_type === "GRN" && m.ref_id === poId).forEach(m => { recordMove(m.item_id, m.type === "in" ? "out" : "in", m.qty, m.unit_cost, "GRN_VOID", poId); });
  }

  /* ---------- Retention / Job costing / BOM / Profit tax ---------- */
  function releaseRetention({ project_id, bank_id, amount, date }) {
    assertOpen(date);
    const bank = Store.get("bank_accounts", bank_id);
    postJournal({ date: date || new Date().toISOString().slice(0,10), source_type: "RETENTION", source_id: project_id || "", memo: "ຮັບເງິນຄ້ຳປະກັນ", lines: [{ account: bank.gl_account, debit: round(amount), credit: 0, memo: "ຮັບ retention" }, { account: PA("RETENTION"), debit: 0, credit: round(amount), memo: "ຫຼຸດ retention" }] });
  }
  function computeBomCost(bomId) {
    return round(Store.where("bom_lines", l => l.bom_id === bomId).reduce((s, c) => { const it = Store.get("items", c.item_id) || {}; return s + (Number(it.avg_cost) || 0) * Number(c.qty); }, 0));
  }
  function buildProduct(bomId, qty) {
    assertOpen(null);
    const bom = Store.get("boms", bomId); const comps = Store.where("bom_lines", l => l.bom_id === bomId);
    let cost = 0;
    comps.forEach(c => { const need = Number(c.qty) * qty; const cg = computeCOGS(c.item_id, need); cost += cg; recordMove(c.item_id, "out", need, cg / (need || 1), "BUILD", bomId); });
    recordMove(bom.item_id, "in", qty, cost / (qty || 1), "BUILD", bomId);
    audit("build", "items", bom.item_id, qty + " @ " + round(cost));
    return round(cost);
  }
  function profitTaxProvision(rate, date) {
    assertOpen(date);
    const ni = plData().net; if (ni <= 0) throw new Error("ບໍ່ມີກຳໄລໃຫ້ຄິດອາກອນ");
    const tax = round(ni * rate / 100);
    postJournal({ date: date || new Date().toISOString().slice(0,10), source_type: "PROFIT_TAX", source_id: "", memo: "ຕັ້ງສຳຮອງອາກອນກຳໄລ " + rate + "%", lines: [{ account: PA("PTAX_EXP"), debit: tax, credit: 0, memo: "ຄ່າອາກອນກຳໄລ" }, { account: PA("PTAX_PAY"), debit: 0, credit: tax, memo: "ອາກອນກຳໄລຄ້າງຈ່າຍ" }] });
    return tax;
  }
  function whtEntry({ vendor_id, base, rate, date, bill_id }) {
    assertOpen(date);
    const tax = round(base * rate / 100);
    const bill = bill_id ? Store.get("bills", bill_id) : null;
    if (bill) { // withheld tax settles part of THIS bill: keeps the AP subledger equal to the ledger
      const open = round(Number(bill.total) - (Number(bill.paid) || 0));
      if (tax > open + 0.5) throw new Error("WHT ເກີນຍອດຄ້າງຂອງ Bill (ຄ້າງ " + open + ")");
      vendor_id = bill.vendor_id;
    }
    postJournal({ date: date || new Date().toISOString().slice(0,10), source_type: "WHT", source_id: vendor_id || "", memo: "ຫັກ WHT " + rate + "%", lines: [{ account: PA("AP"), debit: tax, credit: 0, memo: "ຫຼຸດເຈົ້າໜີ້ (WHT)" }, { account: PA("WHT"), debit: 0, credit: tax, memo: "WHT ຄ້າງຍືນ" }] });
    if (bill) { const paid = round((Number(bill.paid) || 0) + tax); Store.update("bills", bill.id, { paid, status: paid >= Number(bill.total) - 0.5 ? "paid" : "partial" }); }
    return tax;
  }

  /* ---------- Audit ---------- */
  function audit(action, entity, entity_id, detail) {
    Store.insert("audit_log", { ts: new Date().toISOString(), user: "Taow", action, entity, entity_id, detail: detail || "" });
  }

  window.Acc = {
    round, acc, accName, nextNumber, taxRate,
    lotsFor, stockQty, stockValue, computeCOGS, recordMove,
    assertOpen, postJournal, reverseJournal,
    invoiceTotals, postInvoice, billTotals, postBill,
    receivePayment, payBill,
    accountMovements, accountBalance, sumByType, plData,
    arOutstanding, apOutstanding, cashBalance, aging, audit,
    postCreditNote, postDebitNote, bankTransfer, customerAdvance, stockAdjust,
    disposeAsset, capitalisePrepaid, amortisePrepaid, bookDeferred, recogniseDeferred,
    yearEndClose, cashFlow, cashFlowGL, cashAccountCodes,
    writeOffBadDebt, fxAdjust, landedCost, computeECL, recogniseECL, nrvWritedown, impairAsset, workingCapital,
    depreciateCatchUp, projectPL,
    voidInvoice, voidBill, voidPayment, voidGRN,
    releaseRetention, computeBomCost, buildProduct, profitTaxProvision, whtEntry,
    PA, POSTING_DEFAULTS, nextVoucher, entityCode
  };
})();


