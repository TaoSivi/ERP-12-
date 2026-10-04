/* ============================================================
   LaoBooks ERP – Auto-Posting engine
   ------------------------------------------------------------
   Posts the routine, already-approved entries on schedule so nobody has to
   remember (or double-click) them:
     DEPR      monthly depreciation of fixed assets
     PREPAID   monthly amortisation of prepaid expenses
     DEFERRED  monthly recognition of deferred revenue
     REC_JE    recurring journals   (only those marked auto)
     REC_INV   recurring invoices   (only those marked auto)
     ACCRUAL   month-end accrued expense (Dr expense / Cr 2160), auto-reversed on the 1st (ACCRUAL_REV)
     VAT_CLOSE month-end: clear the month's output/input VAT into net VAT payable 2250   (opt-in)
     PTAX      month-end: top up profit-tax provision to YTD profit x rate              (opt-in)
     + auto-lock: N days after a month ends, lock it                                    (opt-in)
   Rules that make it safe:
   • IDEMPOTENT  – every posting writes an `auto_runs` row keyed TYPE:ref:YYYY-MM.
                   A period can never be posted twice, whether by the engine or by a manual button.
   • NO FLOOD    – nothing before `start` (set when auto-posting is enabled) is ever back-filled.
   • LOCK-AWARE  – periods on/before the company lock date are skipped and reported.
   • ISOLATED    – one failing task never stops the others; failures are reported, not recorded,
                   so they retry on the next run.
   Pure logic (no DOM): testable in Node. Static app → the engine runs when the app is opened;
   a true scheduler needs the backend (see README).
   ============================================================ */
