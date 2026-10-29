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
  const ruleHistory = () => ((Store.get("settings", "posting_history") || {}).items) || [];

  window.PostMon = { health, bySource, trialBalance, closePeriod, snapshots, logRules, ruleHistory };
})();
