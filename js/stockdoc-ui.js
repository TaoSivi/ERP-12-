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
    const items = stockItems(), exp = Store.where("accounts", a => a.type === "Expense" && !a.is_header);
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

  function detail(id) {
    const d = StockDoc.get(id), me = role(), chk = d.status === "approval" ? StockDoc.check(d, me) : null;
    const steps = (d.status === "approval" || d.status === "posted") && d.chain ? Approval.chainState(d, "STOCK", d.value) : null;
    const colHead = d.type === "ISS" ? "ຈ່າຍ" : d.type === "ADJ" ? "ປັບ" : "ນັບໄດ້ (ລະບົບ)";
    UI.modal(d.number + " · " + StockDoc.LABEL[d.type], `<div class="hint mb-2">${E(d.date)} · ${E(d.reason)}${d.dept ? " · " + E(d.dept) : ""} · ຜູ້ຂໍ ${E(d.requester_name || d.requester_role)} · <span class="chip ${CHIP[d.status]}">${E(StockDoc.STAGE[d.status])}</span></div>
      <table class="data mb-3"><thead><tr><th>ສິນຄ້າ</th><th class="num">${colHead}</th></tr></thead><tbody>${d.lines.map(l => `<tr><td>${E(itemName(l.item_id))}</td><td class="num">${d.type === "ISS" ? l.qty : d.type === "ADJ" ? (l.delta > 0 ? "+" : "") + l.delta : l.counted + " (" + l.system + ")"}</td></tr>`).join("")}</tbody></table>
      <p class="mb-2">ມູນຄ່າ: <b>${M(StockDoc.valueOf(d))}</b></p>
      ${steps ? `<div class="hint mb-2">ຂັ້ນອະນຸມັດ: ${Approval.chainLabels(steps.chain).map((l, i) => (i < steps.step ? "✓ " : i === steps.step ? "▶ " : "") + E(l)).join(" → ")}</div>` : ""}
      ${chk && !chk.ok ? `<p class="hint mb-2">${E(chk.why)}</p>` : ""}
      <div class="flex flex-wrap gap-2 mt-3">
        ${d.status === "draft" ? '<button class="btn btn-primary" id="sd-submit">ສົ່ງອະນຸມັດ</button>' : ""}
        ${chk && chk.ok ? '<button class="btn btn-ok" id="sd-ok">✓ ອະນຸມັດ</button><button class="btn btn-danger" id="sd-no">✕ ປະຕິເສດ</button>' : ""}
        ${d.status === "draft" || d.status === "approval" ? '<button class="btn btn-ghost" id="sd-cancel">ຍົກເລີກ</button>' : ""}
        <button class="btn btn-ghost" id="sd-print">ພິມ</button><button class="btn btn-ghost" id="sd-back">ກັບລາຍການ</button></div>`, { wide: true });
    const on = (s, f) => { const b = document.getElementById(s); if (b) b.onclick = f; };
    const again = () => detail(id);
    on("sd-submit", () => act(() => StockDoc.submit(id, me), "ສົ່ງອະນຸມັດແລ້ວ", again));
    on("sd-ok", () => act(() => StockDoc.approve(id, me), "ອະນຸມັດແລ້ວ", again));
    on("sd-no", () => { const n = prompt("ເຫດຜົນທີ່ປະຕິເສດ"); if (n != null) act(() => StockDoc.reject(id, me, n), "ປະຕິເສດແລ້ວ", again); });
    on("sd-cancel", () => UI.confirmDialog("ຍົກເລີກ " + d.number + "?", () => act(() => StockDoc.cancel(id, me, ""), "ຍົກເລີກແລ້ວ", again)));
    on("sd-print", () => print(StockDoc.get(id))); on("sd-back", list);
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