(function () {
  const pad = n => String(n).padStart(2, "0");
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const periodOf = d => String(d).slice(0, 7);
  const monthEnd = p => { const [y, m] = p.split("-").map(Number); return p + "-" + pad(new Date(Date.UTC(y, m, 0)).getUTCDate()); };
  const nextPeriod = p => { const [y, m] = p.split("-").map(Number); return m === 12 ? (y + 1) + "-01" : y + "-" + pad(m + 1); };
  const prevPeriod = p => { const [y, m] = p.split("-").map(Number); return m === 1 ? (y - 1) + "-12" : y + "-" + pad(m - 1); };
  const maxP = (a, b) => (a > b ? a : b);
  const round = n => Acc.round(n);

  function periodsBetween(from, to) {
    const out = []; let p = from, guard = 0;
    while (p <= to && guard++ < 600) { out.push(p); p = nextPeriod(p); }
    return out;
  }
  // last month that has fully ended as of `today`
  function lastCompleted(today) { const p = periodOf(today); return monthEnd(p) <= today ? p : prevPeriod(p); }

  /* ---------- config ---------- */
  function getConfig() {
    const c = Store.get("settings", "autopost");
    return { enabled: !!(c && c.enabled), start: (c && c.start) || periodOf(todayStr()),
      vat_close: !!(c && c.vat_close), ptax_rate: Number(c && c.ptax_rate) || 0, autolock_days: Number(c && c.autolock_days) || 0 };
  }
  function setConfig(patch) {
    const cur = Store.get("settings", "autopost");
    if (cur) Store.update("settings", "autopost", patch);
    else Store.insert("settings", Object.assign({ id: "autopost", enabled: false, start: periodOf(todayStr()) }, patch));
  }

  /* ---------- idempotency ledger ---------- */
  const hasRun = key => Store.where("auto_runs", r => r.key === key).length > 0;
  function markRun(key, type, ref, period, je_id, amount, extra) {
    Store.insert("auto_runs", Object.assign({ key, type, ref_id: ref, period, je_id: je_id || "", amount: round(amount), ts: new Date().toISOString() }, extra || {}));
  }
  const isLocked = date => { const s = Store.get("settings", "company"); return !!(s && s.lock_date && date <= s.lock_date); };
  const lastJe = (srcType, srcId) => Store.where("journal_entries", j => j.source_type === srcType && j.source_id === srcId).slice(-1)[0];

  /* ---------- the five posters. `date` is the posting date (month-end for the engine, today for manual) ---------- */
  function doDepr(period, date) {
    const assets = Store.where("assets", a =>
      a.status === "active" && Number(a.acc_dep) < Number(a.cost) &&
      (!a.date || periodOf(a.date) <= period) && !hasRun("DEPR:" + a.id + ":" + period));
    const parts = [];
    assets.forEach(a => {
      const m = round(Math.min(Number(a.cost) / Number(a.life_months || 1), Number(a.cost) - Number(a.acc_dep)));
      if (m > 0) parts.push([a, m]);
    });
    if (!parts.length) return null;
    const total = round(parts.reduce((s, p) => s + p[1], 0));
    const je = Acc.postJournal({
      date, source_type: "DEPR", source_id: "", memo: "ຄ່າເສື່ອມລາຄາ " + period,
      lines: [{ account: Acc.PA("DEPR"), debit: total, credit: 0, memo: "ຄ່າເສື່ອມ" }, { account: Acc.PA("ACC_DEPR"), debit: 0, credit: total, memo: "ເສື່ອມສະສົມ" }]
    });
    parts.forEach(([a, m]) => {
      Store.update("assets", a.id, { acc_dep: round(Number(a.acc_dep) + m) });
      markRun("DEPR:" + a.id + ":" + period, "DEPR", a.id, period, je.id, m);
    });
    return { amount: total, count: parts.length };
  }

  function doSchedule(kind, item, period, date) { // kind: PREPAID | DEFERRED
    const key = kind + ":" + item.id + ":" + period;
    if (hasRun(key)) return null;
    const coll = kind === "PREPAID" ? "prepaids" : "deferreds", field = kind === "PREPAID" ? "amortised" : "recognised";
    const fresh = Store.get(coll, item.id);
    if (!fresh || fresh.status !== "active") return null;
    const before = Number(fresh[field] || 0);
    if (before >= Number(fresh.total) - 0.005) return null;
    if (kind === "PREPAID") Acc.amortisePrepaid(fresh, date); else Acc.recogniseDeferred(fresh, date);
    const amt = round(Number(Store.get(coll, item.id)[field] || 0) - before);
    if (amt <= 0) return null;
    const je = lastJe(kind === "PREPAID" ? "PREPAID_AMT" : "DEFERRED_REC", item.id);
    markRun(key, kind, item.id, period, je && je.id, amt);
    return { amount: amt, count: 1 };
  }

  function doRecJE(r, period, date) {
    const key = "REC_JE:" + r.id + ":" + period;
    if (hasRun(key)) return null;
    const bank = Store.all("bank_accounts")[0];
    const je = Acc.postJournal({
      date, source_type: "RECURRING", source_id: r.id, memo: "Recurring " + r.name,
      lines: [{ account: r.account || "5200", debit: Number(r.amount), credit: 0, memo: r.name }, { account: bank ? bank.gl_account : "1100", debit: 0, credit: Number(r.amount), memo: "ຈ່າຍ" }]
    });
    markRun(key, "REC_JE", r.id, period, je.id, r.amount);
    return { amount: Number(r.amount), count: 1 };
  }

  function doRecInv(r, period, date) {
    const key = "REC_INV:" + r.id + ":" + period;
    if (hasRun(key)) return null;
    Acc.assertOpen(date); // before creating anything, so a locked period leaves no draft behind
    const due = new Date(Date.parse(date) + 30 * 86400000).toISOString().slice(0, 10);
    const inv = Store.insert("invoices", { number: Acc.nextNumber("INV", "invoices", date), customer_id: r.customer_id, date, due_date: due, currency: "LAK", fx_rate: 1, note: "Recurring: " + r.name, project_id: "", cc_id: "", status: "draft", paid: 0, created_at: new Date().toISOString() });
    Store.insert("invoice_lines", { invoice_id: inv.id, item_id: r.item_id, qty: r.qty, price: r.price, discount: 0, tax_code: r.tax_code || "tax_out10" });
    let je;
    try { je = Acc.postInvoice(inv); }
    catch (e) { // never leave a half-made invoice behind
      Store.where("invoice_lines", l => l.invoice_id === inv.id).forEach(l => Store.remove("invoice_lines", l.id));
      Store.remove("invoices", inv.id);
      throw e;
    }
    markRun(key, "REC_INV", r.id, period, je.id, Store.get("invoices", inv.id).total);
    return { amount: Number(Store.get("invoices", inv.id).total) || 0, count: 1 };
  }

  /* ---------- accruals, VAT close, profit-tax provision ---------- */
  function doAccrual(a, period, date) {
    const key = "ACCRUAL:" + a.id + ":" + period; if (hasRun(key)) return null;
    const amt = round(a.amount); if (!(amt > 0)) return null;
    const je = Acc.postJournal({ date, source_type: "ACCRUAL", source_id: a.id, memo: "ຄ້າງຈ່າຍ " + a.name + " " + period,
      lines: [{ account: a.account, debit: amt, credit: 0, memo: a.name }, { account: Acc.PA("ACCRUED"), debit: 0, credit: amt, memo: "ຄ້າງຈ່າຍ " + a.name }] });
    markRun(key, "ACCRUAL", a.id, period, je.id, amt, { account: a.account, name: a.name });
    return { amount: amt, count: 1 };
  }
  function doAccrualRev(run, date) {
    const key = "ACCRUAL_REV:" + run.ref_id + ":" + run.period; if (hasRun(key)) return null;
    const je = Acc.postJournal({ date, source_type: "ACCRUAL_REV", source_id: run.ref_id, memo: "ກັບລາຍການຄ້າງຈ່າຍ " + (run.name || "") + " " + run.period,
      lines: [{ account: Acc.PA("ACCRUED"), debit: run.amount, credit: 0, memo: "ກັບລາຍການ" }, { account: run.account, debit: 0, credit: run.amount, memo: "ກັບລາຍການ " + (run.name || "") }] });
    markRun(key, "ACCRUAL_REV", run.ref_id, run.period, je.id, run.amount);
    return { amount: run.amount, count: 1 };
  }
  // net movement of an account between two dates (debit − credit), skipping the given source types
  function movement(code, from, to, skip) {
    let t = 0;
    Store.all("journal_lines").forEach(l => {
      if (String(l.account) !== String(code)) return;
      const je = Store.get("journal_entries", l.je_id);
      if (!je || !(je.status === "posted" || je.status === "reversed") || je.date < from || je.date > to || (skip && skip.indexOf(je.source_type) !== -1)) return;
      t += Number(l.debit) - Number(l.credit);
    });
    return round(t);
  }
  function vatOf(period) {
    const from = period + "-01", to = monthEnd(period), skip = ["VAT_CLOSE"];
    const out = round(-movement(Acc.PA("VAT_OUT"), from, to, skip)), inn = round(movement(Acc.PA("VAT_IN"), from, to, skip));
    return { out, inn, net: round(out - inn) };
  }
  function doVatClose(period, date) {
    const key = "VAT_CLOSE:*:" + period; if (hasRun(key)) return null;
    const v = vatOf(period); if (!v.out && !v.inn) return null;
    const jl = [];
    if (v.out) jl.push({ account: Acc.PA("VAT_OUT"), debit: v.out, credit: 0, memo: "ປິດ VAT ຂາຍ " + period });
    if (v.inn) jl.push({ account: Acc.PA("VAT_IN"), debit: 0, credit: v.inn, memo: "ປິດ VAT ຊື້ " + period });
    if (v.net > 0) jl.push({ account: Acc.PA("VAT_PAY"), debit: 0, credit: v.net, memo: "VAT ຕ້ອງຍື່ນ " + period });
    if (v.net < 0) jl.push({ account: Acc.PA("VAT_PAY"), debit: -v.net, credit: 0, memo: "VAT ຄ້າງຮັບ " + period });
    const je = Acc.postJournal({ date, source_type: "VAT_CLOSE", source_id: period, memo: "ປິດ VAT " + period + " (ຂາຍ " + v.out + " − ຊື້ " + v.inn + ")", lines: jl });
    markRun(key, "VAT_CLOSE", "", period, je.id, v.net);
    return { amount: v.net, count: 1 };
  }
  // profit before tax, year-to-date up to the end of `period`
  function ytdProfit(period) {
    const from = period.slice(0, 4) + "-01-01", to = monthEnd(period), skip = ["YEAR_END"];
    let p = 0;
    Store.where("accounts", a => !a.is_header && (a.type === "Revenue" || a.type === "Expense") && String(a.code) !== String(Acc.PA("PTAX_EXP"))).forEach(a => {
      p -= movement(a.code, from, to, skip); // revenue is credit (−), expense is debit (+)
    });
    return round(p);
  }
  function ptaxDelta(period, rate) {
    const from = period.slice(0, 4) + "-01-01", to = monthEnd(period);
    const target = Math.max(0, round(ytdProfit(period) * rate / 100));
    const provided = movement(Acc.PA("PTAX_EXP"), from, to, ["YEAR_END"]);
    return round(target - provided);
  }
  function doPtax(period, date, rate) {
    const key = "PTAX:*:" + period; if (hasRun(key)) return null;
    const d = ptaxDelta(period, rate);
    if (Math.abs(d) < 1) { markRun(key, "PTAX", "", period, "", 0); return null; }
    const je = Acc.postJournal({ date, source_type: "PROFIT_TAX", source_id: period, memo: "ສຳຮອງອາກອນກຳໄລ " + rate + "% ຮອດ " + period,
      lines: d > 0 ? [{ account: Acc.PA("PTAX_EXP"), debit: d, credit: 0, memo: "ອາກອນກຳໄລ" }, { account: Acc.PA("PTAX_PAY"), debit: 0, credit: d, memo: "ອາກອນກຳໄລຄ້າງຈ່າຍ" }]
                   : [{ account: Acc.PA("PTAX_PAY"), debit: -d, credit: 0, memo: "ປັບຫຼຸດ" }, { account: Acc.PA("PTAX_EXP"), debit: 0, credit: -d, memo: "ປັບຫຼຸດອາກອນກຳໄລ" }] });
    markRun(key, "PTAX", "", period, je.id, d);
    return { amount: d, count: 1 };
  }

  /* ---------- plan: what is due as of `today` ---------- */
  function buildPlan(today, onlyItem) {
    today = today || todayStr();
    const cfg = getConfig(), last = lastCompleted(today), tasks = [];
    // explicit per-item catch-up (onlyItem.ignoreStart) starts from the item's own start, not the global one
    const startFor = itemStart => (onlyItem && onlyItem.ignoreStart) ? (itemStart || periodOf(today)) : maxP(cfg.start, itemStart || cfg.start);
    const push = (type, ref, label, period, date, amount, exec) => {
      if (onlyItem && !(onlyItem.type === type && onlyItem.ref === ref)) return;
      tasks.push({ key: type + ":" + (ref || "*") + ":" + period, type, ref, label, period, date, amount: round(amount), locked: isLocked(date), exec });
    };

    // depreciation – simulate per asset so the plan never shows more than the remaining cost
    const sim = {};
    Store.where("assets", a => a.status === "active" && Number(a.acc_dep) < Number(a.cost)).forEach(a => { sim[a.id] = Number(a.acc_dep); });
    periodsBetween(cfg.start, last).forEach(p => {
      let amt = 0;
      Store.where("assets", a => sim[a.id] !== undefined && (!a.date || periodOf(a.date) <= p) && !hasRun("DEPR:" + a.id + ":" + p)).forEach(a => {
        const m = Math.min(Number(a.cost) / Number(a.life_months || 1), Number(a.cost) - sim[a.id]);
        if (m > 0) { amt += m; if (!isLocked(monthEnd(p))) sim[a.id] += m; }
      });
      if (amt > 0) push("DEPR", "", "ຄ່າເສື່ອມລາຄາ " + p, p, monthEnd(p), amt, () => doDepr(p, monthEnd(p)));
    });

    // prepaid + deferred – fixed amount per period until the total is used up
    [["PREPAID", "prepaids", "amortised", "ຕັດຄ່າລ່ວງໜ້າ "], ["DEFERRED", "deferreds", "recognised", "ຮັບຮອງລາຍຮັບ "]].forEach(([kind, coll, field, lbl]) => {
      Store.where(coll, x => x.status === "active").forEach(x => {
        let remain = Number(x.total) - Number(x[field] || 0);
        const per = round(Number(x.total) / Number(x.periods || 1));
        periodsBetween(startFor(x.start), last).forEach(p => {
          if (remain <= 0.005 || hasRun(kind + ":" + x.id + ":" + p)) return;
          const amt = Math.min(per, remain);
          if (!isLocked(monthEnd(p))) remain -= amt;
          push(kind, x.id, lbl + x.name + " " + p, p, monthEnd(p), amt, () => doSchedule(kind, x, p, monthEnd(p)));
        });
      });
    });

    // recurring (only those explicitly marked auto) – posted on their day of month
    Store.where("recurring", r => r.auto === true || r.auto === "1" || r.auto === 1).forEach(r => {
      const isInv = r.rtype === "invoice", type = isInv ? "REC_INV" : "REC_JE";
      const day = Math.min(28, Math.max(1, Number(r.day) || 1));
      periodsBetween(startFor(r.start), periodOf(today)).forEach(p => {
        const date = p + "-" + pad(day);
        if (date > today || (r.end_period && p > r.end_period) || hasRun(type + ":" + r.id + ":" + p)) return;
        const amt = isInv ? (Number(r.qty) || 1) * (Number(r.price) || 0) : Number(r.amount);
        push(type, r.id, (isInv ? "Invoice ຊ້ຳ " : "JE ຊ້ຳ ") + r.name + " " + p, p, date, amt, () => (isInv ? doRecInv(r, p, date) : doRecJE(r, p, date)));
      });
    });

    // accruals (month-end) and their reversal on the 1st of the next month
    Store.where("accruals", a => a.active !== false).forEach(a => {
      periodsBetween(startFor(a.start), last).forEach(p => {
        if (!hasRun("ACCRUAL:" + a.id + ":" + p)) push("ACCRUAL", a.id, "ຄ້າງຈ່າຍ " + a.name + " " + p, p, monthEnd(p), a.amount, () => doAccrual(a, p, monthEnd(p)));
      });
    });
    Store.where("auto_runs", r => r.type === "ACCRUAL").forEach(run => {
      const d = nextPeriod(run.period) + "-01";
      if (d <= today && !hasRun("ACCRUAL_REV:" + run.ref_id + ":" + run.period))
        push("ACCRUAL_REV", run.ref_id, "ກັບລາຍການຄ້າງຈ່າຍ " + (run.name || "") + " " + run.period, run.period, d, run.amount, () => doAccrualRev(run, d));
    });
    // opt-in month-end closes
    if (cfg.vat_close) periodsBetween(cfg.start, last).forEach(p => {
      if (hasRun("VAT_CLOSE:*:" + p)) return;
      const v = vatOf(p); if (v.out || v.inn) push("VAT_CLOSE", "", "ປິດ VAT " + p, p, monthEnd(p), v.net, () => doVatClose(p, monthEnd(p)));
    });
    if (cfg.ptax_rate > 0) periodsBetween(cfg.start, last).forEach(p => {
      if (!hasRun("PTAX:*:" + p)) push("PTAX", "", "ສຳຮອງອາກອນກຳໄລ " + cfg.ptax_rate + "% " + p, p, monthEnd(p), ptaxDelta(p, cfg.ptax_rate), () => doPtax(p, monthEnd(p), cfg.ptax_rate));
    });

    // closes run after the month's other postings on the same date
    const ORDER = { VAT_CLOSE: 8, PTAX: 9 };
    return tasks.sort((a, b) => a.date.localeCompare(b.date) || (ORDER[a.type] || 0) - (ORDER[b.type] || 0) || a.type.localeCompare(b.type));
  }

  /* ---------- run ---------- */
  function run(today, onlyItem) {
    const result = { posted: [], skipped: [], errors: [] };
    // a posting can make new work due (an accrual makes its reversal due) → re-plan until nothing new appears
    const seen = new Set();
    for (let pass = 0; pass < 4; pass++) {
      const plan = buildPlan(today, onlyItem).filter(t => !seen.has(t.key));
      if (!plan.length) break;
      plan.forEach(t => {
        seen.add(t.key);
        if (t.locked) { result.skipped.push({ key: t.key, label: t.label, reason: "ງວດຖືກລັອກ" }); return; }
        try {
          const r = t.exec();
          if (r) {
            result.posted.push({ key: t.key, type: t.type, label: t.label, date: t.date, amount: r.amount });
            Acc.audit("autopost", t.type, t.ref || "", t.label + " " + r.amount);
          }
        } catch (e) { result.errors.push({ key: t.key, label: t.label, error: e.message }); }
      });
    }
    // auto-lock: N days after a month ends, lock it — only if nothing for that month failed or is still due
    const cfg = getConfig();
    if (!onlyItem && cfg.autolock_days > 0) {
      const t = today || todayStr(), prev = lastCompleted(t), lockTo = monthEnd(prev);
      const company = Store.get("settings", "company") || {};
      const days = Math.floor((Date.parse(t) - Date.parse(lockTo)) / 86400000);
      const pendingForPrev = result.errors.length || buildPlan(t).some(x => !x.locked && x.date <= lockTo);
      if (days >= cfg.autolock_days && (!company.lock_date || company.lock_date < lockTo) && !pendingForPrev) {
        Store.update("settings", "company", { lock_date: lockTo });
        Acc.audit("autolock", "settings", "company", "lock_date → " + lockTo);
        result.locked = lockTo;
      }
    }
    return result;
  }

  /* ---------- manual buttons: same ledger, so they can't double-post what the engine will do ---------- */
  function manual(type, ref, today) {
    today = today || todayStr();
    const period = periodOf(today);
    let r;
    if (type === "DEPR") r = doDepr(period, today);
    else if (type === "PREPAID" || type === "DEFERRED") r = doSchedule(type, Store.get(type === "PREPAID" ? "prepaids" : "deferreds", ref), period, today);
    else if (type === "REC_JE") r = doRecJE(Store.get("recurring", ref), period, today);
    else if (type === "REC_INV") r = doRecInv(Store.get("recurring", ref), period, today);
    if (!r) throw new Error("ງວດ " + period + " ຖືກບັນທຶກແລ້ວ (ຫຼືບໍ່ມີຍອດຕ້ອງບັນທຶກ) — ບໍ່ບັນທຶກຊ້ຳ");
    Acc.audit("autopost", type, ref || "", "manual " + period + " " + r.amount);
    return r;
  }

  window.Autopost = { getConfig, setConfig, buildPlan, run, manual, periodOf, monthEnd, lastCompleted, vatOf, ytdProfit };
})();
