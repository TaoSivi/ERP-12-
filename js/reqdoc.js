/* ============================================================
   LaoBooks ERP – Request document (the paper behind every ຂໍເບີກ)
   ------------------------------------------------------------
   One printable document per request, same layout for every type:
     letterhead · number/date/requester/payee · purpose · lines + total ·
     attached evidence · signature stamps per approval step · approval log · accounting entry.
   Built from the request + its history only (no extra state). Inline styles so the same HTML
   works on screen and in the print window.
   ============================================================ */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s));
  const M = v => UI.money(v);
  const TITLES = {
    ADV: ["ໃບຂໍເບີກເງິນແຮ", "CASH ADVANCE REQUEST"], CLR: ["ໃບເຄລຍເງິນແຮ", "ADVANCE SETTLEMENT"], PAY: ["ໃບຂໍເບີກຈ່າຍ", "PAYMENT REQUEST"],
    EXP: ["ໃບຂໍຈ່າຍຄ່າໃຊ້ຈ່າຍ", "PAYMENT VOUCHER"], PRJ: ["ໃບຂໍຈ່າຍຕົ້ນທຶນໂຄງການ", "PROJECT COST VOUCHER"], LSE: ["ໃບຂໍຈ່າຍງວດສິນເຊື່ອ / ເຊົ່າ", "INSTALMENT PAYMENT"],
    RCV: ["ໃບຮັບເງິນ", "RECEIPT VOUCHER"], FXX: ["ໃບແລກປ່ຽນເງິນຕາ", "FX EXCHANGE VOUCHER"], TRF: ["ໃບໂອນເງິນ", "TRANSFER VOUCHER"], FEE: ["ໃບຄ່າທຳນຽມທະນາຄານ", "BANK CHARGE VOUCHER"]
  };
  const ACT = { create: "ສ້າງ", submit: "ສົ່ງຂໍອະນຸມັດ", approve: "ອະນຸມັດ", reject: "ປະຕິເສດ", cancel: "ຍົກເລີກ", post: "ລົງບັນຊີອັດຕະໂນມັດ", pay: "ຈ່າຍເງິນ", refund: "ຮັບເງິນຄືນ", docs: "ແນບເອກະສານ" };
  const fmt = ts => ts ? String(ts).slice(0, 10).split("-").reverse().join("/") + " " + String(ts).slice(11, 16) : "";
  const day = ts => ts ? String(ts).slice(0, 10).split("-").reverse().join("/") : "";
  const C = { brand: "#0a9d99", line: "#d8dee4", soft: "#f8fafb", ink: "#0f172a", mute: "#64748b" };
  const th = (t, right) => `<th style="background:#f1f5f9;color:${C.mute};font-size:12px;text-align:${right ? "right" : "left"};padding:8px 10px;border-bottom:1px solid ${C.line}">${t}</th>`;
  const td = (t, right) => `<td style="padding:8px 10px;border-bottom:1px solid #eef1f4;text-align:${right ? "right" : "left"};vertical-align:top">${t}</td>`;

  function company() {
    const c = window.AppCtx && AppCtx.company ? AppCtx.company() : (Store.get("settings", "company") || {});
    return c;
  }
  function letterhead(r) {
    const c = company(), t = TITLES[r.type] || [Flows.TYPES[r.type].label, ""];
    const logo = c.logo ? `<img src="${c.logo}" style="height:52px;max-width:160px;object-fit:contain">` : `<div style="width:52px;height:52px;background:${C.brand};color:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700">${E((c.name || "L").slice(0, 1))}</div>`;
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:3px solid ${C.brand};padding-bottom:14px">
      <div style="display:flex;gap:12px;align-items:center">${logo}<div><div style="font-size:19px;font-weight:700">${E(c.name || "")}</div>
        <div style="font-size:12px;color:${C.mute}">${E(c.address || "")}${c.address ? "<br>" : ""}${c.tin ? "TIN: " + E(c.tin) : ""}</div></div></div>
      <div style="text-align:right"><div style="font-size:11px;letter-spacing:.06em;color:${C.mute}">${E(t[1])}</div>
        <div style="font-size:22px;font-weight:700;color:#0c7c79">${E(t[0])}</div><div style="font-size:15px;font-weight:700">${E(r.number)}</div></div></div>`;
  }
  function infoGrid(r) {
    const adv = r.advance_id ? Store.get("requests", r.advance_id) : null, proj = r.project_id ? Store.get("projects", r.project_id) : null;
    const rows = [["ເລກທີ", r.number], ["ວັນທີ", UI.fmtDate(r.date)], ["ຜູ້ຂໍ", r.requester_name ? r.requester_name + " (" + r.requester_role + ")" : r.requester_role], ["ພະແນກ", r.dept],
      ["ຈ່າຍໃຫ້ / ຜູ້ຮັບ", r.payee], ["ສະຖານະ", Flows.STAGE_LABEL[r.stage] || r.stage]];
    if (r.ccy && r.ccy !== "LAK") rows.push(["ສະກຸນ / ອັດຕາ", r.ccy + " @ " + Number(r.rate).toLocaleString("en-US")]);
    if (proj) rows.push(["ໂຄງການ", proj.name]);
    if (adv) rows.push(["ເຄລຍເງິນແຮ", adv.number]);
    if (r.type === "ADV" && r.due_clear) rows.push(["ກຳນົດເຄລຍ", UI.fmtDate(r.due_clear)]);
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 24px;margin:14px 0;font-size:14px">${rows.filter(x => x[1] !== "" && x[1] != null).map(x => `<div><span style="color:${C.mute}">${E(x[0])}:</span> <b>${E(x[1])}</b></div>`).join("")}</div>`;
  }
  function purposeBox(r) { return `<div style="background:${C.soft};border:1px solid #eef1f4;border-radius:8px;padding:10px 14px;font-size:14px"><span style="color:${C.mute}">ເຫດຜົນ / ຈຸດປະສົງ:</span> <b>${E(r.purpose)}</b></div>`; }

  // body table: [{cols, rows, total}] depending on what the request carries
  function body(r) {
    const foreign = r.ccy && r.ccy !== "LAK", total = Flows.amountOf(r);
    let cols, rows, rightFrom;
    if (r.vlines) {
      cols = ["#", "ບັນຊີ", "ລາຍລະອຽດ"].concat(foreign ? [r.ccy] : []).concat(["ກີບ (₭)"]);
      rows = r.vlines.map((l, i) => [i + 1, E(Acc.accName(l.account)), E(l.memo)].concat(foreign ? [Number(l.orig).toLocaleString("en-US")] : []).concat([M(l.amount)]));
    } else if (r.type === "CLR" || r.type === "PAY") {
      cols = ["#", "ໝວດ", "ລາຍລະອຽດ", "ເລກທີ່ບິນ", "VAT", "ຍອດຕາມບິນ (₭)"];
      rows = Flows.linesOf(r.id).map((l, i) => { const v = Flows.splitVat(l); return [i + 1, E(Acc.accName(l.account)), E(l.description), E(l.receipt_no), v.vat ? M(v.vat) : "-", M(v.gross)]; });
    } else if (r.type === "ADV") {
      cols = ["#", "ລາຍການ", "ຍອດ (₭)"]; rows = [[1, "ເງິນແຮ ໃຫ້ " + E(r.payee) + " — " + E(r.purpose), M(r.amount)]];
    } else {
      cols = ["#", "ລາຍການ", "ລາຍລະອຽດ"]; rows = Flows.summary(r).map((s, i) => [i + 1, E(s[0]), E(s[1])]); rightFrom = 99; // label / value rows, total below
    }
    if (rightFrom == null) rightFrom = cols.length - (foreign ? 2 : 1);
    return `<table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:14px"><thead><tr>${cols.map((c, i) => th(E(c), i >= rightFrom)).join("")}</tr></thead>
      <tbody>${rows.map(x => `<tr>${x.map((c, i) => td(c, i >= rightFrom)).join("")}</tr>`).join("")}</tbody></table>
      <div style="display:flex;justify-content:flex-end;margin-top:10px"><div style="min-width:260px;background:${C.soft};border:1px solid #eef1f4;border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;gap:20px;font-size:16px"><b>ລວມທັງໝົດ</b><b>${M(total)}</b></div></div>`;
  }
  function evidence(r) {
    const d = Flows.docsOf(r); if (!d.length) return "";
    return `<div style="margin-top:14px"><div style="font-weight:700;font-size:13px;margin-bottom:4px">ເອກະສານແນບ</div>
      ${d.map(x => `<div style="font-size:13px;color:${x.ok && x.ref ? C.ink : "#b91c1c"}">${x.ok && x.ref ? "☑" : "☐"} ${E(x.label)}${x.ref ? ` — <b>${E(x.ref)}</b>` : " — ຍັງບໍ່ມີ"}</div>`).join("")}</div>`;
  }
  const stamp = (label, who, when, state) => {
    const on = state === "done", cur = state === "cur";
    const col = on ? "#047857" : cur ? "#b45309" : "#94a3b8", bd = on ? "2px solid #10b981" : cur ? "2px dashed #f59e0b" : "1px dashed #cbd5e1";
    return `<div style="flex:1;min-width:150px;text-align:center"><div style="height:44px;display:flex;align-items:flex-end;justify-content:center"><span style="border:${bd};color:${col};border-radius:6px;padding:2px 10px;font-weight:700;font-size:13px;${on ? "transform:rotate(-3deg);" : ""}">${on ? "✓ " : ""}${E(label)}</span></div>
      <div style="border-top:1px solid ${C.ink};margin-top:6px;padding-top:4px;font-weight:700;font-size:13px">${E(who)}</div><div style="font-size:12px;color:${C.mute}">${E(when || (cur ? "ລໍອະນຸມັດ" : ""))}</div></div>`;
  };
  function stamps(r) {
    const h = Flows.history(r.id), first = a => h.find(x => x.action === a), blocks = [];
    const sub = first("submit");
    blocks.push(stamp("ສົ່ງຂໍ", r.requester_name ? r.requester_name + " (" + r.requester_role + ")" : r.requester_role, sub ? day(sub.ts) : "", sub ? "done" : "cur"));
    const st = r.chain && r.chain.length ? Approval.chainState(r, r.type, Flows.amountOf(r)) : null;
    if (st) {
      st.steps.forEach((s, i) => {
        const sig = st.done.filter(d => d.step === i);
        sig.forEach(d => blocks.push(stamp("ອະນຸມັດ ຂັ້ນ " + (i + 1), d.name ? d.name + " (" + d.role + ")" : d.role, day(d.at), "done")));
        const left = s.need - sig.length;
        if (left > 0) blocks.push(stamp("ອະນຸມັດ ຂັ້ນ " + (i + 1), Approval.stepLabel(st.chain[i]) + (left > 1 || sig.length ? " (ອີກ " + left + " ຄົນ)" : ""), "", r.stage === "approval" && i === st.step ? "cur" : "wait"));
      });
    }
    const pay = first("pay") || h.find(x => x.action === "post");
    if (r.type === "ADV" || pay) blocks.push(stamp(r.type === "ADV" ? "ຈ່າຍເງິນ" : "ລົງບັນຊີ", pay ? pay.role : "Cashier", pay ? day(pay.ts) : "", pay ? "done" : (r.stage === "payout" ? "cur" : "wait")));
    return `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:26px">${blocks.join("")}</div>`;
  }
  function log(r) {
    const h = Flows.history(r.id).filter(x => x.action !== "docs");
    if (!h.length) return "";
    return `<div style="margin-top:20px"><div style="font-weight:700;font-size:13px;margin-bottom:4px">ລຳດັບຂັ້ນຕອນ</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>${th("#")}${th("ຜູ້ດຳເນີນການ (ບົດບາດ)")}${th("ການກະທຳ")}${th("ວັນທີ / ເວລາ")}${th("ໝາຍເຫດ")}</tr></thead>
      <tbody>${h.map((x, i) => `<tr>${td(i + 1)}${td(E(x.name ? x.name + " (" + x.role + ")" : x.role))}${td(E(ACT[x.action] || x.action))}${td(fmt(x.ts))}${td(E(x.note || ""))}</tr>`).join("")}</tbody></table></div>`;
  }
  function entry(r) {
    const jes = Store.where("journal_entries", j => j.source_id === r.id && j.status !== "void");
    if (!jes.length) return r.bill_id ? `<div style="margin-top:16px;font-size:13px">ລົງບັນຊີຜ່ານ Bill: <b>${E((Store.get("bills", r.bill_id) || {}).number || "")}</b></div>` : "";
    return `<div style="margin-top:20px"><div style="font-weight:700;font-size:13px;margin-bottom:4px">ການລົງບັນຊີ</div>${jes.map(j => `
      <div style="font-size:12px;color:${C.mute};margin:6px 0 2px">${E(j.number)} · ${UI.fmtDate(j.date)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>${th("ບັນຊີ")}${th("Dr", 1)}${th("Cr", 1)}</tr></thead><tbody>${Store.where("journal_lines", l => l.je_id === j.id).map(l => `<tr>${td(E(l.account_name || l.account))}${td(l.debit ? M(l.debit) : "", 1)}${td(l.credit ? M(l.credit) : "", 1)}</tr>`).join("")}</tbody></table>`).join("")}</div>`;
  }

  function html(r) { return `<div style="color:${C.ink}">${letterhead(r)}${infoGrid(r)}${purposeBox(r)}${body(r)}${evidence(r)}${stamps(r)}${log(r)}${entry(r)}</div>`; }
  function print(r) { if (window.AppCtx && AppCtx.printHTML) AppCtx.printHTML(r.number + " " + (TITLES[r.type] || [""])[0], html(r)); }

  window.ReqDoc = { html, print, TITLES };
})();
