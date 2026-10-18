/* ============================================================
   LaoBooks ERP – POS inbox (ST POS → ERP, automatic posting)
   ------------------------------------------------------------
   ST POS keeps the shop (bills, stock, shifts). Every closed day it offers ONE accounting summary
   (server: GET ?hq=acct, read-only, own ACCT_TOKEN). This module pulls it, checks it, and posts
   one journal per branch-day — without the accounting department touching it:

     clean day  → posted at once (auto)
     odd day    → held for a person to approve (cash over/short, big refund/void, sales far from normal …)
     bad day    → blocked (does not balance, period locked) with the reason

   • IDEMPOTENT  one record per branch+date (`pos_days`); pulling again never posts twice.
   • CORRECTIONS if POS changes a day that is already posted (late refund …) only the DIFFERENCE is
                 posted as an adjustment journal; the original stays untouched.
   • OWNERSHIP   stock stays in POS. ERP books values: purchases (cat. materials) → inventory,
                 COGS / waste / count shortage → expense & inventory.
   Pure logic (no DOM) except the JSONP transport, which tests replace with setTransport().
   ============================================================ */
(function () {
  const round = n => Math.round(Number(n) || 0);
  const today = () => new Date().toISOString().slice(0, 10);
  const M_DEFAULT = {
    refundMethod: "ເງິນສົດ", drawer: "1110", methodDefault: "1100", sales: "4100", svc: "4300", tips: "2170", fees: "4200", deposits: "2500", waste: "5290", shortage: "5290", overshort: "5295",
    exp: { "ວັດຖຸດິບ/ສິນຄ້າ": "INV", "ເງິນເດືອນພະນັກງານ": "5300", "ຄ່າເຊົ່າ": "5210", "ໄຟຟ້າ-ນ້ຳ-ເນັດ": "5220", "ອຸປະກອນ/ສ້ອມແປງ": "5270", "ການຕະຫຼາດ": "5200", "ອື່ນໆ": "5200" }, expDefault: "5200", expFrom: "1110"
  };
  // payment method → account when the user has not mapped it yet
  const METHOD_RULES = [[/ເງິນສົດ|cash/i, "1110"], [/ບັດ|card|visa|master|pos/i, "1120"], [/ກະເປົາ|wallet|ມັດຈຳ/i, "2500"]];
  const CAT_RULES = [[/ເຄື່ອງດື່ມ|ເບຍ|ນ້ຳ|ກາເຟ|ຊາ|ບາ|drink|beer|bar|coffee/i, "4120"], [/ອາຫານ|ເຂົ້າ|ຈານ|ປີ້ງ|food/i, "4110"]];

  /* ---------- settings ---------- */
  const get = id => Store.get("settings", id);
  function put(id, patch) { if (get(id)) Store.update("settings", id, patch); else Store.insert("settings", Object.assign({ id }, patch)); }
  function link() {
    const c = get("pos_link") || {};
    let tok = ""; try { tok = localStorage.getItem("laobooks_pos_token") || ""; } catch (e) {}
    return { url: String(c.url || "").trim().replace(/\/+$/, ""), token: tok, auto: c.auto !== false, start: c.start || "", cash_diff_limit: c.cash_diff_limit != null ? Number(c.cash_diff_limit) : 50000,
      hold_on_warn: c.hold_on_warn !== false, last_pull: c.last_pull || "", last_result: c.last_result || null };
  }
  function setLink(patch, token) {
    put("pos_link", patch);
    if (token !== undefined) { try { if (token) localStorage.setItem("laobooks_pos_token", token); else localStorage.removeItem("laobooks_pos_token"); } catch (e) {} }
  }
  function mapping() {
    const c = get("pos_map") || {};
    return Object.assign({}, M_DEFAULT, c, { exp: Object.assign({}, M_DEFAULT.exp, c.exp || {}), methods: Object.assign({}, c.methods || {}), cats: Object.assign({}, c.cats || {}) });
  }
  function setMapping(patch) { put("pos_map", patch); }
  const acctMethod = (M, m) => { if (M.methods[m]) return M.methods[m]; const r = METHOD_RULES.find(x => x[0].test(m)); return r ? r[1] : M.methodDefault; };
  const acctCat = (M, c) => { if (M.cats[c]) return M.cats[c]; const r = CAT_RULES.find(x => x[0].test(c)); return r ? r[1] : M.sales; };
  const acctExp = (M, c) => { const v = M.exp[c]; return v === undefined ? M.expDefault : v; }; // "INV" = inventory, "SKIP" = do not book
  const real = code => code === "INV" ? Acc.PA("INV") : code;

  /* ---------- day → journal lines ---------- */
  // Everything is whole kip. Returns merged lines; Dr and Cr are compared by the caller.
  function buildLines(day, M) {
    M = M || mapping();
    const L = [], dr = (a, v, memo) => { v = round(v); if (v > 0) L.push({ account: String(a), debit: v, credit: 0, memo }); }, cr = (a, v, memo) => { v = round(v); if (v > 0) L.push({ account: String(a), debit: 0, credit: v, memo }); };
    const pay = Object.assign({}, day.pay || {});
    pay[M.refundMethod] = (pay[M.refundMethod] || 0) - (day.refunds || 0); // refunds are paid back out of this method
    Object.keys(pay).forEach(m => { const v = round(pay[m]); if (v > 0) dr(acctMethod(M, m), v, "ຮັບ " + m); else if (v < 0) cr(acctMethod(M, m), -v, "ຄືນເງິນ " + m); });
    dr(Acc.PA("AR"), day.credit, "ຂາຍຕິດໜີ້"); dr(M.deposits, day.depUsed, "ຫັກມັດຈຳ");
    Object.keys(day.byCat || {}).forEach(c => cr(acctCat(M, c), day.byCat[c], "ລາຍຮັບ " + c));
    cr(M.sales, day.depUsed, "ມັດຈຳທີ່ໃຊ້ (ເປັນລາຍຮັບ)");
    cr(M.svc, day.svc, "ຄ່າບໍລິການ"); cr(Acc.PA("VAT_OUT"), day.vat, "VAT ຂາຍ"); cr(M.tips, day.tips, "ທິບ (ຄ້າງຈ່າຍພະນັກງານ)"); cr(M.fees, day.fees, "ຄ່າທຳນຽມບັດທີ່ເກັບຈາກລູກຄ້າ");
    dr(Acc.PA("COGS"), day.cogs, "ຕົ້ນທຶນຂາຍ (ຕາມສູດ)"); cr(Acc.PA("INV"), day.cogs, "ຕັດສະຕັອກ (POS)");
    dr(M.waste, day.waste, "ຂອງເສຍ"); cr(Acc.PA("INV"), day.waste, "ຕັດຂອງເສຍ"); dr(M.shortage, day.shortage, "ຂາດຈາກການນັບສາງ"); cr(Acc.PA("INV"), day.shortage, "ຂາດຈາກການນັບສາງ");
    let expTot = 0;
    Object.keys(day.expenses || {}).forEach(c => { const a = acctExp(M, c); if (a === "SKIP") return; dr(real(a), day.expenses[c], "ຈ່າຍ " + c); expTot += day.expenses[c]; });
    cr(M.expFrom, expTot, "ຈ່າຍຈາກລິ້ນຊັກ");
    let cp = 0; Object.keys(day.creditPays || {}).forEach(m => { dr(acctMethod(M, m), day.creditPays[m], "ຮັບໜີ້ຄືນ " + m); cp += day.creditPays[m]; }); cr(Acc.PA("AR"), cp, "ຮັບໜີ້ຄືນ");
    let dp = 0; Object.keys(day.deposits || {}).forEach(m => { dr(acctMethod(M, m), day.deposits[m], "ຮັບມັດຈຳ " + m); dp += day.deposits[m]; }); cr(M.deposits, dp, "ມັດຈຳລູກຄ້າ");
    if (day.cashDiff < 0) { dr(M.overshort, -day.cashDiff, "ເງິນສົດຂາດ (ປິດກະ)"); cr(M.drawer, -day.cashDiff, "ເງິນສົດຂາດ (ປິດກະ)"); }
    else if (day.cashDiff > 0) { dr(M.drawer, day.cashDiff, "ເງິນສົດເກີນ (ປິດກະ)"); cr(M.overshort, day.cashDiff, "ເງິນສົດເກີນ (ປິດກະ)"); }
    const by = {}; // merge same account + side, so the journal stays readable
    L.forEach(l => { const k = l.account + (l.debit ? "D" : "C"); if (by[k]) { by[k].debit += l.debit; by[k].credit += l.credit; if (by[k].memo.indexOf(l.memo) < 0) by[k].memo += " · " + l.memo; } else by[k] = Object.assign({}, l); });
    return Object.keys(by).map(k => by[k]);
  }
  const totals = L => ({ dr: L.reduce((s, l) => s + l.debit, 0), cr: L.reduce((s, l) => s + l.credit, 0) });
  const netOf = L => { const m = {}; L.forEach(l => { m[l.account] = (m[l.account] || 0) + l.debit - l.credit; }); return m; };

  /* ---------- checks ---------- */
  // level "block": cannot post · "warn": a person should look · "info": FYI only
  function check(day, M, ctx) {
    M = M || mapping(); ctx = ctx || {};
    const out = [], L = buildLines(day, M), t = totals(L), lk = get("company") || {}, lim = (ctx.link || link()).cash_diff_limit;
    if (t.dr !== t.cr) out.push({ level: "block", msg: "Journal ບໍ່ສົມດຸນ (Dr " + t.dr.toLocaleString("en-US") + " ≠ Cr " + t.cr.toLocaleString("en-US") + ") — ຍອດຮັບເງິນບໍ່ກົງກັບບິນ ຫຼື ຕັ້ງບັນຊີບໍ່ຄົບ" });
    if (lk.lock_date && day.date <= lk.lock_date) out.push({ level: "block", msg: "ງວດຖືກລັອກ (" + lk.lock_date + ")" });
    L.forEach(l => { const a = Acc.acc(l.account); if (!a || Number(a.is_header)) out.push({ level: "block", msg: "ບັນຊີ " + l.account + " ບໍ່ມີ/ເປັນຫົວໝວດ — ກວດ 'ຕັ້ງບັນຊີ'" }); });
    if (Math.abs(day.cashDiff || 0) > lim) out.push({ level: "warn", msg: "ເງິນສົດ" + (day.cashDiff < 0 ? "ຂາດ " : "ເກີນ ") + Math.abs(day.cashDiff).toLocaleString("en-US") + " ກີບ (ເກີນເກນ " + lim.toLocaleString("en-US") + ")" });
    const gross = (day.sales || 0) + (day.svc || 0) + (day.vat || 0);
    if (gross > 0 && day.refunds / gross > 0.05) out.push({ level: "warn", msg: "ຄືນເງິນ " + day.refunds.toLocaleString("en-US") + " (" + Math.round(day.refunds / gross * 100) + "% ຂອງຍອດຂາຍ)" });
    if (gross > 0 && day.voids && day.voids.amt / gross > 0.05) out.push({ level: "warn", msg: "Void " + day.voids.n + " ບິນ ມູນຄ່າ " + day.voids.amt.toLocaleString("en-US") + " (" + Math.round(day.voids.amt / gross * 100) + "%)" });
    const nm = ctx.norm;
    if (nm && nm.avg > 0 && Math.abs(day.sales - nm.avg) / nm.avg > nm.tol) out.push({ level: "warn", msg: "ຍອດຂາຍ " + day.sales.toLocaleString("en-US") + " ຕ່າງຈາກປົກກະຕິ (" + nm.basis + " " + Math.round(nm.avg).toLocaleString("en-US") + ") ເກີນ " + Math.round(nm.tol * 100) + "%" });
    if (ctx.ratesChanged) out.push({ level: "warn", msg: "ອັດຕາ service/VAT ປ່ຽນຈາກມື້ກ່ອນ (" + day.svcPct + "% / " + day.vatPct + "%)" });
    const newM = Object.keys(day.pay || {}).concat(Object.keys(day.creditPays || {}), Object.keys(day.deposits || {})).filter((m, i, a) => a.indexOf(m) === i && !M.methods[m] && !METHOD_RULES.some(r => r[0].test(m)));
    if (newM.length) out.push({ level: "info", msg: "ວິທີຮັບເງິນໃໝ່ " + newM.join(", ") + " → ໃຊ້ບັນຊີ " + M.methodDefault + " (ປ່ຽນໄດ້ທີ່ 'ຕັ້ງບັນຊີ')" });
    const newE = Object.keys(day.expenses || {}).filter(c => M.exp[c] === undefined);
    if (newE.length) out.push({ level: "info", msg: "ໝວດລາຍຈ່າຍໃໝ່ " + newE.join(", ") + " → " + M.expDefault });
    return out;
  }

  /* ---------- store: one record per branch + date ---------- */
  const keyOf = (b, d) => b + ":" + d;
  function hash(o) { const s = JSON.stringify(sortDeep(o)); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return h + ":" + s.length; }
  function sortDeep(x) { if (Array.isArray(x)) return x.map(sortDeep); if (x && typeof x === "object") { const o = {}; Object.keys(x).sort().forEach(k => { o[k] = sortDeep(x[k]); }); return o; } return x; }
  const recs = () => Store.all("pos_days");
  const recOf = (b, d) => Store.where("pos_days", r => r.id === keyOf(b, d))[0] || null;

  // What is "normal" for this day: the same weekday in earlier POSTED days (weekends differ a lot from weekdays);
  // with too little history, the mean of the last 7 posted days and a wider tolerance.
  const dow = d => new Date(d + "T12:00:00Z").getUTCDay();
  function avgSales(branch, date) {
    const prev = recs().filter(r => r.branch === branch && r.date < date && r.status === "posted" && r.day).sort((a, b) => b.date.localeCompare(a.date));
    const same = prev.filter(r => dow(r.date) === dow(date)).slice(0, 4);
    if (same.length >= 2) return { avg: same.reduce((s, r) => s + r.day.sales, 0) / same.length, tol: 0.6, basis: "ມື້ດຽວກັນຂອງອາທິດ" };
    const last = prev.slice(0, 7);
    return last.length >= 3 ? { avg: last.reduce((s, r) => s + r.day.sales, 0) / last.length, tol: 1.0, basis: "7 ມື້ຜ່ານມາ" } : { avg: 0, tol: 0, basis: "" };
  }
  function ratesChanged(branch, date, day) {
    const prev = recs().filter(r => r.branch === branch && r.date < date && r.day).sort((a, b) => b.date.localeCompare(a.date))[0];
    return !!prev && (prev.day.svcPct !== day.svcPct || prev.day.vatPct !== day.vatPct);
  }

  // Store what POS says. Never touches a day's journal: that is post()/adjust().
  function ingest(resp, opts) {
    opts = opts || {}; const lk = link(), out = { added: 0, changed: 0, same: 0, skippedOpen: 0, skippedOld: 0 };
    (resp.branches || []).forEach(br => Object.keys(br.days || {}).forEach(d => {
      const day = br.days[d];
      if (d >= resp.today) { out.skippedOpen++; return; }                      // today is not finished
      if (lk.start && d < lk.start && !opts.all) { out.skippedOld++; return; }
      const id = keyOf(br.id, d), h = hash(day), old = recOf(br.id, d);
      if (!old) { Store.insert("pos_days", { id, branch: br.id, branch_name: br.name || br.id, date: d, day, hash: h, status: "new", issues: [], pulled_at: new Date().toISOString() }); out.added++; }
      else if (old.hash !== h) { Store.update("pos_days", id, { day, hash: h, pulled_at: new Date().toISOString(), changed: old.status === "posted" ? true : old.changed }); out.changed++; }
      else out.same++;
    }));
    return out;
  }

  // Decide what to do with every day that is waiting: post / hold / block. Returns counts.
  function process(role) {
    const r = { posted: 0, held: 0, blocked: 0, adjusted: 0 }, lk = link(), M = mapping();
    recs().sort((a, b) => a.date.localeCompare(b.date)).forEach(rec => {
      if (rec.status === "skipped") return;
      if (rec.status === "posted") { if (rec.changed) { try { if (adjust(rec.id, role)) r.adjusted++; } catch (e) { Store.update("pos_days", rec.id, { adjust_error: e.message }); } } return; }
      const issues = check(rec.day, M, { norm: avgSales(rec.branch, rec.date), ratesChanged: ratesChanged(rec.branch, rec.date, rec.day), link: lk });
      const level = issues.some(i => i.level === "block") ? "blocked" : issues.some(i => i.level === "warn") && lk.hold_on_warn ? "held" : "ok";
      if (level === "ok" && lk.auto) { try { post(rec.id, role || "auto", true); r.posted++; return; } catch (e) { Store.update("pos_days", rec.id, { status: "blocked", issues: issues.concat([{ level: "block", msg: e.message }]) }); r.blocked++; return; } }
      Store.update("pos_days", rec.id, { status: level === "ok" ? "held" : level, issues });
      if (level === "blocked") r.blocked++; else r.held++;
    }); return r;
  }

  function post(id, who, auto) {
    const rec = Store.get("pos_days", id); if (!rec) throw new Error("ບໍ່ພົບມື້ນີ້");
    if (rec.status === "posted") throw new Error("ລົງບັນຊີແລ້ວ");
    const M = mapping(), L = buildLines(rec.day, M), t = totals(L);
    if (t.dr !== t.cr) throw new Error("Journal ບໍ່ສົມດຸນ (Dr " + t.dr + " ≠ Cr " + t.cr + ")");
    if (!L.length) throw new Error("ບໍ່ມີລາຍການໃຫ້ລົງບັນຊີ");
    Acc.assertOpen(rec.date);
    const je = Acc.postJournal({ date: rec.date, source_type: "POS_DAILY", source_id: id, memo: "POS " + (rec.branch_name || rec.branch) + " " + rec.date + " (" + rec.day.bills + " ບິນ)", lines: L });
    Store.update("pos_days", id, { status: "posted", je_id: je.id, posted: netOf(L), posted_at: new Date().toISOString(), posted_by: who || "", auto: !!auto, changed: false, adjust_error: "" });
    Acc.audit("post", "pos_days", id, (auto ? "auto " : "approve ") + rec.date + " " + t.dr);
    return je;
  }
  // POS changed an already-posted day: post only the difference
  function adjust(id, who) {
    const rec = Store.get("pos_days", id); if (!rec || rec.status !== "posted" || !rec.changed) return null;
    const M = mapping(), L = buildLines(rec.day, M), now = netOf(L), was = rec.posted || {}, lines = [];
    Object.keys(Object.assign({}, now, was)).forEach(a => { const d = round((now[a] || 0) - (was[a] || 0)); if (d > 0) lines.push({ account: a, debit: d, credit: 0, memo: "ປັບ POS " + rec.date }); else if (d < 0) lines.push({ account: a, debit: 0, credit: -d, memo: "ປັບ POS " + rec.date }); });
    if (!lines.length) { Store.update("pos_days", id, { changed: false }); return null; }
    const lk = get("company") || {}, date = lk.lock_date && rec.date <= lk.lock_date ? today() : rec.date; // a locked day is corrected in the current period
    const je = Acc.postJournal({ date, source_type: "POS_ADJ", source_id: id, memo: "ປັບຍອດ POS " + rec.date + " (POS ແກ້ໄຂພາຍຫຼັງ)", lines });
    Store.update("pos_days", id, { posted: now, changed: false, adj_ids: (rec.adj_ids || []).concat([je.id]), adjust_error: "" });
    Acc.audit("post", "pos_days", id, "adjust " + rec.date);
    return je;
  }
  function skip(id, reason, who) { Store.update("pos_days", id, { status: "skipped", note: reason || "", skipped_by: who || "" }); Acc.audit("edit", "pos_days", id, "skip " + (reason || "")); }
  function reopen(id) { Store.update("pos_days", id, { status: "new", issues: [] }); }

  /* ---------- transport ---------- */
  let transport = null;
  function setTransport(fn) { transport = fn; }
  function jsonp(url, ms) {
    return new Promise((ok, bad) => {
      const cb = "__posin_" + Date.now() + "_" + Math.floor(Math.random() * 1e6), s = document.createElement("script"); let done = false;
      const end = () => { done = true; try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); clearTimeout(tm); };
      const tm = setTimeout(() => { if (!done) { end(); bad(new Error("POS ບໍ່ຕອບ (ໝົດເວລາ) — ກວດ URL / ອິນເຕີເນັດ")); } }, ms || 25000);
      window[cb] = r => { end(); ok(r); };
      s.onerror = () => { if (!done) { end(); bad(new Error("ເຊື່ອມຕໍ່ POS ບໍ່ໄດ້ — ກວດ URL")); } };
      s.src = url + (url.indexOf("?") < 0 ? "?" : "&") + "callback=" + cb; document.head.appendChild(s);
    });
  }
  async function fetchRange(from, to) {
    const lk = link(); if (!lk.url) throw new Error("ຍັງບໍ່ໄດ້ຕັ້ງ URL ຂອງ POS");
    if (transport) return transport({ url: lk.url, token: lk.token, from, to });
    const r = await jsonp(lk.url + "/?hq=acct&from=" + from + "&to=" + to + "&token=" + encodeURIComponent(lk.token));
    return r;
  }
  const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
  // pull → ingest → process.
  // Default window: the last ~2 months (never before the start date). POS can still correct a day weeks later
  // (late refund, forgotten expense), so a short window would miss it; days already posted are only touched when POS data changed.
  // Longer ranges (first import) are fetched in 90-day pieces because the server caps a request at 93 days.
  async function sync(opts) {
    opts = opts || {}; const lk = link(), to = opts.to || today();
    let from = opts.from || (lk.start && lk.start > addDays(to, -62) ? lk.start : addDays(to, -62));
    const sum = { added: 0, changed: 0, same: 0, skippedOpen: 0, skippedOld: 0 };
    for (let a = from; a <= to; ) {
      const b = addDays(a, 89) < to ? addDays(a, 89) : to;
      const resp = await fetchRange(a, b);
      if (!resp || !resp.ok) throw new Error(resp && resp.err === "token" ? "token ບໍ່ຖືກ (ຕັ້ງ ACCT_TOKEN ໃນ POS server)" : "POS ຕອບຜິດ: " + ((resp && resp.err) || "?"));
      const ing = ingest(resp, { all: !!opts.all }); Object.keys(sum).forEach(k => { sum[k] += ing[k]; });
      put("pos_link", { last_stock: { value: (resp.branches || []).reduce((s2, x) => s2 + (+x.stockValue || 0), 0), at: new Date().toISOString() } }); // POS stock value NOW, for the reconciliation
      a = addDays(b, 1);
    }
    const pr = process(opts.role), result = Object.assign({ at: new Date().toISOString(), from, to }, sum, pr);
    put("pos_link", { last_pull: today(), last_result: result });
    return result;
  }
  let busy = false;
  async function autoOnOpen(role) {
    const lk = link(); if (busy || !lk.auto || !lk.url || !lk.token) return null;
    const last = get("pos_link") && get("pos_link").last_run; if (last && Date.now() - last < 30 * 60 * 1000) return null; // at most every 30 minutes
    busy = true; try { put("pos_link", { last_run: Date.now() }); return await sync({ role }); } finally { busy = false; }
  }

  /* ---------- reconciliation: POS payload vs what is in the ledger ---------- */
  function reconcile(month) {
    const rs = recs().filter(r => r.status === "posted" && r.date.slice(0, 7) === month);
    const sumPos = k => rs.reduce((s, r) => s + (r.day[k] || 0), 0);
    const jeIds = new Set(rs.map(r => r.je_id).concat(rs.reduce((a, r) => a.concat(r.adj_ids || []), [])));
    const glSum = codeFn => { let n = 0; Store.all("journal_lines").forEach(l => { if (jeIds.has(l.je_id) && codeFn(l.account)) n += (Number(l.credit) || 0) - (Number(l.debit) || 0); }); return round(n); };
    const st = (get("pos_link") || {}).last_stock;
    return { days: rs.length, stock: st ? { pos: round(st.value), gl: round(Acc.accountBalance(Acc.PA("INV"))), at: st.at } : null, pos: { sales: sumPos("sales") + sumPos("depUsed"), svc: sumPos("svc"), vat: sumPos("vat"), tips: sumPos("tips") },
      gl: { sales: glSum(a => /^4(1|0)/.test(a) && a !== "4300"), svc: glSum(a => a === mapping().svc), vat: glSum(a => a === Acc.PA("VAT_OUT")), tips: glSum(a => a === mapping().tips) } };
  }

  window.Posin = { M_DEFAULT, link, setLink, mapping, setMapping, acctMethod, acctCat, buildLines, check, ingest, process, post, adjust, skip, reopen, sync, fetchRange, autoOnOpen, setTransport, reconcile, recOf, recs, totals };
})();
