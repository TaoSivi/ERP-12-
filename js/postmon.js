/* ============================================================
   LaoBooks ERP – Posting monitor (ຕິດຕາມການລົງບັນຊີ)
   • health(): integrity of what the posting engine produced — every journal balanced, AR / AP / stock sub-ledgers
     equal to the ledger, items waiting in the POS / API inboxes that could not post, the period lock.
   • bySource(): how many journals each module created (and for how much) in the last N days.
   • closePeriod(date): trial-balance snapshot FIRST, then the lock date moves — nothing before it can be posted again.
   • logRules(map): every change of the posting rules is kept (who, when, what) so old journals can be explained.
   Pure logic (reads Store / Acc only) so it can be unit-tested in Node.
   ============================================================ */
(function () {
  const round = n => Math.round((Number(n) || 0) * 100) / 100;
  const who = () => { try { return (window.AppCtx && AppCtx.userLabel && AppCtx.userLabel()) || "system"; } catch (e) { return "system"; } };
  const live = j => j.status === "posted" || j.status === "reversed";

  function health() {
    const jes = Store.all("journal_entries").filter(live), lines = Store.all("journal_lines"), by = {};
    lines.forEach(l => { (by[l.je_id] = by[l.je_id] || []).push(l); });
    const unbalanced = jes.filter(j => { const ls = by[j.id] || []; return Math.abs(ls.reduce((s, l) => s + (+l.debit || 0) - (+l.credit || 0), 0)) > 0.5; }).map(j => j.number);
    const stock = Store.where("items", i => i.type === "stock").reduce((s, i) => s + Acc.stockValue(i.id), 0);
    const sub = (name, subledger, gl) => ({ name, subledger: round(subledger), gl: round(gl), diff: round(gl - subledger), ok: Math.abs(gl - subledger) < 1 });
    const c = Store.get("settings", "company") || {};
    return {
      journals: jes.length, unbalanced,
      subledgers: [sub("ລູກໜີ້ (AR)", Acc.arOutstanding(), Acc.accountBalance(Acc.PA("AR"))), sub("ເຈົ້າໜີ້ (AP)", Acc.apOutstanding(), Acc.accountBalance(Acc.PA("AP"))), sub("ສິນຄ້າຄົງເຫຼືອ", stock, Acc.accountBalance(Acc.PA("INV")))],
      inbox: { pos_blocked: Store.where("pos_days", r => r.status === "blocked").length, pos_held: Store.where("pos_days", r => r.status === "held").length, api_blocked: Store.where("ext_in", r => r.status === "blocked").length },
      lock_date: c.lock_date || ""
    };
  }

  function bySource(days) {
    const from = new Date(Date.now() - (days || 30) * 86400000).toISOString().slice(0, 10), m = {};
    Store.all("journal_entries").filter(j => live(j) && (j.date || "") >= from).forEach(j => { const k = String(j.source_type || "-").replace(/^EXT:.*/, "EXT"); m[k] = m[k] || { source: k, count: 0, total: 0 }; m[k].count++; m[k].total = round(m[k].total + (+j.total_debit || 0)); });
    return Object.values(m).sort((a, b) => b.count - a.count);
  }

  function trialBalance(asOf) {
    const dates = {}; Store.all("journal_entries").forEach(j => { if (live(j)) dates[j.id] = j.date || ""; });
    const net = {}; Store.all("journal_lines").forEach(l => { const d = dates[l.je_id]; if (d === undefined || d > asOf) return; net[l.account] = (net[l.account] || 0) + (+l.debit || 0) - (+l.credit || 0); });
    const rows = Store.all("accounts").filter(a => !a.is_header && Math.abs(net[a.code] || 0) > 0.5).map(a => ({ code: a.code, name: a.name, type: a.type, net: round(net[a.code]) })).sort((a, b) => String(a.code).localeCompare(String(b.code)));
    return { rows, dr: round(rows.reduce((s, r) => s + Math.max(r.net, 0), 0)), cr: round(rows.reduce((s, r) => s - Math.min(r.net, 0), 0)) };
  }

  function closePeriod(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || isNaN(Date.parse(date))) throw new Error("ວັນທີບໍ່ຖືກ");
    const c = Store.get("settings", "company") || {};
    if (c.lock_date && date < c.lock_date) throw new Error("ວັນທີຕ້ອງບໍ່ກ່ອນວັນລັອກເດີມ (" + c.lock_date + ")");
    const tb = trialBalance(date);
    if (Math.abs(tb.dr - tb.cr) > 1) throw new Error("Trial Balance ບໍ່ສົມດຸນ ປິດງວດບໍ່ໄດ້ (Dr " + tb.dr + " ≠ Cr " + tb.cr + ")");
    const snap = { id: "snap_" + date, date, taken_at: new Date().toISOString(), by: who(), dr: tb.dr, cr: tb.cr, rows: tb.rows };
    if (Store.get("settings", "snap_" + date)) Store.update("settings", "snap_" + date, snap); else Store.insert("settings", snap);
    Store.update("settings", "company", { lock_date: date });
    Acc.audit("edit", "settings", "lock_date", "ປິດງວດ " + date + " · snapshot Dr " + tb.dr);
    return snap;
  }
  const snapshots = () => Store.all("settings").filter(s => String(s.id).indexOf("snap_") === 0).sort((a, b) => b.date.localeCompare(a.date));

  // keep every version of the posting rules (newest first, 50 max)
  function logRules(map, note) {
    const cur = Store.get("settings", "posting_history"), items = [{ ts: new Date().toISOString(), by: who(), note: note || "", rules: JSON.parse(JSON.stringify(map || {})) }].concat((cur && cur.items) || []).slice(0, 50);
    if (cur) Store.update("settings", "posting_history", { items }); else Store.insert("settings", { id: "posting_history", items });
  }
  // put an older version of the rules back (the restore itself is logged as a new version; old journals are never touched)
  function restoreRules(index) {
    const h = ruleHistory()[index]; if (!h) throw new Error("ບໍ່ພົບເວີຊັນ");
    const cur = Store.get("settings", "posting"); if (cur) Store.update("settings", "posting", Object.assign({}, h.rules, { id: "posting" })); else Store.insert("settings", Object.assign({ id: "posting" }, h.rules));
    logRules(h.rules, "ກູ້ຄືນຈາກ " + h.ts.slice(0, 16));
  }
  const ruleHistory = () => ((Store.get("settings", "posting_history") || {}).items) || [];

  /* ---------- preview / simulation: run a posting on a COPY of the data and return the journals it would create ---------- */
  function simulate(fn) {
    const before = new Set(Store.all("journal_entries").map(j => j.id)), out = { ok: true, error: "", entries: [] };
    Store.dryRun(() => {
      try { fn(); } catch (e) { out.ok = false; out.error = e.message; }
      out.entries = Store.all("journal_entries").filter(j => !before.has(j.id)).map(j => ({ number: j.number, date: j.date, memo: j.memo,
        lines: Store.where("journal_lines", l => l.je_id === j.id).map(l => ({ account: l.account, name: l.account_name, debit: l.debit, credit: l.credit })) }));
    });
    return out;
  }

  /* ---------- posting error queue: every failed post from the UI is kept (who, what, why) ---------- */
  function logError(fn, msg) {
    if (Store.isDry()) return;
    const cur = Store.get("settings", "post_errors"), items = [{ ts: new Date().toISOString(), by: who(), fn, msg: String(msg) }].concat((cur && cur.items) || []).slice(0, 100);
    if (cur) Store.update("settings", "post_errors", { items }); else Store.insert("settings", { id: "post_errors", items });
  }
  const errors = () => ((Store.get("settings", "post_errors") || {}).items) || [];
  const clearErrors = () => { if (Store.get("settings", "post_errors")) Store.update("settings", "post_errors", { items: [] }); };
  ["postInvoice", "postBill", "receivePayment", "payBill", "postCreditNote", "postDebitNote", "postJournal", "bankTransfer", "stockAdjust", "writeOffBadDebt"].forEach(fn => {
    const orig = Acc[fn]; if (typeof orig !== "function") return;
    Acc[fn] = function () { try { return orig.apply(this, arguments); } catch (e) { logError(fn, e.message); throw e; } };
  });

  // profit & loss grouped by a journal dimension (branch | project | cc) — journals with no dimension are "ບໍ່ລະບຸ"
  function plBy(key, from, to) {
    const typ = {}; Store.all("accounts").forEach(a => { typ[a.code] = a.type; });
    const by = {}, grp = {}; Store.all("journal_entries").forEach(j => { if (live(j) && (!from || j.date >= from) && (!to || j.date <= to)) grp[j.id] = (j.dim && j.dim[key]) || ""; });
    Store.all("journal_lines").forEach(l => {
      const g = grp[l.je_id]; if (g === undefined) return; const t = typ[l.account]; if (t !== "Revenue" && t !== "Expense") return;
      const r = by[g] = by[g] || { value: g, revenue: 0, expense: 0 };
      if (t === "Revenue") r.revenue += (+l.credit || 0) - (+l.debit || 0); else r.expense += (+l.debit || 0) - (+l.credit || 0);
    });
    return Object.values(by).map(r => ({ value: r.value, revenue: round(r.revenue), expense: round(r.expense), profit: round(r.revenue - r.expense) })).sort((a, b) => b.revenue - a.revenue);
  }

  window.PostMon = { plBy, health, bySource, trialBalance, closePeriod, snapshots, logRules, ruleHistory, restoreRules, simulate, errors, clearErrors, logError };
})();
