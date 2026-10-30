/* ============================================================
   LaoBooks ERP – Approval gate (ສວິດ "ຕ້ອງອະນຸມັດກ່ອນລົງບັນຊີ" ຕໍ່ປະເພດເອກະສານ)
   One engine for the documents that used to post the moment someone pressed the button:
     GRN ໃບຮັບສິນຄ້າ · RCPT ໃບຮັບເງິນ · PAYV ໃບຈ່າຍເງິນ · DEPR ໃບຄ່າເສື່ອມ · PAYROLL ໃບເງິນເດືອນ
   • Gate.submit(type, payload, role): switch OFF → runs at once; switch ON → creates a gate document
     (status "approval") that waits for the chain of the approval matrix (roles / named people / N signers).
   • The LAST signature runs the original action (the poster registered for the type) — nothing is posted before that.
   • The requester cannot approve their own document (Approval.canApproveStep).
   • A document that cannot post (period locked, stock gone …) becomes "failed" with the reason and can be retried.
   Types are registered in gate-types.js. Pure logic (no DOM) so it can be unit-tested in Node.
   ============================================================ */
(function () {
  const REG = {};
  const DEFAULT_ON = { JEFIX: true, PAYV: true, PAYC: true, DEPR: true, PAYROLL: true }; // GRN and RCPT happen all day → off unless switched on
  const STAGE = { approval: "ລໍອະນຸມັດ", posted: "ລົງບັນຊີແລ້ວ", rejected: "ປະຕິເສດ", cancelled: "ຍົກເລີກ", failed: "ລົງບັນຊີບໍ່ໄດ້" };
  const me = () => (window.AppCtx && AppCtx.userLabel && AppCtx.userLabel()) || "";
  const uid = () => (window.AppCtx && AppCtx.currentUserId && AppCtx.currentUserId()) || "";
  const get = id => { const d = Store.get("gate_docs", id); if (!d) throw new Error("ບໍ່ພົບເອກະສານ"); return d; };
  const cfg = () => Store.get("settings", "gate") || {};

  const register = (type, def) => { REG[type] = def; };
  const def = type => { if (!REG[type]) throw new Error("ບໍ່ຮູ້ຈັກປະເພດ " + type); return REG[type]; };
  const types = () => Object.keys(REG).map(k => ({ type: k, label: REG[k].label }));
  const isOn = type => { const o = (cfg().on || {})[type]; return o === undefined ? !!DEFAULT_ON[type] : !!o; };
  function setOn(type, on) {
    def(type); const next = Object.assign({}, cfg().on, { [type]: !!on });
    if (Store.get("settings", "gate")) Store.update("settings", "gate", { on: next }); else Store.insert("settings", { id: "gate", on: next });
  }
  function log(d, action, role, note) { Store.update("gate_docs", d.id, { log: (Store.get("gate_docs", d.id).log || []).concat([{ at: new Date().toISOString(), action, role, by: me(), note: note || "" }]) }); }

  // validate, then either run now (switch off) or park the document for approval
  function submit(type, payload, role, opts) {
    const D = def(type); opts = opts || {};
    if (D.validate) D.validate(payload);
    if (!isOn(type)) return { pending: false, result: D.run(payload, { role }) };
    if (opts.key) { const dup = Store.where("gate_docs", g => g.key === opts.key && (g.status === "approval" || g.status === "failed"))[0]; if (dup) throw new Error("ມີເອກະສານນີ້ລໍອະນຸມັດຢູ່ແລ້ວ: " + dup.number); }
    const date = payload.date || new Date().toISOString().slice(0, 10), amount = Number(D.amount ? D.amount(payload) : 0) || 0;
    const d = Store.insert("gate_docs", { type, key: opts.key || "", number: Acc.nextNumber(D.prefix, "gate_docs", date), date, amount, payload, status: "approval", chain: Approval.chainFor(type, amount), approvals_done: [], requester_role: role, requester_user: uid(), requester_name: me(), log: [], created_at: new Date().toISOString() });
    log(d, "submit", role);
    return { pending: true, doc: Store.get("gate_docs", d.id) };
  }
  const check = (d, role) => Approval.canApproveStep(d, d.type, d.amount, role, d.requester_role, uid());

  function approve(id, role, note) {
    const d = get(id); if (d.status !== "approval") throw new Error("ເອກະສານບໍ່ຢູ່ຂັ້ນລໍອະນຸມັດ");
    const c = check(d, role); if (!c.ok) throw new Error(c.why);
    const ap = Approval.addApproval(d, d.type, d.amount, role, uid());
    Store.update("gate_docs", id, { approvals_done: ap.done }); log(d, "approve", role, note);
    return ap.complete ? post(id) : get(id);
  }
  function post(id) {
    const d = get(id); if (d.status !== "approval" && d.status !== "failed") throw new Error("ລົງບັນຊີບໍ່ໄດ້");
    try {
      const before = new Set(Store.all("journal_entries").map(j => j.id));
      const result = def(d.type).run(d.payload, { role: d.requester_role, doc: d });
      const je_ids = Store.all("journal_entries").filter(j => !before.has(j.id)).map(j => j.id);
      Store.update("gate_docs", id, { status: "posted", posted_at: new Date().toISOString(), error: "", je_ids, result: result && result.id ? { id: result.id, number: result.number } : null });
      log(d, "post", "auto", "");
    } catch (e) { Store.update("gate_docs", id, { status: "failed", error: e.message }); log(d, "failed", "auto", e.message); }
    return get(id);
  }
  const retry = id => { const d = get(id); if (d.status !== "failed") throw new Error("ລອງໃໝ່ໄດ້ສະເພາະເອກະສານທີ່ລົງບໍ່ໄດ້"); return post(id); };
  function reject(id, role, note) {
    const d = get(id); if (d.status !== "approval") throw new Error("ເອກະສານບໍ່ຢູ່ຂັ້ນລໍອະນຸມັດ");
    const c = check(d, role); if (!c.ok) throw new Error(c.why);
    if (!String(note || "").trim()) throw new Error("ໃສ່ເຫດຜົນທີ່ປະຕິເສດ");
    Store.update("gate_docs", id, { status: "rejected" }); log(d, "reject", role, note); return get(id);
  }
  function cancel(id, role, note) {
    const d = get(id); if (d.status !== "approval" && d.status !== "failed") throw new Error("ຍົກເລີກບໍ່ໄດ້ຫຼັງລົງບັນຊີ");
    Store.update("gate_docs", id, { status: "cancelled" }); log(d, "cancel", role, note); return get(id);
  }
  // documents waiting for THIS role (for the "to do" lists)
  const queue = role => Store.where("gate_docs", d => d.status === "approval" && check(d, role).ok);
  const pending = () => Store.where("gate_docs", d => d.status === "approval" || d.status === "failed");

  window.Gate = { STAGE, register, types, isOn, setOn, submit, approve, reject, cancel, retry, post, check, queue, pending, get, def };
})();
