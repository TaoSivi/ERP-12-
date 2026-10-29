/* ============================================================
   LaoBooks ERP – Document page (same layout as the ST POS purchase document)
   top: status stepper · left: the paper (letterhead, meta, lines, totals, journal, signature stamps, approval log)
   · right: status, what you can do now, who approves each step.
   DocView.paper(model) is print-safe inline HTML; DocView.page(model) adds the on-screen chrome.
   model = { titles:[lao,eng], number, date, status:{label,tone}, stepper:[{label,state}], meta:[[k,v]], cols, rows, totals:[[l,v,bold]], note,
             journal:[{memo,lines:[{account,name,debit,credit}]}], journalTitle, steps:[{label,need,signed:[{name,role,at}],state}],
             requester:{name,role,at}, log:[{at,by,role,action,note}], notice, actions, back }
   ============================================================ */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s)), M = v => UI.money(v);
  const C = { brand: "#0A7E7A", line: "#d9ebea", soft: "#f2f9f8", ink: "#062f2d", mute: "#4d7471" };
  const day = ts => ts ? String(ts).slice(0, 10).split("-").reverse().join("/") : "";
  const fmt = ts => ts ? day(ts) + " " + String(ts).slice(11, 16) : "";
  const ACT = { create: "ສ້າງ", submit: "ສົ່ງຂໍອະນຸມັດ", approve: "ອະນຸມັດ", reject: "ປະຕິເສດ", cancel: "ຍົກເລີກ", post: "ລົງບັນຊີອັດຕະໂນມັດ", failed: "ລົງບັນຊີບໍ່ໄດ້" };
  const th = (t, r) => `<th style="background:${C.soft};color:${C.mute};font-size:12px;text-align:${r ? "right" : "left"};padding:9px 10px;border-bottom:1px solid ${C.line}">${t}</th>`;
  const td = (t, r) => `<td style="padding:9px 10px;border-bottom:1px solid #eef5f4;text-align:${r ? "right" : "left"};vertical-align:top">${t}</td>`;
  const company = () => (window.AppCtx && AppCtx.company ? AppCtx.company() : (Store.get("settings", "company") || {}));

  function letterhead(m) {
    const c = company(), ini = String(c.name || "ST").trim().slice(0, 2).toUpperCase();
    const logo = c.logo ? `<img src="${c.logo}" style="height:52px;max-width:160px;object-fit:contain">` : `<div style="width:54px;height:54px;background:${C.ink};color:#7ff0e9;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800">${E(ini)}</div>`;
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:3px solid ${C.brand};padding-bottom:14px">
      <div style="display:flex;gap:12px;align-items:center">${logo}<div><div style="font-size:19px;font-weight:800">${E(c.name || "")}</div><div style="font-size:12px;color:${C.mute}">${E(c.address || "")}${c.address && c.tin ? " · " : ""}${c.tin ? "TIN: " + E(c.tin) : ""}</div></div></div>
      <div style="text-align:right"><div style="font-size:11px;letter-spacing:.06em;color:${C.mute}">${E(m.titles[1] || "")}</div><div style="font-size:23px;font-weight:800;color:${C.brand}">${E(m.titles[0])}</div><div style="font-size:15px;font-weight:700">${E(m.number)}</div></div></div>`;
  }
  const metaGrid = m => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 24px;margin:14px 0;font-size:14px">${[["ເລກທີ", m.number], ["ວັນທີ", UI.fmtDate(m.date)]].concat(m.meta || []).filter(x => x[1] !== "" && x[1] != null).map(x => `<div><span style="color:${C.mute}">${E(x[0])}:</span> <b>${E(x[1])}</b></div>`).join("")}</div>`;
  function lines(m) {
    if (!m.cols) return "";
    return `<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:14px"><thead><tr>${th("#")}${m.cols.map((c, i) => th(E(c), i > 0 && i === m.cols.length - 1 || (i > 0 && /ຈຳນວນ|ຍອດ|ລາຄາ|ລວມ|ຕົ້ນທຶນ|ຄ່າເສື່ອມ|Dr|Cr/.test(c)))).join("")}</tr></thead>
      <tbody>${(m.rows || []).map((r, i) => `<tr>${td(i + 1)}${r.map((c, j) => td(E(c), j > 0 && (j === r.length - 1 || /ຈຳນວນ|ຍອດ|ລາຄາ|ລວມ|ຕົ້ນທຶນ|ຄ່າເສື່ອມ/.test(m.cols[j] || "")))).join("")}</tr>`).join("") || `<tr>${td("", 0)}${td("ບໍ່ມີລາຍການ", 0)}</tr>`}</tbody></table>
      ${(m.totals || []).length ? `<div style="display:flex;justify-content:flex-end;margin-top:10px"><div style="min-width:280px;background:${C.soft};border-radius:14px;padding:10px 16px;font-size:15px">${m.totals.map(t => `<div style="display:flex;justify-content:space-between;gap:24px;${t[2] ? "font-weight:800;font-size:17px;" : "color:" + C.mute + ";"}padding:2px 0"><span>${E(t[0])}</span><span>${E(t[1])}</span></div>`).join("")}</div></div>` : ""}`;
  }
  function journal(m) {
    if (!m.journal || !m.journal.length) return "";
    return `<div style="margin-top:20px"><div style="font-weight:800;font-size:13px;margin-bottom:4px">${E(m.journalTitle || "ການລົງບັນຊີ")}</div>${m.journal.map(j => `<div style="font-size:12px;color:${C.mute};margin:6px 0 2px">${E(j.memo || "")}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>${th("ບັນຊີ")}${th("Dr", 1)}${th("Cr", 1)}</tr></thead><tbody>${j.lines.map(l => `<tr>${td(E(String(l.name || l.account)))}${td(l.debit ? M(l.debit) : "", 1)}${td(l.credit ? M(l.credit) : "", 1)}</tr>`).join("")}</tbody></table>`).join("")}</div>`;
  }
  const stamp = (label, who, when, state) => {
    const on = state === "done", cur = state === "cur", bad = state === "bad";
    const col = on ? "#11743a" : bad ? "#b4371f" : cur ? "#8a5a00" : "#94a3b8", bd = on ? "2px solid #16a34a" : bad ? "2px solid #ef4444" : cur ? "2px dashed #f4b740" : "1px dashed #cbd5e1";
    return `<div style="flex:1;min-width:150px;text-align:center"><div style="height:44px;display:flex;align-items:flex-end;justify-content:center"><span style="border:${bd};color:${col};border-radius:10px;padding:2px 12px;font-weight:800;font-size:13px">${on ? "✓ " : bad ? "✕ " : ""}${E(label)}</span></div>
      <div style="border-top:1px solid ${C.ink};margin-top:6px;padding-top:4px;font-weight:700;font-size:13px">${E(who)}</div><div style="font-size:12px;color:${C.mute}">${E(when || (cur ? "ລໍອະນຸມັດ" : ""))}</div></div>`;
  };
  function stamps(m) {
    const b = [];
    if (m.requester) b.push(stamp("ສົ່ງຂໍ", (m.requester.name || m.requester.role) + (m.requester.name && m.requester.role ? " (" + m.requester.role + ")" : ""), day(m.requester.at), "done"));
    (m.steps || []).forEach((s, i) => {
      s.signed.forEach(d => b.push(stamp("ອະນຸມັດ ຂັ້ນ " + (i + 1), (d.name || d.role) + (d.name ? " (" + d.role + ")" : ""), day(d.at), "done")));
      const left = s.need - s.signed.length;
      if (left > 0) b.push(stamp("ອະນຸມັດ ຂັ້ນ " + (i + 1), s.label + (s.signed.length ? " (ອີກ " + left + " ຄົນ)" : ""), "", s.state === "bad" ? "bad" : s.state === "cur" ? "cur" : "wait"));
    });
    return b.length ? `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:26px">${b.join("")}</div>` : "";
  }
  function logTable(m) {
    if (!m.log || !m.log.length) return "";
    return `<div style="margin-top:22px"><div style="font-weight:800;font-size:13px;margin-bottom:4px">ລຳດັບຂັ້ນຕອນ</div><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>${th("#")}${th("ຜູ້ດຳເນີນການ")}${th("ການກະທຳ")}${th("ວັນທີ / ເວລາ")}${th("ໝາຍເຫດ")}</tr></thead>
      <tbody>${m.log.map((x, i) => `<tr>${td(i + 1)}${td(E((x.by || "") + (x.role ? " (" + x.role + ")" : "")))}${td(E(ACT[x.action] || x.action))}${td(fmt(x.at))}${td(E(x.note || ""))}</tr>`).join("")}</tbody></table></div>`;
  }
  const paper = m => `<div style="color:${C.ink}">${letterhead(m)}${metaGrid(m)}${m.note ? `<div style="background:${C.soft};border-radius:14px;padding:10px 14px;font-size:14px;margin-bottom:8px"><span style="color:${C.mute}">ໝາຍເຫດ:</span> <b>${E(m.note)}</b></div>` : ""}${lines(m)}${journal(m)}${stamps(m)}${logTable(m)}</div>`;

  const stepper = m => !m.stepper ? "" : `<div class="dv-stepper">${m.stepper.map((s, i) => `<div class="dv-st ${s.state}"><span class="dv-dot">${s.state === "done" ? "✓" : s.state === "bad" ? "✕" : i + 1}</span><span class="dv-lb">${E(s.label)}</span></div>`).join("")}</div>`;
  const side = m => `<div class="dv-side">
    <div class="dv-card"><div class="dv-h">ສະຖານະ</div><span class="chip ${({ ok: "s-done", wait: "s-wait", bad: "s-bad", draft: "s-draft" })[m.status.tone] || "s-draft"}">${E(m.status.label)}</span>
      ${m.notice ? `<div class="dv-notice">${m.notice}</div>` : ""}</div>
    <div class="dv-card"><div class="dv-h">ດຳເນີນການ</div><div class="dv-actions">${m.actions || ""}</div></div>
    ${(m.steps || []).length ? `<div class="dv-card"><div class="dv-h">ຜູ້ອະນຸມັດແຕ່ລະຂັ້ນ</div>${m.steps.map((s, i) => `<div class="dv-step ${s.state}"><span class="dv-n">${i + 1}</span><div><b>${E(s.label)}${s.need > 1 ? " ×" + s.need : ""}</b>
      <div class="hint">${s.signed.length ? s.signed.map(d => "✓ " + E(d.name || d.role) + " " + day(d.at)).join("<br>") : s.state === "cur" ? "⏳ ກຳລັງລໍ" : "ລໍຄິວ"}</div></div></div>`).join("")}<div class="hint mt-2">ຕັ້ງຄົນອະນຸມັດ: ຕັ້ງຄ່າ › ຂັ້ນອະນຸມັດ</div></div>` : ""}</div>`;

  function page(m) { return `<div class="dv-top">${m.back ? `<button class="btn btn-ghost" id="dv-back">← ${E(m.back)}</button>` : ""}${stepper(m)}</div>
    <div class="dv-grid"><div class="dv-paper" id="dv-paper">${paper(m)}</div>${side(m)}</div>`; }
  function open(m, onMount) {
    UI.modal(m.titles[0] + " · " + m.number, page(m), { wide: true, onMount: (bd, close) => { const b = bd.querySelector("#dv-back"); if (b && m.onBack) b.onclick = () => { close(); m.onBack(); }; if (onMount) onMount(bd, close); } });
  }
  function print(m) { if (window.AppCtx && AppCtx.printHTML) AppCtx.printHTML(m.number + " " + m.titles[0], paper(m)); }

  window.DocView = { paper, page, open, print };
})();
