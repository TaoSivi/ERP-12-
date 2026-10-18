/* ============================================================
   LaoBooks ERP – Financial statements screen (ງົບການເງິນ)
   Four statements in the layout of a reviewed interim/annual set; pick the year, the number of months
   (3/6/9/12) and optionally a comparative year. Logic lives in fs.js.
   ============================================================ */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s));
  const view = () => document.getElementById("view");
  const st = { year: null, cmp: "prev", months: 12, tab: "bs" };
  const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const num = v => { if (!v || Math.abs(v) < 0.5) return "-"; const s = Math.round(Math.abs(v)).toLocaleString("en-US"); return v < 0 ? "(" + s + ")" : s; };
  const dlabel = iso => { const d = iso.split("-"); return Number(d[2]) + " " + MON[Number(d[1]) - 1] + " " + d[0]; };
  const plabel = (p, months) => (months === 12 ? "Year" : months === 6 ? "Six-month period" : months === 3 ? "Three-month period" : "Nine-month period") + " ended " + dlabel(p.to);

  function cols() {
    const y = st.year, list = [{ y, p: FS.period(y, st.months) }];
    if (st.cmp !== "none") { const cy = st.cmp === "prev" ? y - 1 : Number(st.cmp); list.push({ y: cy, p: FS.period(cy, st.months) }); }
    return list;
  }

  function table(head, rows, ncol) {
    return `<div class="tbl-wrap"><table class="data fs-t"><thead><tr><th>${head[0]}</th>${head.slice(1).map(h => `<th class="num">${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => {
      if (r.h) return `<tr class="fs-h${r.h === 2 ? "2" : ""}"><td colspan="${ncol + 1}">${E(r.label)}</td></tr>`;
      return `<tr class="${r.total ? "fs-tot" : ""}"><td>${E(r.label)}</td>${r.v.map(x => `<td class="num">${num(x)}</td>`).join("")}</tr>`;
    }).join("")}</tbody></table></div>`;
  }
  function lineRows(defs, vals) {
    return defs.map(([k, label]) => k === "h" ? { h: 1, label } : k === "h2" ? { h: 2, label } : { label, total: k.indexOf("t:") === 0, v: vals.map(v => v[k]) });
  }

  function bsHTML(cs) {
    const vals = cs.map(c => FS.bs(c.p.to)), bad = vals.findIndex(v => !v.balanced);
    return table(["Consolidated statement of financial position"].concat(cs.map(c => dlabel(c.p.to) + "<br><small>LAK</small>")), lineRows(FS.BS_LINES, vals), cs.length) +
      (bad >= 0 ? `<p class="hint mt-2" style="color:#b91c1c">⚠ ໃບດຸ່ນດ່ຽງບໍ່ສົມດຸນ ທີ່ ${dlabel(cs[bad].p.to)} — ກວດ Journal</p>` : "");
  }
  function isHTML(cs) {
    const vals = cs.map(c => FS.is(c.p.from, c.p.to));
    return table(["Statement of income"].concat(cs.map(c => plabel(c.p, st.months) + "<br><small>LAK</small>")), lineRows(FS.IS_LINES, vals), cs.length);
  }
  function eqHTML(cs) {
    const K = [["capital", "Issued and paid-up share capital"], ["premium", "Share premium"], ["legal", "Legal reserve"], ["retained", "Unappropriated"], ["total", "Total"]];
    return cs.map(c => {
      const e = FS.eq(c.p.from, c.p.to, c.p.before), row = (label, o, tot) => ({ label, total: tot, v: K.map(k => o[k[0]]) });
      return table(["Statement of changes in equity – " + plabel(c.p, st.months)].concat(K.map(k => k[1] + "<br><small>LAK</small>")), [
        row("Opening balance at " + dlabel(c.p.from), e.opening), row("Profit/(loss) for the period", e.profit),
        ...(e.other.total ? [row("Other movements (capital, dividends, adjustments)", e.other)] : []), row("Closing balance at " + dlabel(c.p.to), e.closing, true)], K.length) + '<div class="h-4"></div>';
    }).join("");
  }
  const CF = [["h", "Cash flows from operating activities"], ["pbt", "Profit/(loss) before income tax"], ["h2", "Adjustments for:"], ["dep", "Depreciation and amortisation"], ["interest", "Interest expenses"],
    ["h2", "Changes in working capital:"], ["recv", "Trade and other receivables, net"], ["inv", "Inventories, net"], ["oca", "Other current assets"], ["pay", "Trade and other payables"], ["ocl", "Other current liabilities"],
    ["t:cashops", "Cash generated from/(used in) operations"], ["intPaid", "Interest paid"], ["taxPaid", "Income tax paid"], ["t:ops", "Net cash from/(used in) operating activities"],
    ["h", "Cash flows from investing activities"], ["capex", "Purchases of property, plant and equipment (net of disposals)"], ["onca", "Other non-current assets"], ["t:inv", "Net cash used in investing activities"],
    ["h", "Cash flows from financing activities"], ["borrow", "Net borrowings / (repayments)"], ["shareCap", "Proceeds from share capital and premium"], ["otherEq", "Dividends and other equity movements"], ["t:fin", "Net cash from/(used in) financing activities"],
    ["t:net", "Net increase/(decrease) in cash and cash equivalents"], ["open", "Cash and cash equivalents at the beginning of the period"], ["t:close", "Cash and cash equivalents at the end of the period"]];
  function cfHTML(cs) {
    const vals = cs.map(c => { const v = FS.cf(c.p.from, c.p.to, c.p.before); v["t:net"] = v.net; v["t:close"] = v.close; return v; });
    return table(["Statement of cash flows"].concat(cs.map(c => plabel(c.p, st.months) + "<br><small>LAK</small>")), lineRows(CF, vals), cs.length) +
      (vals.every(v => v.ties) ? "" : '<p class="hint mt-2" style="color:#b91c1c">⚠ ກະແສເງິນສົດບໍ່ກົງກັບເງິນສົດໃນໃບດຸ່ນດ່ຽງ</p>') +
      '<p class="hint mt-2">ວິທີ Indirect ຄິດຈາກການປ່ຽນແປງຂອງໃບດຸ່ນດ່ຽງ — ກຳໄລ/ຂາດທຶນອັດຕາແລກປ່ຽນຢູ່ໃນລາຍການເຄື່ອນໄຫວ (ບໍ່ແຍກອອກ). ຄ່າເສື່ອມ ອ່ານຈາກບັນຊີ 5400 ຫຼື ຊື່ບັນຊີທີ່ມີ "ເສື່ອມ".</p>';
  }

  const TABS = [["bs", "Financial position", bsHTML], ["is", "Income", isHTML], ["eq", "Changes in equity", eqHTML], ["cf", "Cash flows", cfHTML]];

  function page() {
    const ys = FS.years(); if (!st.year) st.year = ys[0];
    const cs = cols(), co = Object.assign({}, window.AppCtx.company()), sg = Store.get("settings", "fs") || {};
    const cur = TABS.find(t => t[0] === st.tab) || TABS[0];
    view().innerHTML = UI.pageHead("ງົບການເງິນ", "Financial statements · ທຽບປີ/ງວດ", `<button class="btn btn-primary" id="fs-print">ພິມທັງ 4 ງົບ</button><button class="btn btn-ghost" id="fs-map">ຈັບຄູ່ບັນຊີ → ແຖວງົບ</button>`) +
      `<div class="card p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div><label class="field">ປີ</label><select class="input" id="fs-y">${ys.map(y => `<option ${y === st.year ? "selected" : ""}>${y}</option>`).join("")}</select></div>
        <div><label class="field">ງວດ (ເດືອນນັບແຕ່ຕົ້ນປີ)</label><select class="input" id="fs-m">${[[3, "3 ເດືອນ"], [6, "6 ເດືອນ"], [9, "9 ເດືອນ"], [12, "ເຕັມປີ"]].map(m => `<option value="${m[0]}" ${m[0] === st.months ? "selected" : ""}>${m[1]}</option>`).join("")}</select></div>
        <div><label class="field">ທຽບກັບ</label><select class="input" id="fs-c"><option value="prev" ${st.cmp === "prev" ? "selected" : ""}>ປີກ່ອນ (${st.year - 1})</option><option value="none" ${st.cmp === "none" ? "selected" : ""}>ບໍ່ທຽບ</option>${ys.filter(y => y !== st.year && y !== st.year - 1).map(y => `<option ${String(y) === st.cmp ? "selected" : ""}>${y}</option>`).join("")}</select></div>
        <div><label class="field">ຜູ້ເຊັນ 1 (ຊື່ + ຕຳແໜ່ງ)</label><input class="input" id="fs-s1" value="${E(sg.sign1 || "")}"></div>
        <div><label class="field">ຜູ້ເຊັນ 2 (ຊື່ + ຕຳແໜ່ງ)</label><input class="input" id="fs-s2" value="${E(sg.sign2 || "")}"></div></div>
      <div class="flex flex-wrap gap-2 mb-4">${TABS.map(t => `<button class="btn ${t[0] === st.tab ? "btn-primary" : "btn-ghost"} btn-sm" data-tab="${t[0]}">${t[1]}</button>`).join("")}</div>
      <div class="card p-4" id="fs-body">${cur[2](cs)}</div>`;
    const q = s => view().querySelector(s);
    q("#fs-y").onchange = e => { st.year = Number(e.target.value); if (st.cmp !== "prev" && st.cmp !== "none" && Number(st.cmp) === st.year) st.cmp = "prev"; page(); };
    q("#fs-m").onchange = e => { st.months = Number(e.target.value); page(); };
    q("#fs-c").onchange = e => { st.cmp = e.target.value; page(); };
    const saveSign = () => { const d = { sign1: q("#fs-s1").value, sign2: q("#fs-s2").value }; if (Store.get("settings", "fs")) Store.update("settings", "fs", d); else Store.insert("settings", Object.assign({ id: "fs" }, d)); };
    q("#fs-s1").onchange = saveSign; q("#fs-s2").onchange = saveSign;
    view().querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { st.tab = b.dataset.tab; page(); });
    q("#fs-map").onclick = mapModal;
    q("#fs-print").onclick = () => {
      saveSign();
      const sig = `<table style="margin-top:36px"><tr><td style="border:none;width:50%">${E(q("#fs-s1").value)}<br>Date: ........</td><td style="border:none">${E(q("#fs-s2").value)}<br>Date: ........</td></tr></table>`;
      const pages = TABS.map(t => `<div style="page-break-after:always"><h2>${E(co.name || "")}</h2>${t[2](cs)}${sig}</div>`).join("");
      window.AppCtx.printHTML("Financial statements " + st.year, pages);
    };
  }

  function mapModal() {
    const m = {}; Store.all("journal_lines").forEach(l => { m[l.account] = 1; });
    const accts = Store.all("accounts").filter(a => !a.is_header && m[a.code]).sort((a, b) => String(a.code).localeCompare(String(b.code))), map = (Store.get("settings", "fs") || {}).map || {};
    UI.modal("ຈັບຄູ່ບັນຊີ → ແຖວງົບ", `<p class="hint mb-2">ລະບົບຈັດໃຫ້ອັດຕະໂນມັດຕາມເລກບັນຊີ; ປ່ຽນໄດ້ຖ້າບໍ່ຖືກ. ສະແດງສະເພາະບັນຊີທີ່ມີການເຄື່ອນໄຫວ.</p><div class="tbl-wrap"><table class="data"><thead><tr><th>ບັນຊີ</th><th>ແຖວໃນງົບ</th></tr></thead><tbody>${accts.map(a => {
      const cur = map[a.code] || "";
      return `<tr><td>${E(a.code + " " + a.name)}</td><td><select class="input" data-code="${E(a.code)}"><option value="">auto (${E(FS.LABEL[FS.classify(a, true)] || "")})</option>${FS.MAPPABLE.map(k => `<option value="${k}" ${cur === k ? "selected" : ""}>${E(FS.LABEL[k])}</option>`).join("")}</select></td></tr>`;
    }).join("")}</tbody></table></div>`, { wide: true });
    document.querySelectorAll("select[data-code]").forEach(s => s.onchange = () => { FS.setMap(s.dataset.code, s.value); page(); });
  }

  window.FSUI = { page };
})();
