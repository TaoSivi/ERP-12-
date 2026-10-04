/* ============================================================
   LaoBooks ERP – Request flows + approval matrix
   ------------------------------------------------------------
   APPROVAL MATRIX (Settings → ຂັ້ນອະນຸມັດ): amount tiers → ordered chain of roles.
     default  ≤ 5,000,000  : Manager
              ≤ 20,000,000 : Manager → Accountant
              >            : Manager → Accountant → Admin
   Rules for every chain: the requester's role cannot approve; one role approves at
   most one step (so Admin cannot approve a whole chain alone); Admin may stand in
   for a missing role on a step it has not approved yet.

   REQUEST TYPES and where they post (each post happens automatically at that step):
     ADV  ຂໍເບີກເງິນສຳຮອງ   approve → payout:  Dr Employee advance (1450)       Cr Bank
     CLR  ເຄລຍເງິນສຳຮອງ     approve:           Dr Expenses + VAT in            Cr Employee advance
                                               (spent more → Cr Payable-to-employee 2150, then pay it out)
                            spent less → refund: Dr Bank                        Cr Employee advance
     PAY  ຂໍເບີກຈ່າຍ       approve:  vendor   → Bill: Dr Expenses + VAT      Cr AP     (shows in AP aging)
                                     employee → Dr Expenses + VAT            Cr Payable-to-employee
                            payout:            Dr AP / Payable-to-employee     Cr Bank
   Pure logic (no DOM).
   ============================================================ */
