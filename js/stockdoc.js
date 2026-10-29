/* ============================================================
   LaoBooks ERP – Stock documents (ເອກະສານສາງ) with an approval chain
     ISS  ໃບຈ່າຍສິນຄ້າ (ເບີກໃຊ້ພາຍໃນ)   Dr expense / Cr stock
     ADJ  ໃບປັບປຸງສາງ (+/− ຈຳນວນ, ມີເຫດຜົນ)
     CNT  ໃບກວດນັບສະຕັອກ (ນັບຈິງ ທຽບ ລະບົບ → ປັບສ່ວນຕ່າງ)
   draft → approval (chain from the approval matrix, type "STOCK", by estimated value) → posted.
   The last approver's signature posts the stock movements and journals. The requester cannot approve.
   Pure logic (no DOM) so it can be unit-tested in Node.
   ============================================================ */
(function () {
  const round = n => Math.round((Number(n) || 0) * 100) / 100;
  const today = () => new Date().toISOString().slice(0, 10);
  const LABEL = { ISS: "ໃບຈ່າຍສິນຄ້າ (ເບີກໃຊ້ພາຍໃນ)", ADJ: "ໃບປັບປຸງສາງ", CNT: "ໃບກວດນັບສະຕັອກ" };
  const STAGE = { draft: "ຮ່າງ", approval: "ລໍອະນຸມັດ", posted: "ລົງບັນຊີແລ້ວ", rejected: "ປະຕິເສດ", cancelled: "ຍົກເລີກ" };
  const get = id => { const d = Store.get("stock_docs", id); if (!d) throw new Error("ບໍ່ພົບເອກະສານ"); return d; };
  const item = id => Store.get("items", id);
  const me = () => (window.AppCtx && AppCtx.userLabel && AppCtx.userLabel()) || "";
  const uid = () => (window.AppCtx && AppCtx.currentUserId && AppCtx.currentUserId()) || "";
  function log(d, action, role, note) { Store.update("stock_docs", d.id, { log: (d.log || []).concat([{ at: new Date().toISOString(), action, role, by: me(), note: note || "" }]) }); }

  // what a line moves: ISS → −qty, ADJ → delta, CNT → counted − what the system holds NOW
  const deltaOf = (d, l) => d.type === "ISS" ? -Number(l.qty) : d.type === "ADJ" ? Number(l.delta) : round(Number(l.counted) - Acc.stockQty(l.item_id));
  const valueOf = d => round((d.lines || []).reduce((s, l) => { const it = item(l.item_id); return s + Math.abs(d.status === "draft" || d.status === "approval" ? deltaOf(d, l) : Number(l.applied || 0)) * (it ? Number(it.avg_cost) || 0 : 0); }, 0));

  function create(type, data, role) {
    if (!LABEL[type]) throw new Error("ປະເພດເອກະສານບໍ່ຖືກ");
    const date = data.date || today(), seen = new Set(), lines = [];
    (data.lines || []).forEach(l => {
      if (!l.item_id) return;
      const it = item(l.item_id); if (!it || it.type !== "stock") throw new Error("ເລືອກສິນຄ້າທີ່ມີ stock");
      if (seen.has(l.item_id)) throw new Error("ສິນຄ້າຊ້ຳ: " + it.name);
      seen.add(l.item_id);
      if (type === "ISS") { if (!(Number(l.qty) > 0)) throw new Error("ຈຳນວນຕ້ອງ > 0: " + it.name); lines.push({ item_id: l.item_id, qty: Number(l.qty) }); }
      else if (type === "ADJ") { if (!Number(l.delta)) throw new Error("ໃສ່ຈຳນວນປັບ (+/−): " + it.name); lines.push({ item_id: l.item_id, delta: Number(l.delta) }); }
      else { if (l.counted === "" || l.counted == null || !(Number(l.counted) >= 0)) throw new Error("ໃສ່ຈຳນວນທີ່ນັບໄດ້: " + it.name); lines.push({ item_id: l.item_id, counted: Number(l.counted), system: Acc.stockQty(l.item_id) }); }
    });
    if (!lines.length) throw new Error("ໃສ່ຢ່າງໜ້ອຍ 1 ລາຍການ");
    if (!String(data.reason || "").trim()) throw new Error(type === "ISS" ? "ໃສ່ເຫດຜົນ / ໃຊ້ເຮັດຫຍັງ" : "ໃສ່ເຫດຜົນ");
    if (type === "ISS" && !String(data.dept || "").trim()) throw new Error("ໃສ່ພະແນກ / ຜູ້ຮັບ");
    if (data.expense && !Acc.acc(data.expense)) throw new Error("ບັນຊີຄ່າໃຊ້ຈ່າຍບໍ່ຖືກ");
    const d = Store.insert("stock_docs", { type, number: Acc.nextNumber(type, "stock_docs", date), date, dept: data.dept || "", reason: data.reason, expense: data.expense || "", lines, status: "draft",
      requester_role: role, requester_user: uid(), requester_name: me(), approvals_done: [], log: [], created_at: new Date().toISOString() });
    log(d, "create", role);
    return Store.get("stock_docs", d.id);
  }

  function submit(id, role) {
    const d = get(id); if (d.status !== "draft") throw new Error("ສົ່ງຂໍອະນຸມັດໄດ້ສະເພາະຮ່າງ");
    Acc.assertOpen(d.date);
    if (d.type === "ISS") d.lines.forEach(l => { if (Acc.stockQty(l.item_id) < l.qty) throw new Error("ສະຕັອກບໍ່ພໍ: " + item(l.item_id).name + " (ມີ " + Acc.stockQty(l.item_id) + ")"); });
    const value = valueOf(d), chain = Approval.chainFor("STOCK", value);
    Store.update("stock_docs", id, { status: "approval", value, chain, approvals_done: [] });
    log(d, "submit", role, "ມູນຄ່າ " + value);
    return get(id);
  }
  const check = (d, role) => Approval.canApproveStep(d, "STOCK", d.value, role, d.requester_role, uid());

  function approve(id, role, note) {
    const d = get(id); if (d.status !== "approval") throw new Error("ເອກະສານບໍ່ຢູ່ຂັ້ນລໍອະນຸມັດ");
    const c = check(d, role); if (!c.ok) throw new Error(c.why);
    const ap = Approval.addApproval(d, "STOCK", d.value, role, uid());
    Store.update("stock_docs", id, { approvals_done: ap.done });
    log(d, "approve", role, note);
    return ap.complete ? post(id) : get(id);
  }
  function reject(id, role, note) {
    const d = get(id); if (d.status !== "approval") throw new Error("ເອກະສານບໍ່ຢູ່ຂັ້ນລໍອະນຸມັດ");
    const c = check(d, role); if (!c.ok) throw new Error(c.why);
    if (!String(note || "").trim()) throw new Error("ໃສ່ເຫດຜົນທີ່ປະຕິເສດ");
    Store.update("stock_docs", id, { status: "rejected" }); log(d, "reject", role, note); return get(id);
  }
  function cancel(id, role, note) {
    const d = get(id); if (d.status !== "draft" && d.status !== "approval") throw new Error("ຍົກເລີກບໍ່ໄດ້ຫຼັງລົງບັນຊີ");
    Store.update("stock_docs", id, { status: "cancelled" }); log(d, "cancel", role, note); return get(id);
  }

  // moves stock and books every line (all-or-nothing is guaranteed by checking everything first)
  function post(id) {
    const d = get(id); if (d.status !== "approval") throw new Error("ລົງບັນຊີບໍ່ໄດ້");
    Acc.assertOpen(d.date);
    const moves = d.lines.map(l => ({ l, delta: deltaOf(d, l) })).filter(m => m.delta);
    moves.forEach(m => { if (d.type === "ISS" && Acc.stockQty(m.l.item_id) < -m.delta) throw new Error("ສະຕັອກບໍ່ພໍ: " + item(m.l.item_id).name); });
    moves.forEach(m => Acc.stockAdjust({ item_id: m.l.item_id, qtyDelta: m.delta, reason: LABEL[d.type] + " " + d.number + (d.reason ? " · " + d.reason : ""), date: d.date, kind: d.type === "ISS" ? "usage" : "loss", expense: d.type === "ISS" ? (d.expense || Acc.PA("GEN_EXP")) : "", ref: d.number }));
    Store.update("stock_docs", id, { status: "posted", posted_at: new Date().toISOString(), lines: d.lines.map(l => Object.assign({}, l, { applied: Math.abs(deltaOf(d, l)) })) });
    log(d, "post", "auto", moves.length + " ລາຍການ");
    return get(id);
  }

  window.StockDoc = { LABEL, STAGE, create, submit, approve, reject, cancel, post, check, valueOf, deltaOf, get };
})();
