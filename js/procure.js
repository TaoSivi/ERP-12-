/* ============================================================
   LaoBooks ERP – Procure-to-Pay process engine
   ------------------------------------------------------------
   One "purchase case" (stored in purchase_requisitions) carries a request from
   start to finish. Every step is an explicit action by an allowed role, recorded
   in `approvals` (the audit trail):

     draft ─submit→ pr_approval ─approve→ sourcing ─createPO→ po_approval ─approve→
     receiving ─(all received / short-close)→ invoicing ─bill→ paying ─paid→ closed
                 └reject→ rejected          po_approval ─reject→ sourcing

   WHERE THE ACCOUNTING HAPPENS (and where it deliberately does not):
     PR, quotes, PO ........ no journal  (a commitment, not a transaction yet)
     Goods receipt (GRN) ... Dr Inventory / Expense / Fixed asset   Cr GR/IR (1500)
     Vendor invoice ........ Dr GR/IR + VAT input                   Cr AP
     Payment ............... Dr AP                                   Cr Bank
   GR/IR is the bridge: receiving creates the cost when the goods arrive, the
   invoice clears it. Anything left on GR/IR = received-not-billed (or a price gap).

   Pure logic (no DOM) so it is unit-tested in Node.
   ============================================================ */
(function () {
  const today = () => new Date().toISOString().slice(0, 10);
  const round = n => Acc.round(n);
  const ALL_ROLES = ["Admin", "Manager", "Accountant", "Purchasing", "Warehouse", "Sales", "HR", "Cashier"];

  const STAGES = [
    { id: "draft",       label: "ຮ່າງ",            short: "ຂໍຊື້" },
    { id: "pr_approval", label: "ລໍອະນຸມັດຂໍຊື້",   short: "ອະນຸມັດ" },
    { id: "sourcing",    label: "ຫາລາຄາ / ສະເໜີ",  short: "ສະເໜີລາຄາ" },
    { id: "po_approval", label: "ລໍອະນຸມັດ PO",     short: "ອະນຸມັດ PO" },
    { id: "receiving",   label: "ລໍຮັບເຄື່ອງ",      short: "ຮັບເຄື່ອງ" },
    { id: "invoicing",   label: "ລໍບິນຜູ້ສະໜອງ",    short: "ບິນ" },
    { id: "paying",      label: "ລໍຈ່າຍເງິນ",       short: "ຈ່າຍ" },
    { id: "closed",      label: "ສຳເລັດ",          short: "ສຳເລັດ" }
  ];
  const ENDED = { closed: "ສຳເລັດ", rejected: "ຖືກປະຕິເສດ", cancelled: "ຍົກເລີກ" };

  // What each step books — shown to users so nobody has to guess.
  const BOOKING = {
    draft: "ບໍ່ລົງບັນຊີ", pr_approval: "ບໍ່ລົງບັນຊີ", sourcing: "ບໍ່ລົງບັນຊີ",
    po_approval: "ບໍ່ລົງບັນຊີ (PO ເປັນພຽງຂໍ້ຜູກມັດ)",
    receiving: "ຮັບເຄື່ອງ → Dr ສິນຄ້າ/ຄ່າໃຊ້ຈ່າຍ/ຊັບສິນ · Cr GR/IR",
    invoicing: "ບິນ → Dr GR/IR + VAT ຊື້ · Cr ເຈົ້າໜີ້ (AP)",
    paying: "ຈ່າຍ → Dr ເຈົ້າໜີ້ (AP) · Cr ທະນາຄານ", closed: "—"
  };

  /* ---------- settings ---------- */
  function settings() {
    const s = Store.get("settings", "procure") || {};
    const company = Store.get("settings", "company") || {};
    return {
      quote_threshold: Number(s.quote_threshold) || 10000000, // from this amount up, 3 quotes are expected
      min_quotes: Number(s.min_quotes) || 3,
      price_tolerance: s.price_tolerance == null ? 2 : Number(s.price_tolerance), // % bill price may differ from PO
      approval_limit: Number(company.approval_limit) || 0                          // PO above this → Admin only
    };
  }

  /* ---------- helpers ---------- */
  const getCase = id => { const c = Store.get("purchase_requisitions", id); if (!c) throw new Error("ບໍ່ພົບໃບຂໍຊື້"); return c; };
  const caseLines = id => Store.where("pr_lines", l => l.pr_id === id);
  const stageOf = c => c.stage || ({ pending: "pr_approval", approved: "sourcing", rejected: "rejected" })[c.status] || "draft"; // legacy PRs
  const estTotal = id => round(caseLines(id).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));
  const quotesOf = id => Store.where("pr_quotes", q => q.pr_id === id);
  const poOf = c => (c.po_id ? Store.get("purchase_orders", c.po_id) : null);
  const poLines = poId => Store.where("po_lines", l => l.po_id === poId);
  const history = id => Store.where("approvals", a => a.doc_type === "PR" && a.doc_id === id).sort((a, b) => a.ts.localeCompare(b.ts));

  function log(c, step, action, role, note) {
    Store.insert("approvals", { doc_type: "PR", doc_id: c.id, doc_ref: c.number, step, action, role, note: note || "", ts: new Date().toISOString() });
  }
  function setStage(c, stage, extra) { Store.update("purchase_requisitions", c.id, Object.assign({ stage, status: stage }, extra || {})); }
  function lastActorRole(c, step, action) { const h = history(c.id).filter(a => a.step === step && a.action === action); return h.length ? h[h.length - 1].role : null; }

  /* ---------- who may act at each stage ---------- */
  function rolesFor(c) {
    const st = stageOf(c);
    if (st === "draft") return ALL_ROLES;
    if (st === "pr_approval") { const cs = Approval.chainState(c, "PURCHASE", Number(c.est_total) || estTotal(c.id)); return cs.role ? [cs.role, "Admin"] : []; }
    if (st === "sourcing") return ["Purchasing", "Manager", "Admin"];
    if (st === "po_approval") { const po = poOf(c), lim = settings().approval_limit; return lim > 0 && po && Number(po.total) > lim ? ["Admin"] : ["Manager", "Admin"]; }
    if (st === "receiving") return ["Warehouse", "Purchasing", "Manager", "Admin"];
    if (st === "invoicing") return ["Accountant", "Manager", "Admin"];
    if (st === "paying") return ["Accountant", "Cashier", "Manager", "Admin"];
    return [];
  }
  // Segregation of duties: the role that prepared a step may not approve it (Admin excepted).
  function sodConflict(c, role) {
    const st = stageOf(c);
    // one role approves at most one step of a chain — this applies to Admin too
    if (st === "pr_approval" && (c.approvals_done || []).some(d => d.role === role)) return "ບົດບາດນີ້ອະນຸມັດຂັ້ນກ່ອນແລ້ວ";
    if (role === "Admin") return null;
    if (st === "pr_approval" && lastActorRole(c, "draft", "submit") === role) return "ຜູ້ຍື່ນຂໍ ອະນຸມັດເອງບໍ່ໄດ້ — ໃຫ້ບົດບາດອື່ນອະນຸມັດ";
    if (st === "po_approval" && lastActorRole(c, "sourcing", "create_po") === role) return "ຜູ້ສ້າງ PO ອະນຸມັດ PO ເອງບໍ່ໄດ້ — ໃຫ້ບົດບາດອື່ນອະນຸມັດ";
    return null;
  }
  function canAct(c, role) {
    const st = stageOf(c);
    if (ENDED[st]) return { ok: false, why: "ຂະບວນການນີ້ " + ENDED[st] + " ແລ້ວ" };
    const roles = rolesFor(c);
    if (roles.indexOf(role) === -1) return { ok: false, why: "ລໍຖ້າ " + roles.join(" / ") };
    const sod = sodConflict(c, role);
    return sod ? { ok: false, why: sod } : { ok: true, why: "" };
  }
  function assertCan(c, role) { const r = canAct(c, role); if (!r.ok) throw new Error(r.why); }
  function assertStage(c, st) { if (stageOf(c) !== st) throw new Error("ຂັ້ນຕອນບໍ່ຖືກ: ຕອນນີ້ຢູ່ \"" + stageLabel(stageOf(c)) + "\""); }
  const stageLabel = id => (STAGES.find(s => s.id === id) || {}).label || ENDED[id] || id;

  /* ---------- 1. request ---------- */
  // lines: [{ item_id?, description, kind: stock|expense|asset, qty, price, account? }]
  function create({ requester, dept, purpose, justification, need_by, date, lines }, role) {
    if (!String(purpose || "").trim()) throw new Error("ໃສ່ຈຸດປະສົງການຂໍຊື້");
    const ok = (lines || []).filter(l => Number(l.qty) > 0 && (l.item_id || String(l.description || "").trim()));
    if (!ok.length) throw new Error("ຕ້ອງມີຢ່າງໜ້ອຍ 1 ລາຍການ (ຈຳນວນ > 0)");
    date = date || today();
    const c = Store.insert("purchase_requisitions", {
      number: Acc.nextNumber("PR", "purchase_requisitions", date), date, requester: requester || role || "", dept: dept || "",
      purpose, justification: justification || "", need_by: need_by || "", stage: "draft", status: "draft", created_at: new Date().toISOString()
    });
    ok.forEach(l => {
      const it = l.item_id ? Store.get("items", l.item_id) : null;
      const kind = l.kind || (it ? (it.type === "stock" ? "stock" : "expense") : "expense");
      Store.insert("pr_lines", { pr_id: c.id, item_id: l.item_id || "", description: l.description || (it ? it.name : ""), kind, qty: Number(l.qty), price: Number(l.price) || 0, account: l.account || "" });
    });
    Store.update("purchase_requisitions", c.id, { est_total: estTotal(c.id) });
    log(c, "draft", "create", role);
    return Store.get("purchase_requisitions", c.id);
  }
  function submit(id, role, note) {
    const c = getCase(id); assertStage(c, "draft"); assertCan(c, role);
    log(c, "draft", "submit", role, note);
    setStage(c, "pr_approval", { chain: Approval.chainFor("PURCHASE", Number(c.est_total) || estTotal(c.id)), approvals_done: [] });
  }
  function approvePR(id, role, note) {
    const c = getCase(id); assertStage(c, "pr_approval"); assertCan(c, role);
    const done = (c.approvals_done || []).concat([{ role, at: new Date().toISOString() }]);
    log(c, "pr_approval", "approve", role, note);
    const chain = c.chain && c.chain.length ? c.chain : Approval.chainFor("PURCHASE", Number(c.est_total) || estTotal(c.id));
    if (done.length < chain.length) return Store.update("purchase_requisitions", c.id, { approvals_done: done, chain });
    setStage(c, "sourcing", { approvals_done: done, chain });
  }
  function rejectPR(id, role, note) {
    const c = getCase(id); assertStage(c, "pr_approval"); assertCan(c, role);
    if (!String(note || "").trim()) throw new Error("ໃສ່ເຫດຜົນທີ່ປະຕິເສດ");
    log(c, "pr_approval", "reject", role, note); setStage(c, "rejected");
  }
  function returnPR(id, role, note) { // send back to the requester to fix
    const c = getCase(id); assertStage(c, "pr_approval"); assertCan(c, role);
    if (!String(note || "").trim()) throw new Error("ບອກວ່າຕ້ອງແກ້ຫຍັງ");
    log(c, "pr_approval", "return", role, note); setStage(c, "draft");
  }
  function cancel(id, role, note) {
    const c = getCase(id), st = stageOf(c);
    if (["draft", "pr_approval", "sourcing", "po_approval"].indexOf(st) === -1) throw new Error("ຍົກເລີກບໍ່ໄດ້ຫຼັງ PO ຖືກອະນຸມັດ — ໃຊ້ 'ປິດການຮັບ' ແທນ");
    if (role !== "Admin" && role !== "Manager" && st !== "draft") throw new Error("ສະເພາະ Manager/Admin");
    const po = poOf(c); if (po) Store.update("purchase_orders", po.id, { status: "cancelled" });
    log(c, st, "cancel", role, note); setStage(c, "cancelled");
  }

  /* ---------- 2. sourcing (quotes) ---------- */
  function quoteRule(id) {
    const s = settings(), c = getCase(id);
    const required = (Number(c.est_total) || estTotal(id)) >= s.quote_threshold ? s.min_quotes : 1;
    return { required, have: quotesOf(id).length };
  }
  function addQuote(id, { vendor_id, amount, days, note }, role) {
    const c = getCase(id); assertStage(c, "sourcing"); assertCan(c, role);
    if (!Store.get("vendors", vendor_id)) throw new Error("ເລືອກຜູ້ສະໜອງ");
    if (!(Number(amount) > 0)) throw new Error("ໃສ່ລາຄາສະເໜີ");
    if (quotesOf(id).some(q => q.vendor_id === vendor_id)) throw new Error("ຜູ້ສະໜອງນີ້ມີໃບສະເໜີແລ້ວ");
    const q = Store.insert("pr_quotes", { pr_id: id, vendor_id, amount: round(amount), days: Number(days) || 0, note: note || "", selected: false, ts: new Date().toISOString() });
    log(c, "sourcing", "quote", role, (Store.get("vendors", vendor_id) || {}).name + " " + round(amount));
    // the cheapest quote is pre-selected; a person can still pick another
    const all = quotesOf(id), best = all.reduce((a, b) => (Number(b.amount) < Number(a.amount) ? b : a));
    all.forEach(x => Store.update("pr_quotes", x.id, { selected: x.id === best.id }));
    return q;
  }
  function removeQuote(id, quoteId, role) {
    const c = getCase(id); assertStage(c, "sourcing"); assertCan(c, role);
    Store.remove("pr_quotes", quoteId);
  }
  function selectQuote(id, quoteId, role) {
    const c = getCase(id); assertStage(c, "sourcing"); assertCan(c, role);
    quotesOf(id).forEach(x => Store.update("pr_quotes", x.id, { selected: x.id === quoteId }));
  }
  // Builds the PO from the selected quote. The quoted total is split over the lines in WHOLE KIP
  // (proportional to the estimate); unit price = line total / qty, kept unrounded so qty × price
  // always gives back the exact line total and Σ lines == quote.
  function createPO(id, role, reason) {
    const c = getCase(id); assertStage(c, "sourcing"); assertCan(c, role);
    const q = quotesOf(id).find(x => x.selected);
    if (!q) throw new Error("ເພີ່ມ ແລະ ເລືອກໃບສະເໜີລາຄາກ່ອນ");
    const rule = quoteRule(id);
    const notCheapest = quotesOf(id).some(x => Number(x.amount) < Number(q.amount));
    if ((rule.have < rule.required || notCheapest) && String(reason || "").trim().length < 5)
      throw new Error(rule.have < rule.required
        ? "ຍອດນີ້ຕ້ອງມີ " + rule.required + " ໃບສະເໜີ (ມີ " + rule.have + ") — ໃສ່ເຫດຜົນ ຖ້າຈຳເປັນຕ້ອງໃຊ້ຜູ້ສະໜອງດຽວ"
        : "ເລືອກໃບທີ່ບໍ່ແມ່ນລາຄາຕ່ຳສຸດ — ໃສ່ເຫດຜົນ");
    const lines = caseLines(id), est = estTotal(id), target = Math.round(Number(q.amount));
    const alloc = lines.map(l => (est > 0 ? Math.round((Number(l.qty) || 0) * (Number(l.price) || 0) * target / est) : 0));
    if (est <= 0) alloc[0] = target;
    const big = alloc.indexOf(Math.max.apply(null, alloc));
    alloc[big] += target - alloc.reduce((a, b) => a + b, 0);
    const po = Store.insert("purchase_orders", {
      number: Acc.nextNumber("PO", "purchase_orders", today()), vendor_id: q.vendor_id, date: today(), note: c.purpose,
      total: target, status: "pending_approval", case_id: c.id, created_at: new Date().toISOString()
    });
    lines.forEach((l, i) => Store.insert("po_lines", { po_id: po.id, pr_line_id: l.id, item_id: l.item_id, description: l.description, kind: l.kind, account: l.account || "", qty: Number(l.qty), price: alloc[i] / Number(l.qty), line_total: alloc[i], received_qty: 0, billed_qty: 0 }));
    log(c, "sourcing", "create_po", role, reason ? "ເຫດຜົນ: " + reason : po.number);
    setStage(c, "po_approval", { po_id: po.id, vendor_id: q.vendor_id });
    return Store.get("purchase_orders", po.id);
  }
  function approvePO(id, role, note) {
    const c = getCase(id); assertStage(c, "po_approval"); assertCan(c, role);
    Store.update("purchase_orders", c.po_id, { status: "approved", approved_by: role, approved_at: new Date().toISOString() });
    log(c, "po_approval", "approve", role, note); setStage(c, "receiving");
  }
  function rejectPO(id, role, note) {
    const c = getCase(id); assertStage(c, "po_approval"); assertCan(c, role);
    if (!String(note || "").trim()) throw new Error("ໃສ່ເຫດຜົນທີ່ປະຕິເສດ");
    Store.update("purchase_orders", c.po_id, { status: "cancelled" });
    log(c, "po_approval", "reject", role, note); setStage(c, "sourcing", { po_id: "" });
  }

  /* ---------- 3. receiving (GRN) — FIRST accounting entry ---------- */
  function debitAccountFor(l) {
    if (l.kind === "asset") return "1700";
    const it = l.item_id ? Store.get("items", l.item_id) : null;
    if (l.kind === "stock") return (it && it.inventory_account) || Acc.PA("INV");
    return l.account || (it && it.expense_account) || Acc.PA("GEN_EXP");
  }
  // receipt: [{ po_line_id, qty }]
  function receive(id, role, { date, receipt, note }) {
    const c = getCase(id); assertStage(c, "receiving"); assertCan(c, role);
    date = date || today();
    Acc.assertOpen(date);
    const po = poOf(c), byId = {};
    poLines(po.id).forEach(l => (byId[l.id] = l));
    const rows = (receipt || []).filter(r => Number(r.qty) > 0);
    if (!rows.length) throw new Error("ໃສ່ຈຳນວນທີ່ໄດ້ຮັບ");
    rows.forEach(r => {
      const l = byId[r.po_line_id]; if (!l) throw new Error("ລາຍການບໍ່ຢູ່ໃນ PO");
      if (Number(r.qty) > Number(l.qty) - Number(l.received_qty || 0) + 1e-9) throw new Error("ຮັບເກີນຈຳນວນສັ່ງ: " + l.description);
    });
    const grn = Store.insert("grns", { number: Acc.nextNumber("GRN", "grns", date), po_id: po.id, case_id: c.id, date, note: note || "", created_at: new Date().toISOString() });
    const jl = []; let total = 0;
    rows.forEach(r => {
      const l = byId[r.po_line_id], qty = Number(r.qty), val = Math.round(qty * Number(l.price) * 100) / 100;
      total += val;
      Store.insert("grn_lines", { grn_id: grn.id, po_line_id: l.id, qty, unit_cost: Number(l.price) });
      Store.update("po_lines", l.id, { received_qty: Number(l.received_qty || 0) + qty });
      if (l.kind === "stock" && l.item_id) Acc.recordMove(l.item_id, "in", qty, Number(l.price), "GRN", grn.id);
      if (l.kind === "asset") Store.insert("assets", { name: l.description, category: "ຈາກການຈັດຊື້", cost: val, life_months: 60, date, method: "straight", acc_dep: 0, status: "active", source: "GRN", grn_id: grn.id });
      jl.push({ account: debitAccountFor(l), debit: val, credit: 0, memo: l.description });
    });
    jl.push({ account: Acc.PA("GRIR"), debit: 0, credit: round(total), memo: "GR/IR " + po.number });
    const je = Acc.postJournal({ date, source_type: "GRN", source_id: grn.id, memo: "ຮັບເຄື່ອງ " + grn.number + " / " + po.number, lines: jl });
    Store.update("grns", grn.id, { je_id: je.id, total: round(total) });
    log(c, "receiving", "receive", role, grn.number + " " + round(total));
    const done = poLines(po.id).every(l => Number(l.received_qty || 0) >= Number(l.qty) - 1e-9);
    Store.update("purchase_orders", po.id, { status: done ? "received" : "partial" });
    if (done) setStage(c, "invoicing");
    return Store.get("grns", grn.id);
  }
  function shortClose(id, role, note) { // supplier will not deliver the rest
    const c = getCase(id); assertStage(c, "receiving"); assertCan(c, role);
    if (!poLines(c.po_id).some(l => Number(l.received_qty || 0) > 0)) throw new Error("ຍັງບໍ່ໄດ້ຮັບຫຍັງເລີຍ — ໃຊ້ຍົກເລີກແທນ");
    if (!String(note || "").trim()) throw new Error("ໃສ່ເຫດຜົນ");
    Store.update("purchase_orders", c.po_id, { status: "received", short_closed: true });
    log(c, "receiving", "short_close", role, note); setStage(c, "invoicing");
  }

  /* ---------- 4. vendor invoice (3-way match) ---------- */
  // Creates a DRAFT bill whose lines clear GR/IR. Posting is done by finishBill (the UI runs the Guard in between).
  function prepareBill(id, role, { date, vendor_ref, vat, lines }) {
    const c = getCase(id); assertStage(c, "invoicing"); assertCan(c, role);
    if (!String(vendor_ref || "").trim()) throw new Error("ໃສ່ເລກທີ່ບິນຂອງຜູ້ສະໜອງ");
    const po = poOf(c), byId = {}; poLines(po.id).forEach(l => (byId[l.id] = l));
    date = date || today();
    const rows = (lines || []).filter(r => Number(r.qty) > 0);
    if (!rows.length) throw new Error("ບໍ່ມີລາຍການໃນບິນ");
    Store.where("bills", b => b.case_id === c.id && b.status === "draft").forEach(b => discardBill(b.id)); // one draft at a time
    const bill = Store.insert("bills", {
      number: Acc.nextNumber("BILL", "bills", date), vendor_id: po.vendor_id, vendor_ref, date,
      due_date: new Date(Date.parse(date) + 30 * 86400000).toISOString().slice(0, 10), currency: "LAK", fx_rate: 1,
      note: "PO " + po.number, project_id: "", cc_id: "", status: "draft", paid: 0, po_id: po.id, case_id: c.id, created_at: new Date().toISOString()
    });
    rows.forEach(r => {
      const l = byId[r.po_line_id]; if (!l) throw new Error("ລາຍການບໍ່ຢູ່ໃນ PO");
      Store.insert("bill_lines", { bill_id: bill.id, po_line_id: l.id, account_id: Acc.PA("GRIR"), description: l.description, qty: Number(r.qty), price: Number(r.price), tax_code: vat ? "tax_in10" : "tax_0" });
    });
    return bill;
  }
  // 3-way match findings for a PO bill (used by Guard): PO price vs bill price, received vs billed qty
  const fmt = n => Math.round(Number(n) || 0).toLocaleString("en-US");
  function matchFindings(bill) {
    const out = [], tol = settings().price_tolerance;
    Store.where("bill_lines", l => l.bill_id === bill.id && l.po_line_id).forEach(bl => {
      const pl = Store.get("po_lines", bl.po_line_id); if (!pl) return;
      const open = Number(pl.received_qty || 0) - Number(pl.billed_qty || 0);
      if (Number(bl.qty) > open + 1e-9)
        out.push({ rule: "PO_QTY", msg: pl.description + ": ບິນ " + bl.qty + " ແຕ່ຮັບແລ້ວຍັງບໍ່ໄດ້ບິນ " + open });
      const dev = Number(pl.price) ? Math.abs(Number(bl.price) - Number(pl.price)) / Number(pl.price) * 100 : 0;
      if (dev > tol + 1e-9)
        out.push({ rule: "PO_PRICE", msg: pl.description + ": ລາຄາບິນ " + fmt(bl.price) + " ຕ່າງຈາກ PO " + fmt(pl.price) + " (" + dev.toFixed(1) + "%)" });
    });
    return out;
  }
  function discardBill(billId) {
    Store.where("bill_lines", l => l.bill_id === billId).forEach(l => Store.remove("bill_lines", l.id));
    Store.remove("bills", billId);
  }
  function finishBill(id, billId, role) {
    const c = getCase(id); assertStage(c, "invoicing"); assertCan(c, role);
    const bill = Store.get("bills", billId);
    const je = Acc.postBill(bill);
    Store.where("bill_lines", l => l.bill_id === billId && l.po_line_id).forEach(bl => {
      const pl = Store.get("po_lines", bl.po_line_id);
      Store.update("po_lines", pl.id, { billed_qty: Number(pl.billed_qty || 0) + Number(bl.qty) });
    });
    log(c, "invoicing", "bill", role, bill.number + " / " + bill.vendor_ref);
    const allBilled = poLines(c.po_id).every(l => Number(l.billed_qty || 0) >= Number(l.received_qty || 0) - 1e-9);
    if (allBilled) setStage(c, "paying", { bill_id: billId });
    else Store.update("purchase_requisitions", c.id, { bill_id: billId });
    return je;
  }

  /* ---------- 5. payment ---------- */
  function openBills(c) { return Store.where("bills", b => b.case_id === c.id && (b.status === "posted" || b.status === "partial")); }
  function pay(id, role, { bank_id, amount, date }) {
    const c = getCase(id); assertStage(c, "paying"); assertCan(c, role);
    const bills = openBills(c); if (!bills.length) throw new Error("ບໍ່ມີບິນຄ້າງຈ່າຍ");
    let left = round(amount); if (!(left > 0)) throw new Error("ໃສ່ຈຳນວນເງິນ");
    const due = round(bills.reduce((s, b) => s + Number(b.total) - Number(b.paid || 0), 0));
    if (left > due + 0.5) throw new Error("ຈ່າຍເກີນຍອດຄ້າງ (" + due + ")");
    date = date || today();
    bills.forEach(b => {
      if (left <= 0) return;
      const amt = Math.min(left, round(Number(b.total) - Number(b.paid || 0)));
      Acc.payBill({ bill_id: b.id, bank_id, amount: amt, date }); left = round(left - amt);
    });
    log(c, "paying", "pay", role, String(round(amount)));
    if (!openBills(c).length) { setStage(c, "closed"); Store.update("purchase_orders", c.po_id, { status: "closed" }); }
  }

  /* ---------- budget check for approvers (warn, never block) ---------- */
  function ytd(code, yr) {
    let t = 0;
    Store.all("journal_lines").forEach(l => {
      if (String(l.account) !== String(code)) return;
      const je = Store.get("journal_entries", l.je_id);
      if (!je || !(je.status === "posted" || je.status === "reversed") || String(je.date).slice(0, 4) !== yr || je.source_type === "YEAR_END") return;
      t += Number(l.debit) - Number(l.credit);
    });
    return round(t);
  }
  function lineAccount(l) { return l.kind === "asset" ? "1700" : l.kind === "stock" ? "" : (l.account || Acc.PA("GEN_EXP")); }
  function budgetCheck(id) {
    const yr = today().slice(0, 4), mine = {};
    caseLines(id).forEach(l => { const a = lineAccount(l); if (a) mine[a] = (mine[a] || 0) + Number(l.qty) * Number(l.price); });
    return Object.keys(mine).map(code => {
      const budget = round(Store.where("budgets", b => b.account_id === code && (b.period === yr || String(b.period || "").indexOf(yr + "-") === 0)).reduce((s, b) => s + Number(b.amount), 0));
      if (!budget) return null;
      const committed = round(Store.all("purchase_requisitions").filter(c => c.id !== id && ["pr_approval", "sourcing", "po_approval", "receiving"].indexOf(stageOf(c)) !== -1)
        .reduce((s, c) => s + caseLines(c.id).filter(l => lineAccount(l) === code).reduce((t, l) => t + Number(l.qty) * Number(l.price), 0), 0));
      const actual = ytd(code, yr), remaining = round(budget - actual - committed - mine[code]);
      return { account: code, name: Acc.accName(code), budget, actual, committed, request: round(mine[code]), remaining, over: remaining < 0 };
    }).filter(Boolean);
  }

  /* ---------- what should this role do next? (drives the UI) ---------- */
  const NEXT = {
    draft: "ສົ່ງຂໍອະນຸມັດ", pr_approval: "ອະນຸມັດຂໍຊື້", sourcing: "ເພີ່ມໃບສະເໜີ & ສ້າງ PO",
    po_approval: "ອະນຸມັດ PO", receiving: "ຮັບເຄື່ອງ", invoicing: "ບັນທຶກບິນຜູ້ສະໜອງ", paying: "ຈ່າຍເງິນ"
  };
  function nextAction(c, role) {
    const st = stageOf(c), can = canAct(c, role);
    return { stage: st, label: NEXT[st] || "", allowed: can.ok, why: can.why, waitingFor: rolesFor(c) };
  }
  function queue(role) {
    return Store.all("purchase_requisitions").filter(c => !ENDED[stageOf(c)] && stageOf(c) !== "draft" && canAct(c, role).ok)
      .sort((a, b) => (a.need_by || "9999").localeCompare(b.need_by || "9999"));
  }
  function summary(c) {
    const po = poOf(c);
    return { stage: stageOf(c), est: Number(c.est_total) || estTotal(c.id), po, poLines: po ? poLines(po.id) : [], quotes: quotesOf(c.id), lines: caseLines(c.id), history: history(c.id),
      grns: Store.where("grns", g => g.case_id === c.id), bills: Store.where("bills", b => b.case_id === c.id && b.status !== "draft") };
  }

  window.Procure = {
    STAGES, ENDED, BOOKING, settings, stageOf, stageLabel, canAct, rolesFor, nextAction, queue, summary, quoteRule, budgetCheck,
    create, submit, approvePR, rejectPR, returnPR, cancel,
    addQuote, removeQuote, selectQuote, createPO, approvePO, rejectPO,
    receive, shortClose, prepareBill, matchFindings, discardBill, finishBill, pay
  };
})();