(function () {
  const today = () => new Date().toISOString().slice(0, 10);
  const round = n => Acc.round(n);
  const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

  /* =================== approval matrix =================== */
  const DEFAULT_TIERS = [
    { max: 5000000, chain: ["Manager"] },
    { max: 20000000, chain: ["Manager", "Accountant"] },
    { max: null, chain: ["Manager", "Accountant", "Admin"] }
  ];
  function matrix() {
    const m = Store.get("settings", "approval_matrix");
    return { tiers: (m && Array.isArray(m.tiers) && m.tiers.length ? m.tiers : DEFAULT_TIERS), by_type: (m && m.by_type) || {} };
  }
  function setMatrix(tiers, byType) {
    const clean = (tiers || []).map(t => ({ max: t.max === null || t.max === "" || t.max === undefined ? null : Number(t.max), chain: (t.chain || []).filter(Boolean) }))
      .filter(t => t.chain.length).sort((a, b) => (a.max === null) - (b.max === null) || (a.max || 0) - (b.max || 0));
    if (!clean.length) throw new Error("ຕ້ອງມີຢ່າງໜ້ອຍ 1 ຂັ້ນ");
    if (clean[clean.length - 1].max !== null) clean.push({ max: null, chain: clean[clean.length - 1].chain.slice() });
    const row = { tiers: clean, by_type: byType || matrix().by_type };
    if (Store.get("settings", "approval_matrix")) Store.update("settings", "approval_matrix", row);
    else Store.insert("settings", Object.assign({ id: "approval_matrix" }, row));
  }
  function chainFor(type, amount) {
    const m = matrix(), tiers = m.by_type[type] || m.tiers, a = Number(amount) || 0;
    const t = tiers.find(x => x.max === null || a <= Number(x.max)) || tiers[tiers.length - 1];
    return t.chain.slice();
  }
  // generic chain state: doc.approvals_done = [{ role, step }]
  function chainState(doc, type, amount) {
    const chain = doc.chain && doc.chain.length ? doc.chain : chainFor(type, amount);
    const done = doc.approvals_done || [];
    return { chain, done, step: done.length, role: chain[done.length] || null, complete: done.length >= chain.length };
  }
  // may `role` approve the current step of `doc`?
  function canApproveStep(doc, type, amount, role, requesterRole) {
    const st = chainState(doc, type, amount);
    if (st.complete) return { ok: false, why: "ອະນຸມັດຄົບແລ້ວ" };
    const used = st.done.map(d => d.role);
    if (used.indexOf(role) !== -1) return { ok: false, why: "ບົດບາດນີ້ອະນຸມັດຂັ້ນກ່ອນແລ້ວ — ໃຫ້ " + st.role + " ອະນຸມັດ" };
    if (role !== st.role && role !== "Admin") return { ok: false, why: "ລໍ " + st.role + " ອະນຸມັດ (ຂັ້ນ " + (st.step + 1) + "/" + st.chain.length + ")" };
    if (role !== "Admin" && role === requesterRole) return { ok: false, why: "ຜູ້ຂໍ ອະນຸມັດເອງບໍ່ໄດ້ — ໃຫ້ " + st.role + " ຄົນອື່ນອະນຸມັດ" };
    return { ok: true, why: "" };
  }

  /* =================== requests =================== */
  const TYPES = {
    ADV: { label: "ເບີກເງິນສຳຮອງ", prefix: "ADV", icon: "💵" },
    CLR: { label: "ເຄລຍເງິນສຳຮອງ", prefix: "CLR", icon: "🧾" },
    PAY: { label: "ຂໍເບີກຈ່າຍ", prefix: "PAY", icon: "💸" }
  };
  const STAGE_LABEL = { draft: "ຮ່າງ", approval: "ລໍອະນຸມັດ", payout: "ລໍຈ່າຍເງິນ", open: "ລໍເຄລຍ", refund: "ລໍຮັບເງິນຄືນ", closed: "ສຳເລັດ", rejected: "ຖືກປະຕິເສດ", cancelled: "ຍົກເລີກ" };
  const ENDED = { closed: 1, rejected: 1, cancelled: 1 };
  const PAYER_ROLES = ["Cashier", "Accountant", "Manager", "Admin"];

  function settings() {
    const s = Store.get("settings", "flows") || {};
    return { clear_days: Number(s.clear_days) || 15, split_days: Number(s.split_days) || 3 };
  }
  const getReq = id => { const r = Store.get("requests", id); if (!r) throw new Error("ບໍ່ພົບຄຳຂໍ"); return r; };
  const linesOf = id => Store.where("request_lines", l => l.request_id === id);
  const history = id => Store.where("approvals", a => a.doc_id === id).sort((a, b) => a.ts.localeCompare(b.ts));
  function log(r, action, role, note) { Store.insert("approvals", { doc_type: r.type, doc_id: r.id, doc_ref: r.number, step: r.stage, action, role, note: note || "", ts: new Date().toISOString() }); }
  function set(r, patch) { Store.update("requests", r.id, patch); return Store.get("requests", r.id); }
  const key = s => String(s || "").trim().toLowerCase();

  // gross line amounts (what is on the receipt); VAT 10% is inside when vat = true
  function splitVat(l) { const g = round(l.amount), net = l.vat ? round(g / 1.1) : g; return { gross: g, net, vat: round(g - net) }; }
  function totalOf(id) { return round(linesOf(id).reduce((s, l) => s + Number(l.amount || 0), 0)); }
  const amountOf = r => (r.type === "ADV" ? Number(r.amount) : totalOf(r.id));

  /* ---------- advances bookkeeping ---------- */
  function openAdvances(person) {
    return Store.where("requests", r => r.type === "ADV" && (r.stage === "open") && (!person || key(r.payee) === key(person)));
  }
  function overdueAdvances(asOf, person) { asOf = asOf || today(); return openAdvances(person).filter(r => r.due_clear && r.due_clear < asOf); }
  // an advance is settled by exactly one CLR, so what is outstanding is simply what was paid out
  function advanceOutstanding(adv) { return adv && adv.stage === "open" && adv.paid_at ? round(adv.amount) : 0; }

  /* ---------- create / submit ---------- */
  // ADV: { payee, dept, purpose, amount }
  // CLR: { advance_id, purpose, lines:[{account, description, amount, vat, receipt_no}] }
  // PAY: { payee_type: vendor|employee, vendor_id | payee, purpose, lines:[...] }
  function create(type, data, role) {
    if (!TYPES[type]) throw new Error("ປະເພດບໍ່ຖືກ");
    data = data || {};
    if (!String(data.purpose || "").trim()) throw new Error("ໃສ່ຈຸດປະສົງ");
    const date = data.date || today();
    const base = { type, number: Acc.nextNumber(TYPES[type].prefix, "requests", date), date, purpose: data.purpose, dept: data.dept || "",
      requester_role: role, stage: "draft", approvals_done: [], created_at: new Date().toISOString() };
    let r;
    if (type === "ADV") {
      if (!String(data.payee || "").trim()) throw new Error("ໃສ່ຊື່ຜູ້ເບີກ");
      if (!(Number(data.amount) > 0)) throw new Error("ໃສ່ຈຳນວນເງິນ");
      if (overdueAdvances(today(), data.payee).length) throw new Error(data.payee + " ມີເງິນສຳຮອງຄ້າງເຄລຍເກີນກຳນົດ — ຕ້ອງເຄລຍກ່ອນຈຶ່ງເບີກໃໝ່ໄດ້");
      r = Store.insert("requests", Object.assign(base, { payee: data.payee.trim(), employee_id: data.employee_id || "", amount: round(data.amount) }));
    } else {
      const lines = (data.lines || []).filter(l => Number(l.amount) > 0);
      if (!lines.length) throw new Error("ໃສ່ຢ່າງໜ້ອຍ 1 ລາຍການ");
      lines.forEach(l => {
        const a = Acc.acc(l.account);
        if (!a || a.type !== "Expense" && a.type !== "Asset") throw new Error("ເລືອກໝວດຄ່າໃຊ້ຈ່າຍ: " + (l.description || ""));
        if (!String(l.receipt_no || "").trim()) throw new Error("ໃສ່ເລກທີ່ໃບບິນ/ໃບຮັບເງິນ ທຸກລາຍການ");
      });
      if (type === "CLR") {
        const adv = Store.get("requests", data.advance_id);
        if (!adv || adv.type !== "ADV" || adv.stage !== "open") throw new Error("ເລືອກເງິນສຳຮອງທີ່ຍັງຄ້າງເຄລຍ");
        if (Store.where("requests", x => x.type === "CLR" && x.advance_id === adv.id && !ENDED[x.stage]).length) throw new Error(adv.number + " ມີໃບເຄລຍຢູ່ແລ້ວ");
        r = Store.insert("requests", Object.assign(base, { advance_id: adv.id, payee: adv.payee, employee_id: adv.employee_id }));
      } else {
        if (data.payee_type === "vendor") {
          if (!Store.get("vendors", data.vendor_id)) throw new Error("ເລືອກຜູ້ສະໜອງ");
          r = Store.insert("requests", Object.assign(base, { payee_type: "vendor", vendor_id: data.vendor_id, payee: Store.get("vendors", data.vendor_id).name }));
        } else {
          if (!String(data.payee || "").trim()) throw new Error("ໃສ່ຊື່ພະນັກງານທີ່ຈະເບີກຄືນ");
          r = Store.insert("requests", Object.assign(base, { payee_type: "employee", payee: data.payee.trim(), employee_id: data.employee_id || "" }));
        }
      }
      lines.forEach(l => Store.insert("request_lines", { request_id: r.id, account: String(l.account), description: l.description || "", amount: round(l.amount), vat: !!l.vat, receipt_no: String(l.receipt_no).trim() }));
    }
    log(r, "create", role);
    return Store.get("requests", r.id);
  }
  function submit(id, role) {
    const r = getReq(id);
    if (r.stage !== "draft") throw new Error("ສົ່ງແລ້ວ");
    const chain = chainFor(r.type, amountOf(r));
    log(r, "submit", role);
    return set(r, { stage: "approval", chain, approvals_done: [], submitted_at: new Date().toISOString() });
  }

  /* ---------- approval ---------- */
  function canAct(r, role) {
    if (ENDED[r.stage]) return { ok: false, why: STAGE_LABEL[r.stage] };
    if (r.stage === "draft") return role === r.requester_role || role === "Admin" || role === "Manager" ? { ok: true, why: "" } : { ok: false, why: "ລໍຜູ້ຂໍສົ່ງ" };
    if (r.stage === "approval") return canApproveStep(r, r.type, amountOf(r), role, r.requester_role);
    if (r.stage === "payout" || r.stage === "refund") return PAYER_ROLES.indexOf(role) !== -1 ? { ok: true, why: "" } : { ok: false, why: "ລໍ ແຄຊຽ / ບັນຊີ" };
    if (r.stage === "open") return { ok: false, why: "ລໍ " + r.payee + " ເຄລຍເງິນ (ກຳນົດ " + r.due_clear + ")" };
    return { ok: false, why: "" };
  }
  function approve(id, role, note, date) {
    const r = getReq(id);
    if (r.stage !== "approval") throw new Error("ບໍ່ໄດ້ຢູ່ຂັ້ນອະນຸມັດ");
    const c = canAct(r, role); if (!c.ok) throw new Error(c.why);
    const done = (r.approvals_done || []).concat([{ role, at: new Date().toISOString() }]);
    log(r, "approve", role, note);
    const r2 = set(r, { approvals_done: done });
    if (done.length < r2.chain.length) return r2;           // more approvers to go
    return onFullyApproved(r2, role, date || today());      // last approval → book it
  }
  function reject(id, role, note) {
    const r = getReq(id);
    if (r.stage !== "approval") throw new Error("ບໍ່ໄດ້ຢູ່ຂັ້ນອະນຸມັດ");
    const c = canAct(r, role); if (!c.ok) throw new Error(c.why);
    if (!String(note || "").trim()) throw new Error("ໃສ່ເຫດຜົນ");
    log(r, "reject", role, note);
    return set(r, { stage: "rejected" });
  }
  function cancel(id, role) {
    const r = getReq(id);
    if (r.stage !== "draft" && r.stage !== "approval") throw new Error("ຍົກເລີກບໍ່ໄດ້ຫຼັງອະນຸມັດແລ້ວ");
    log(r, "cancel", role);
    return set(r, { stage: "cancelled" });
  }

  function onFullyApproved(r, role, date) {
    if (r.type === "ADV") return set(r, { stage: "payout" });
    Acc.assertOpen(date);
    const lines = linesOf(r.id);
    if (r.type === "PAY" && r.payee_type === "vendor") {
      const bill = Store.insert("bills", { number: Acc.nextNumber("BILL", "bills", date), vendor_id: r.vendor_id, vendor_ref: lines.map(l => l.receipt_no).join(", "), date,
        due_date: date, currency: "LAK", fx_rate: 1, note: r.number + " " + r.purpose, project_id: "", cc_id: "", status: "draft", paid: 0, request_id: r.id, created_at: new Date().toISOString() });
      lines.forEach(l => { const v = splitVat(l); Store.insert("bill_lines", { bill_id: bill.id, account_id: l.account, description: l.description, qty: 1, price: v.net, tax_code: l.vat ? "tax_in10" : "tax_0" }); });
      try { Acc.postBill(bill); }
      catch (e) { Store.where("bill_lines", x => x.bill_id === bill.id).forEach(x => Store.remove("bill_lines", x.id)); Store.remove("bills", bill.id); throw e; }
      log(r, "post", "auto", bill.number);
      return set(r, { stage: "payout", bill_id: bill.id, posted_total: Store.get("bills", bill.id).total });
    }
    // expense journal for PAY(employee) and CLR
    const jl = []; let vat = 0, gross = 0;
    lines.forEach(l => { const v = splitVat(l); gross += v.gross; vat += v.vat; jl.push({ account: l.account, debit: v.net, credit: 0, memo: l.description + " (" + l.receipt_no + ")" }); });
    if (vat) jl.push({ account: Acc.PA("VAT_IN"), debit: round(vat), credit: 0, memo: "VAT ຊື້ " + r.number });
    gross = round(gross);
    if (r.type === "PAY") {
      jl.push({ account: Acc.PA("EMP_PAY"), debit: 0, credit: gross, memo: "ເບີກຄືນ " + r.payee + " " + r.number });
      const je = Acc.postJournal({ date, source_type: "REQUEST", source_id: r.id, memo: r.number + " " + r.purpose, lines: jl });
      log(r, "post", "auto", je.number);
      return set(r, { stage: "payout", je_id: je.id, posted_total: gross });
    }
    // CLR
    const adv = Store.get("requests", r.advance_id), outstanding = advanceOutstanding(adv);
    const fromAdv = Math.min(gross, outstanding), extra = round(gross - fromAdv), refund = round(outstanding - fromAdv);
    jl.push({ account: Acc.PA("EMP_ADV"), debit: 0, credit: round(fromAdv), memo: "ເຄລຍ " + adv.number });
    if (extra > 0) jl.push({ account: Acc.PA("EMP_PAY"), debit: 0, credit: extra, memo: "ໃຊ້ເກີນ " + adv.number + " — ຈ່າຍຄືນ " + r.payee });
    const je = Acc.postJournal({ date, source_type: "REQUEST", source_id: r.id, memo: r.number + " ເຄລຍ " + adv.number, lines: jl });
    log(r, "post", "auto", je.number);
    const stage = extra > 0 ? "payout" : refund > 0 ? "refund" : "closed";
    if (stage === "closed") set(adv, { stage: "closed", cleared_at: new Date().toISOString(), cleared_by: r.id });
    return set(r, { stage, je_id: je.id, posted_total: gross, extra, refund });
  }

  /* ---------- cash steps ---------- */
  function pay(id, role, { bank_id, date }) {
    const r = getReq(id);
    if (r.stage !== "payout") throw new Error("ບໍ່ໄດ້ຢູ່ຂັ້ນຈ່າຍເງິນ");
    const c = canAct(r, role); if (!c.ok) throw new Error(c.why);
    const bank = Store.get("bank_accounts", bank_id); if (!bank) throw new Error("ເລືອກບັນຊີເງິນ");
    date = date || today();
    if (r.type === "PAY" && r.payee_type === "vendor") {
      const b = Store.get("bills", r.bill_id);
      Acc.payBill({ bill_id: b.id, bank_id, amount: round(Number(b.total) - Number(b.paid || 0)), date });
    } else if (r.type === "ADV") {
      Acc.postJournal({ date, source_type: "REQUEST", source_id: r.id, memo: "ຈ່າຍເງິນສຳຮອງ " + r.number + " " + r.payee,
        lines: [{ account: Acc.PA("EMP_ADV"), debit: r.amount, credit: 0, memo: "ເງິນສຳຮອງ " + r.number + " " + r.payee }, { account: bank.gl_account, debit: 0, credit: r.amount, memo: "ຈ່າຍ " + r.payee }] });
    } else {
      const amt = r.type === "CLR" ? r.extra : r.posted_total;
      Acc.postJournal({ date, source_type: "REQUEST", source_id: r.id, memo: "ຈ່າຍຄືນ " + r.payee + " " + r.number,
        lines: [{ account: Acc.PA("EMP_PAY"), debit: amt, credit: 0, memo: r.number }, { account: bank.gl_account, debit: 0, credit: amt, memo: "ຈ່າຍ " + r.payee }] });
    }
    log(r, "pay", role);
    if (r.type === "ADV") return set(r, { stage: "open", paid_at: date, due_clear: addDays(date, settings().clear_days) });
    if (r.type === "CLR") set(Store.get("requests", r.advance_id), { stage: "closed", cleared_at: new Date().toISOString(), cleared_by: r.id });
    return set(r, { stage: "closed" });
  }
  function receiveRefund(id, role, { bank_id, date }) {
    const r = getReq(id);
    if (r.stage !== "refund") throw new Error("ບໍ່ມີເງິນຕ້ອງຮັບຄືນ");
    const c = canAct(r, role); if (!c.ok) throw new Error(c.why);
    const bank = Store.get("bank_accounts", bank_id); if (!bank) throw new Error("ເລືອກບັນຊີເງິນ");
    const adv = Store.get("requests", r.advance_id);
    Acc.postJournal({ date: date || today(), source_type: "REQUEST", source_id: r.id, memo: "ຮັບເງິນສຳຮອງຄືນ " + adv.number,
      lines: [{ account: bank.gl_account, debit: r.refund, credit: 0, memo: "ຮັບຄືນຈາກ " + r.payee }, { account: Acc.PA("EMP_ADV"), debit: 0, credit: r.refund, memo: "ຄືນເງິນສຳຮອງ " + adv.number }] });
    log(r, "refund", role, String(r.refund));
    set(adv, { stage: "closed", cleared_at: new Date().toISOString(), cleared_by: r.id });
    return set(r, { stage: "closed" });
  }

  /* ---------- warnings for approvers ---------- */
  // same person, same type, within N days, each under the first tier but together over it → maybe split to dodge approval
  function splitWarning(r) {
    const t1 = matrix().tiers[0], limit = t1 && t1.max !== null ? Number(t1.max) : 0;
    if (!limit) return null;
    const days = settings().split_days, me = amountOf(r);
    if (me > limit) return null;
    const near = Store.where("requests", x => x.id !== r.id && x.type === r.type && key(x.payee) === key(r.payee) && !{ rejected: 1, cancelled: 1 }[x.stage] &&
      Math.abs((Date.parse(x.date) - Date.parse(r.date)) / 86400000) <= days && amountOf(x) <= limit);
    const sum = near.reduce((s, x) => s + amountOf(x), me);
    return near.length && sum > limit ? "⚠️ " + r.payee + " ມີ " + (near.length + 1) + " ຄຳຂໍພາຍໃນ " + days + " ວັນ ລວມ " + Math.round(sum).toLocaleString("en-US") + " — ເກີນວົງເງິນຂັ້ນທຳອິດ (ອາດແບ່ງຍອດຫຼົບການອະນຸມັດ)" : null;
  }
  function warnings(r) {
    const w = [];
    const sp = splitWarning(r); if (sp) w.push(sp);
    if (r.type === "ADV") { const o = openAdvances(r.payee).filter(x => x.id !== r.id); if (o.length) w.push(r.payee + " ມີເງິນສຳຮອງຍັງບໍ່ເຄລຍ " + o.length + " ໃບ (" + o.map(x => x.number).join(", ") + ")"); }
    if (r.type === "CLR") { const adv = Store.get("requests", r.advance_id); if (adv && adv.due_clear && adv.due_clear < today()) w.push("ເຄລຍຊ້າກວ່າກຳນົດ (" + adv.due_clear + ")"); }
    return w;
  }

  /* ---------- queues ---------- */
  function queue(role) {
    return Store.all("requests").filter(r => !ENDED[r.stage] && r.stage !== "draft" && r.stage !== "open" && canAct(r, role).ok)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }
  const NEXT = { draft: "ສົ່ງຂໍອະນຸມັດ", approval: "ອະນຸມັດ", payout: "ຈ່າຍເງິນ", refund: "ຮັບເງິນຄືນ", open: "ເຄລຍເງິນສຳຮອງ" };
  function nextAction(r, role) { const c = canAct(r, role); return { label: NEXT[r.stage] || "", allowed: c.ok, why: c.why }; }

  window.Approval = { DEFAULT_TIERS, matrix, setMatrix, chainFor, chainState, canApproveStep };
  window.Flows = { TYPES, STAGE_LABEL, ENDED, settings, create, submit, approve, reject, cancel, pay, receiveRefund, canAct, nextAction, queue,
    linesOf, history, totalOf, amountOf, splitVat, openAdvances, overdueAdvances, advanceOutstanding, warnings };
})();
