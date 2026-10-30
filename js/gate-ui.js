/* LaoBooks ERP – Gate documents screens: list page ("ເອກະສານລໍອະນຸມັດ") and the document page. Logic in gate.js, types in gate-types.js. */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s)), M = v => UI.money(v);
  const view = () => document.getElementById("view");
  const role = () => window.AppCtx.currentRole();
  const TONE = { approval: "wait", posted: "ok", rejected: "bad", cancelled: "draft", failed: "bad" };
  const CHIP = { wait: "s-wait", ok: "s-done", bad: "s-bad", draft: "s-draft" };
  const filter = { f: "todo" };

  // approval steps → the shape DocView draws (and a stepper for the top bar)
  function stepsOf(d) {
    const st = Approval.chainState(d, d.type, d.amount);
    return { st, steps: st.steps.map((s, i) => ({ label: Approval.stepLabel(st.chain[i]), need: s.need, signed: st.done.filter(x => x.step === i), state: d.status === "rejected" && i === st.step ? "bad" : st.complete || i < st.step ? "done" : i === st.step && d.status === "approval" ? "cur" : "wait" })) };
  }
  function modelOf(d) {
    const D = Gate.def(d.type), body = D.describe(d.payload, d), { st, steps } = stepsOf(d), first = (d.log || []).find(x => x.action === "submit");
    let journal = null, journalTitle = "ການລົງບັນຊີ";
    if (d.status === "posted") journal = (d.je_ids || []).map(id => { const j = Store.get("journal_entries", id); return j ? { memo: j.number + " · " + j.memo, lines: Store.where("journal_lines", l => l.je_id === id).map(l => ({ account: l.account, name: l.account_name, debit: l.debit, credit: l.credit })) } : null; }).filter(Boolean);
    else if (d.status === "approval" || d.status === "failed") { journalTitle = "ການລົງບັນຊີທີ່ຈະເກີດຂຶ້ນ ເມື່ອອະນຸມັດຄົບ (ຈຳລອງ)"; const sim = PostMon.simulate(() => D.run(d.payload, { role: d.requester_role })); journal = sim.entries.map(j => ({ memo: j.memo, lines: j.lines })); if (!sim.ok) journalTitle += " — ⚠ " + sim.error; }
    const stepper = [{ label: "ສົ່ງຂໍ", state: "done" }].concat(steps.map(s => ({ label: "ອະນຸມັດ: " + s.label, state: s.state }))).concat([{ label: "ລົງບັນຊີ", state: d.status === "posted" ? "done" : d.status === "failed" ? "bad" : "wait" }]);
    const chk = d.status === "approval" ? Gate.check(d, role()) : null, mine = d.requester_role === role() || ["Admin", "Manager"].indexOf(role()) >= 0;
    let actions = "";
    if (chk && chk.ok) actions += `<button class="btn btn-ok btn-lg btn-block" id="dv-ok">✓ ອະນຸມັດ (ຂັ້ນ ${st.step + 1}/${st.chain.length})</button><button class="btn btn-danger btn-lg btn-block" id="dv-no">✕ ບໍ່ອະນຸມັດ</button>`;
    if (d.status === "failed") actions += `<button class="btn btn-primary btn-lg btn-block" id="dv-retry">ລອງລົງບັນຊີໃໝ່</button>`;
    if ((d.status === "approval" || d.status === "failed") && mine) actions += `<button class="btn btn-ghost btn-block" id="dv-cancel">ຍົກເລີກເອກະສານ</button>`;
    actions += `<button class="btn btn-ghost btn-block" id="dv-print">🖨 ພິມ</button>`;
    return { titles: D.title, number: d.number, date: d.date, status: { label: Gate.STAGE[d.status], tone: TONE[d.status] }, stepper, meta: body.meta.concat([["ຜູ້ຂໍ", d.requester_name ? d.requester_name + " (" + d.requester_role + ")" : d.requester_role]]),
      attach: { ref: ["gate_docs", d.id], label: d.number, hint: D.attachHint }, cols: body.cols, rows: body.rows, totals: body.totals, note: body.note, journal, journalTitle, steps, requester: { name: d.requester_name, role: d.requester_role, at: first && first.at }, log: d.log || [],
      notice: d.status === "failed" ? "⚠ " + E(d.error) : chk && !chk.ok ? E(chk.why) : chk && chk.ok ? "ທ່ານມີສິດອະນຸມັດ — ກວດລາຍການແລ້ວກົດອະນຸມັດ" : "", actions, back: "ລາຍການເອກະສານ", onBack: () => { location.hash = "#/gate"; } };
  }

  function open(id) {
    const d = Gate.get(id), m = modelOf(d), again = () => open(id);
    const act = (fn, ok) => { try { fn(); if (ok) UI.toast(ok, "ok"); } catch (e) { UI.toast(e.message, "err"); } };
    DocView.open(m, (bd, close) => {
      const on = (s, f) => { const b = bd.querySelector(s); if (b) b.onclick = f; };
      const redo = () => { close(); const n = Gate.get(id); if (location.hash === "#/gate") page(); open(n.id); };
      on("#dv-ok", () => act(() => { const r = Gate.approve(id, role()); UI.toast(r.status === "posted" ? "ອະນຸມັດຄົບ — ລົງບັນຊີແລ້ວ ✓" : r.status === "failed" ? "ອະນຸມັດແລ້ວ ແຕ່ລົງບັນຊີບໍ່ໄດ້: " + r.error : "ອະນຸມັດແລ້ວ — ລໍຜູ້ອະນຸມັດຂັ້ນຕໍ່ໄປ", r.status === "failed" ? "warn" : "ok"); redo(); }));
      on("#dv-no", () => { const n = prompt("ເຫດຜົນທີ່ບໍ່ອະນຸມັດ"); if (n != null) act(() => { Gate.reject(id, role(), n); redo(); }, "ບໍ່ອະນຸມັດແລ້ວ"); });
      on("#dv-retry", () => act(() => { Gate.retry(id); redo(); }));
      on("#dv-cancel", () => UI.confirmDialog("ຍົກເລີກ " + d.number + "?", () => act(() => { Gate.cancel(id, role(), ""); redo(); }, "ຍົກເລີກແລ້ວ")));
      on("#dv-print", () => DocView.print(modelOf(Gate.get(id))));
    });
  }

  function page() {
    const all = Store.all("gate_docs").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")), mineQ = Gate.queue(role()).map(d => d.id);
    const sets = { todo: all.filter(d => d.status === "approval" || d.status === "failed"), done: all.filter(d => d.status === "posted"), all };
    const seg = [["todo", "ລໍອະນຸມັດ"], ["done", "ລົງບັນຊີແລ້ວ"], ["all", "ທັງໝົດ"]].map(([k, l]) => `<button data-f="${k}" class="${filter.f === k ? "on" : ""}">${l} (${sets[k].length})</button>`).join("");
    view().innerHTML = UI.pageHead("ເອກະສານລໍອະນຸມັດ", "GRN · ຮັບເງິນ · ຈ່າຍເງິນ · ຄ່າເສື່ອມ · ເງິນເດືອນ — ລົງບັນຊີເມື່ອຜູ້ອະນຸມັດເຊັນຄົບ", '<button class="btn btn-ghost" id="gt-set">ຕັ້ງຄ່າຂັ້ນອະນຸມັດ</button>') +
      `<div class="seg mb-3">${seg}</div>` +
      UI.table([{ h: "ເລກທີ", key: "number" }, { h: "ປະເພດ", render: r => E(Gate.def(r.type).label) }, { h: "ວັນທີ", render: r => UI.fmtDate(r.date) }, { h: "ຜູ້ຂໍ", render: r => E(r.requester_name || r.requester_role) },
        { h: "ຍອດ", cls: "num", render: r => M(r.amount) }, { h: "ສະຖານະ", render: r => `<span class="chip ${CHIP[TONE[r.status]]}">${E(Gate.STAGE[r.status])}</span>` },
        { h: "ຂັ້ນຕໍ່ໄປ", render: r => `<button class="btn ${mineQ.indexOf(r.id) >= 0 ? "btn-ok" : "btn-ghost"} btn-sm" data-open="${r.id}">${mineQ.indexOf(r.id) >= 0 ? "ອະນຸມັດ →" : "ເບິ່ງ"}</button>` }], sets[filter.f]);
    view().querySelectorAll("[data-f]").forEach(b => b.onclick = () => { filter.f = b.dataset.f; page(); });
    view().querySelectorAll("[data-open]").forEach(b => b.onclick = () => open(b.dataset.open));
    const st = document.getElementById("gt-set"); if (st) st.onclick = () => FlowsUI.matrixModal("GRN");
  }

  // used by the screens that used to post at once: runs the action now, or sends it for approval and shows the document
  function send(type, payload, opts) {
    opts = opts || {};
    try {
      const r = Gate.submit(type, payload, role(), { key: opts.key });
      if (r.pending) { UI.toast("ສົ່ງຂໍອະນຸມັດແລ້ວ — ເລກ " + r.doc.number, "ok"); open(r.doc.id); }
      else { UI.toast(opts.done || "ບັນທຶກແລ້ວ", "ok"); if (opts.after) opts.after(r.result); }
      return r;
    } catch (e) { UI.toast(e.message, "err"); return null; }
  }

  window.GateUI = { page, open, send, modelOf };
})();
