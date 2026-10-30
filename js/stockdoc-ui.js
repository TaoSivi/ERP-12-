/* LaoBooks ERP – Stock documents screen (list · new · detail · print). Logic in stockdoc.js. */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s)), M = v => UI.money(v);
  const role = () => window.AppCtx.currentRole();
  const stockItems = () => Store.where("items", i => i.type === "stock");
  const itemName = id => (Store.get("items", id) || {}).name || id;
  const CHIP = { draft: "s-draft", approval: "s-wait", posted: "s-done", rejected: "s-bad", cancelled: "s-draft" };
  const act = (fn, ok, after) => { try { fn(); if (ok) UI.toast(ok, "ok"); (after || list)(); } catch (e) { UI.toast(e.message, "err"); } };

  function list() {
    const docs = Store.all("stock_docs").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    UI.modal("ເອກະສານສາງ", `<div class="flex flex-wrap gap-2 mb-3"><button class="btn btn-primary btn-sm" data-new="ISS">+ ໃບຈ່າຍສິນຄ້າ</button><button class="btn btn-primary btn-sm" data-new="ADJ">+ ໃບປັບປຸງສາງ</button><button class="btn btn-primary btn-sm" data-new="CNT">+ ໃບກວດນັບ</button></div>
      <div class="tbl-wrap"><table class="data"><thead><tr><th>ເລກທີ</th><th>ປະເພດ</th><th>ວັນທີ</th><th class="num">ມູນຄ່າ</th><th>ສະຖານະ</th><th></th></tr></thead><tbody>${docs.map(d => `<tr><td>${E(d.number)}</td><td>${E(StockDoc.LABEL[d.type])}</td><td>${E(d.date)}</td><td class="num">${M(StockDoc.valueOf(d))}</td><td><span class="chip ${CHIP[d.status]}">${E(StockDoc.STAGE[d.status])}</span></td><td><button class="btn btn-ghost btn-sm" data-open="${d.id}">ເບິ່ງ</button></td></tr>`).join("") || '<tr><td colspan="6" class="text-center text-slate-400 py-4">ຍັງບໍ່ມີເອກະສານ</td></tr>'}</tbody></table></div>`, { wide: true });
    document.querySelectorAll("[data-new]").forEach(b => b.onclick = () => form(b.dataset.new));
    document.querySelectorAll("[data-open]").forEach(b => b.onclick = () => detail(b.dataset.open));
  }

  function form(type) {
    const items = stockItems(), exp = Cat.accounts(Store.where("accounts", a => a.type === "Expense" && !a.is_header), "expense");
    const opts = items.map(i => `<option value="${i.id}">${E(i.name)} (ຄົງ ${Acc.stockQty(i.id)} ${E(i.uom || "")})</option>`).join("");
    const colHead = type === "ISS" ? "ຈຳນວນຈ່າຍ" : type === "ADJ" ? "ປັບ (+ເພີ່ມ / −ຫຼຸດ)" : "ນັບໄດ້ຈິງ";
    UI.modal(StockDoc.LABEL[type], `<div class="grid sm:grid-cols-2 gap-3 mb-3">
        <div><label class="field">ວັນທີ</label><input class="input" type="date" id="sd-date" value="${UI.today()}"></div>
        ${type === "ISS" ? `<div><label class="field">ພະແນກ / ຜູ້ຮັບ *</label><input class="input" id="sd-dept"></div>` : ""}
        <div class="${type === "ISS" ? "" : "sm:col-span-2"}"><label class="field">${type === "ISS" ? "ໃຊ້ເຮັດຫຍັງ *" : "ເຫດຜົນ *"}</label><input class="input" id="sd-reason"></div>
        ${type === "ISS" ? `<div><label class="field">ບັນຊີຄ່າໃຊ້ຈ່າຍ</label><select class="input" id="sd-exp">${exp.map(a => `<option value="${a.code}" ${a.code === Acc.PA("GEN_EXP") ? "selected" : ""}>${E(a.code + " " + a.name)}</option>`).join("")}</select></div>` : ""}</div>
      ${type === "CNT" ? '<button class="btn btn-ghost btn-sm mb-2" id="sd-all">ໂຫຼດສິນຄ້າທັງໝົດ</button>' : ""}
      <div class="tbl-wrap"><table class="data"><thead><tr><th>ສິນຄ້າ</th><th class="num">${colHead}</th><th></th></tr></thead><tbody id="sd-rows"></tbody></table></div>
      <button class="btn btn-ghost btn-sm mt-2" id="sd-add">+ ເພີ່ມແຖວ</button>
      <div class="flex justify-end gap-2 mt-4"><button class="btn btn-ghost" id="sd-draft">ບັນທຶກຮ່າງ</button><button class="btn btn-primary" id="sd-send">ບັນທຶກ + ສົ່ງອະນຸມັດ</button></div>`, { wide: true });
    const rows = document.getElementById("sd-rows");
    const addRow = (id, v) => { const tr = document.createElement("tr"); tr.innerHTML = `<td><select class="input sd-item"><option value=""></option>${opts}</select></td><td><input class="input num sd-q" type="number" step="any"></td><td><button class="btn btn-ghost btn-sm">✕</button></td>`; if (id) tr.querySelector(".sd-item").value = id; if (v != null) tr.querySelector(".sd-q").value = v; tr.querySelector("button").onclick = () => tr.remove(); rows.appendChild(tr); };
    addRow(); document.getElementById("sd-add").onclick = () => addRow();
    const all = document.getElementById("sd-all"); if (all) all.onclick = () => { rows.innerHTML = ""; items.forEach(i => addRow(i.id, "")); };
    const read = () => ({ date: document.getElementById("sd-date").value, reason: document.getElementById("sd-reason").value, dept: (document.getElementById("sd-dept") || {}).value || "", expense: (document.getElementById("sd-exp") || {}).value || "",
      lines: [...rows.querySelectorAll("tr")].map(tr => { const id = tr.querySelector(".sd-item").value, q = tr.querySelector(".sd-q").value; return type === "ISS" ? { item_id: id, qty: q } : type === "ADJ" ? { item_id: id, delta: q } : { item_id: id, counted: q }; }).filter(l => l.item_id) });
    const save = send => { try { const d = StockDoc.create(type, read(), role()); if (send) StockDoc.submit(d.id, role()); UI.toast(send ? "ສົ່ງອະນຸມັດແລ້ວ" : "ບັນທຶກຮ່າງແລ້ວ", "ok"); detail(d.id); } catch (e) { UI.toast(e.message, "err"); } };
    document.getElementById("sd-draft").onclick = () => save(false); document.getElementById("sd-send").onclick = () => save(true);
  }

  // the document page (same layout as every other approval document)
  function modelOf(d) {
    const colHead = d.type === "ISS" ? "ຈຳນວນຈ່າຍ" : d.type === "ADJ" ? "ປັບ (+/−)" : "ນັບໄດ້ (ລະບົບ)";
    const st = d.chain && d.chain.length ? Approval.chainState(d, "STOCK", d.value) : null, first = (d.log || []).find(x => x.action === "submit" || x.action === "create");
    const steps = st ? st.steps.map((s, i) => ({ label: Approval.stepLabel(st.chain[i]), need: s.need, signed: st.done.filter(x => x.step === i), state: d.status === "rejected" && i === st.step ? "bad" : st.complete || i < st.step ? "done" : i === st.step && d.status === "approval" ? "cur" : "wait" })) : [];
    let journal = null, journalTitle = "ການລົງບັນຊີ";
    if (d.status === "posted") journal = Store.where("journal_entries", j => j.source_type === "STOCK_ADJ" && j.source_id === d.number).map(j => ({ memo: j.number + " · " + j.memo, lines: Store.where("journal_lines", l => l.je_id === j.id).map(l => ({ account: l.account, name: l.account_name, debit: l.debit, credit: l.credit })) }));
    else if (d.status === "approval") { journalTitle = "ການລົງບັນຊີທີ່ຈະເກີດຂຶ້ນ ເມື່ອອະນຸມັດຄົບ (ຈຳລອງ)"; const sim = PostMon.simulate(() => StockDoc.post(d.id)); journal = sim.entries.map(j => ({ memo: j.memo, lines: j.lines })); if (!sim.ok) journalTitle += " — ⚠ " + sim.error; }
    const me = role(), chk = d.status === "approval" ? StockDoc.check(d, me) : null, mine = d.requester_role === me || ["Admin", "Manager"].indexOf(me) >= 0;
    let actions = "";
    if (d.status === "draft") actions += '<button class="btn btn-primary btn-lg btn-block" id="dv-submit">ສົ່ງອະນຸມັດ</button>';
    if (chk && chk.ok) actions += `<button class="btn btn-ok btn-lg btn-block" id="dv-ok">✓ ອະນຸມັດ (ຂັ້ນ ${st.step + 1}/${st.chain.length})</button><button class="btn btn-danger btn-lg btn-block" id="dv-no">✕ ບໍ່ອະນຸມັດ</button>`;
    if ((d.status === "draft" || d.status === "approval") && mine) actions += '<button class="btn btn-ghost btn-block" id="dv-cancel">ຍົກເລີກເອກະສານ</button>';
    actions += '<button class="btn btn-ghost btn-block" id="dv-print">🖨 ພິມ</button>';
    const stepper = [{ label: "ສ້າງ", state: "done" }, { label: "ສົ່ງອະນຸມັດ", state: d.status === "draft" ? "cur" : "done" }].concat(steps.map(s => ({ label: "ອະນຸມັດ: " + s.label, state: s.state }))).concat([{ label: "ຕັດສະຕັອກ & ລົງບັນຊີ", state: d.status === "posted" ? "done" : "wait" }]);
    return { attach: { ref: ["stock_docs", d.id], label: d.number, hint: d.type === "ISS" ? "ໃບຂໍເບີກ / ຮູບການຈ່າຍສິນຄ້າ" : d.type === "ADJ" ? "ຮູບສິນຄ້າເສຍ / ເຫດຜົນການປັບ" : "ໃບນັບສະຕັອກ / ຮູບການນັບ" }, titles: [StockDoc.LABEL[d.type], d.type === "ISS" ? "GOODS ISSUE NOTE" : d.type === "ADJ" ? "STOCK ADJUSTMENT" : "STOCK COUNT SHEET"], number: d.number, date: d.date, status: { label: StockDoc.STAGE[d.status], tone: d.status === "posted" ? "ok" : d.status === "approval" ? "wait" : d.status === "rejected" ? "bad" : "draft" }, stepper,
      meta: [["ພະແນກ / ຜູ້ຮັບ", d.dept], ["ເຫດຜົນ", d.reason], ["ຜູ້ຂໍ", d.requester_name ? d.requester_name + " (" + d.requester_role + ")" : d.requester_role]], cols: ["ສິນຄ້າ", colHead], rows: d.lines.map(l => [itemName(l.item_id), d.type === "ISS" ? String(l.qty) : d.type === "ADJ" ? (l.delta > 0 ? "+" : "") + l.delta : l.counted + " (" + l.system + ")"]),
      totals: [["ມູນຄ່າ", M(StockDoc.valueOf(d)), true]], journal, journalTitle, steps, requester: d.status === "draft" ? null : { name: d.requester_name, role: d.requester_role, at: first && first.at }, log: d.log || [],
      notice: chk && !chk.ok ? E(chk.why) : d.status === "draft" ? "ກົດ ສົ່ງອະນຸມັດ ເມື່ອກວດລາຍການແລ້ວ" : "", actions, back: "ລາຍການເອກະສານສາງ", onBack: list };
  }
  function detail(id) {
    const d = StockDoc.get(id), me = role(), again = () => detail(id);
    DocView.open(modelOf(d), (bd, close) => {
      const on = (s, f) => { const b = bd.querySelector(s); if (b) b.onclick = () => { try { f(); } catch (e) { UI.toast(e.message, "err"); } }; };
      const redo = ok => { if (ok) UI.toast(ok, "ok"); close(); again(); };
      on("#dv-submit", () => { StockDoc.submit(id, me); redo("ສົ່ງອະນຸມັດແລ້ວ"); });
      on("#dv-ok", () => { const r = StockDoc.approve(id, me); redo(r.status === "posted" ? "ອະນຸມັດຄົບ — ຕັດສະຕັອກ ແລະ ລົງບັນຊີແລ້ວ ✓" : "ອະນຸມັດແລ້ວ — ລໍຜູ້ອະນຸມັດຂັ້ນຕໍ່ໄປ"); });
      on("#dv-no", () => { const n = prompt("ເຫດຜົນທີ່ບໍ່ອະນຸມັດ"); if (n != null) { StockDoc.reject(id, me, n); redo("ບໍ່ອະນຸມັດແລ້ວ"); } });
      on("#dv-cancel", () => UI.confirmDialog("ຍົກເລີກ " + d.number + "?", () => { try { StockDoc.cancel(id, me, ""); redo("ຍົກເລີກແລ້ວ"); } catch (e) { UI.toast(e.message, "err"); } }));
      on("#dv-print", () => DocView.print(modelOf(StockDoc.get(id))));
    });
  }

  function print(d) {
    const rows = d.lines.map((l, i) => [`${i + 1}. ${E(itemName(l.item_id))}`, d.type === "ISS" ? String(l.qty) : d.type === "ADJ" ? (l.delta > 0 ? "+" : "") + l.delta : l.counted + " / ລະບົບ " + l.system]);
    const ap = (d.approvals_done || []).map(a => (a.name || a.role) + " " + (a.at || "").slice(0, 10)).join(", ");
    window.AppCtx.proPrint(d.number, { docTitle: StockDoc.LABEL[d.type].toUpperCase(), meta: [["ເລກທີ", d.number], ["ວັນທີ", UI.fmtDate(d.date)], ["ສະຖານະ", StockDoc.STAGE[d.status]]],
      party: { title: d.type === "ISS" ? "ພະແນກ / ຜູ້ຮັບ" : "ເຫດຜົນ", name: d.type === "ISS" ? d.dept : d.reason, sub: d.type === "ISS" ? d.reason : "" },
      cols: ["ລາຍການ", d.type === "ISS" ? "ຈຳນວນຈ່າຍ" : d.type === "ADJ" ? "ປັບ" : "ນັບໄດ້"], rows, totals: [["ມູນຄ່າ", M(StockDoc.valueOf(d)), true]], note: ap ? "ອະນຸມັດ: " + ap : "", signLabels: ["ຜູ້ຂໍ / ຄັງ", "ຜູ້ອະນຸມັດ"] });
  }

  window.StockDocUI = { list, form, detail };
})();
