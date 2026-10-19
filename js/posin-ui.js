/* ============================================================
   LaoBooks ERP – POS inbox screen (ຮັບຈາກ POS)
   One page: connection status, days that need a person, every day pulled from POS, reconciliation.
   Logic lives in posin.js.
   ============================================================ */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s)), M = v => UI.money(v);
  const view = () => document.getElementById("view");
  const can = () => window.AppCtx.canDo("post", "posin") || ["Admin", "Manager", "Accountant"].indexOf(window.AppCtx.currentRole()) !== -1;
  const STATUS = { posted: ["s-done", "ລົງບັນຊີແລ້ວ"], held: ["s-wait", "ລໍກວດ"], blocked: ["s-bad", "ຕິດຂັດ"], skipped: ["s-draft", "ຂ້າມ"], new: ["s-run", "ໃໝ່"] };
  const chip = r => { const s = STATUS[r.status] || STATUS.new; return `<span class="chip ${s[0]}">${s[1]}${r.status === "posted" && r.auto ? " · ອັດຕະໂນມັດ" : ""}${r.open ? " · ມື້ນີ້ (ກຳລັງຂາຍ)" : ""}${r.changed ? " · POS ແກ້ໄຂ" : ""}${(r.adj_ids || []).length ? " · ປັບ " + r.adj_ids.length : ""}</span>`; };
  const collected = d => Object.keys(d.pay || {}).reduce((s, k) => s + d.pay[k], 0);
  const act = (fn, ok) => { try { const r = fn(); if (ok) UI.toast(ok, "ok"); render(); return r; } catch (e) { UI.toast(e.message, "err"); } };

  function render() {
    const lk = Posin.link(), recs = Posin.recs().sort((a, b) => b.date.localeCompare(a.date) || a.branch.localeCompare(b.branch));
    const need = recs.filter(r => r.status === "held" || r.status === "blocked"), posted = recs.filter(r => r.status === "posted");
    const month = new Date().toISOString().slice(0, 7), lastRes = lk.last_result;
    view().innerHTML = UI.pageHead("ຮັບຈາກ POS", "ST POS → ERP · ລົງບັນຊີຂາຍປະຈຳວັນອັດຕະໂນມັດ",
        `<button class="btn btn-ghost" id="pi-map">ຕັ້ງບັນຊີ</button><button class="btn btn-ghost" id="pi-set">ຕັ້ງການເຊື່ອມຕໍ່</button><button class="btn btn-primary btn-lg" id="pi-pull" ${lk.url && lk.token ? "" : "disabled"}>⟳ ດຶງຈາກ POS ດຽວນີ້</button>`) +
      (!lk.url || !lk.token ? `<div class="next-box mb-5"><div class="nb-kicker">ເລີ່ມຕົ້ນ</div><div class="nb-title">ເຊື່ອມ ERP ກັບ ST POS</div><p class="text-sm text-slate-600">ໃສ່ URL ຂອງ POS (ເຊັ່ນ https://stpos.store/api/b1) ແລະ ລະຫັດອ່ານບັນຊີ (ACCT_TOKEN). ຫຼັງຈາກນັ້ນ ທຸກຄັ້ງທີ່ເປີດ ERP ມັນຈະດຶງຍອດມື້ທີ່ປິດແລ້ວ ແລະ ລົງບັນຊີເອງ.</p><button class="btn btn-primary btn-lg mt-3" id="pi-set2">ຕັ້ງການເຊື່ອມຕໍ່</button></div>` : "") +
      `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">${UI.kpi("ລົງບັນຊີແລ້ວ", posted.length + " ມື້", M(posted.reduce((s, r) => s + r.day.sales, 0)) + " (ລາຍຮັບສຸດທິ)", "#0f172a")}
        ${UI.kpi("ລໍກວດ", String(recs.filter(r => r.status === "held").length), "ມີເລື່ອງຜິດປົກກະຕິ", recs.some(r => r.status === "held") ? "#b45309" : "#15803d")}
        ${UI.kpi("ຕິດຂັດ", String(recs.filter(r => r.status === "blocked").length), "ລົງບັນຊີບໍ່ໄດ້", recs.some(r => r.status === "blocked") ? "#b91c1c" : "#15803d")}
        ${UI.kpi("ດຶງຄັ້ງລ່າສຸດ", lk.last_pull || "-", lastRes ? lastRes.posted + " ລົງ · " + lastRes.held + " ລໍກວດ · " + lastRes.blocked + " ຕິດ" : "")}</div>` +
      `<div class="section-title">ຕ້ອງການຄົນກວດ <span class="count ${need.length ? "" : "zero"}">${need.length}</span></div>` +
      (need.length ? `<div class="ac-list cols mb-6">${need.map(r => `<div class="ac-card ${r.status === "blocked" ? "danger" : "warn"}" style="align-items:flex-start"><div class="ac-ic">${Icons.svg(r.status === "blocked" ? "alert" : "clipboard", 20)}</div>
        <div class="ac-body"><div class="ac-title">${E(r.date)} · ${E(r.branch_name)} · ${M(r.day.sales)}</div>${r.issues.filter(i => i.level !== "info").map(i => `<div class="ac-meta">${E(i.msg)}</div>`).join("")}
        <div class="flex flex-wrap gap-2 mt-2"><button class="btn btn-ghost btn-sm" data-pv="${E(r.id)}">ເບິ່ງ</button>${r.status === "held" && can() ? `<button class="btn btn-primary btn-sm" data-ok="${E(r.id)}">ອະນຸມັດ & ລົງບັນຊີ</button>` : ""}${can() ? `<button class="btn btn-ghost btn-sm" data-sk="${E(r.id)}">ຂ້າມ</button>` : ""}</div></div></div>`).join("")}</div>` : `<div class="ac-empty mb-6">ບໍ່ມີມື້ໃດຄ້າງ — ທຸກມື້ທີ່ດຶງມາລົງບັນຊີແລ້ວ</div>`) +
      `<div class="section-title">ທຸກມື້ທີ່ດຶງມາ</div>` +
      (recs.length ? UI.table([
        { h: "ວັນທີ", render: r => `<b>${E(r.date)}</b><div class="hint">${E(r.branch_name)}</div>` },
        { h: "ບິນ", cls: "num", render: r => r.day.bills },
        { h: "ລາຍຮັບສຸດທິ", cls: "num", render: r => M(r.day.sales) },
        { h: "ເງິນທີ່ຮັບ", cls: "num", render: r => M(collected(r.day)) },
        { h: "ສະຖານະ", render: r => chip(r) },
        { h: "Journal", render: r => r.je_id ? E((Store.get("journal_entries", r.je_id) || {}).number || "") : "" },
        { h: "", render: r => `<button class="btn btn-ghost btn-sm" data-pv="${E(r.id)}">ເບິ່ງ</button>` }
      ], recs.slice(0, 40)) : `<div class="card p-8 text-center text-slate-500">ຍັງບໍ່ໄດ້ດຶງຂໍ້ມູນ — ກົດ <b>ດຶງຈາກ POS ດຽວນີ້</b></div>`) +
      reconcileCard(month);
    const v = view(), $ = s => v.querySelector(s);
    if ($("#pi-pull")) $("#pi-pull").onclick = pull; if ($("#pi-set")) $("#pi-set").onclick = settingsModal; if ($("#pi-set2")) $("#pi-set2").onclick = settingsModal; if ($("#pi-map")) $("#pi-map").onclick = mappingModal;
    v.querySelectorAll("[data-pv]").forEach(b => b.onclick = () => dayModal(b.dataset.pv));
    v.querySelectorAll("[data-ok]").forEach(b => b.onclick = () => act(() => Posin.post(b.dataset.ok, window.AppCtx.currentRole()), "ລົງບັນຊີແລ້ວ"));
    v.querySelectorAll("[data-sk]").forEach(b => b.onclick = () => skipModal(b.dataset.sk));
  }

  function reconcileCard(month) {
    const r = Posin.reconcile(month); if (!r.days) return "";
    const row = (l, a, b) => `<tr><td>${l}</td><td class="num">${M(a)}</td><td class="num">${M(b)}</td><td class="num" style="color:${a === b ? "#15803d" : "#b91c1c"}">${a === b ? "✓" : M(b - a)}</td></tr>`;
    return `<div class="section-title mt-6">ກວດທຽບ ${E(month)} — POS ເທິຍບກັບ ບັນຊີ (${r.days} ມື້)</div><div class="card overflow-hidden"><table class="data"><thead><tr><th></th><th class="num">POS ບອກ</th><th class="num">ໃນບັນຊີ</th><th class="num">ຕ່າງ</th></tr></thead><tbody>
      ${row("ລາຍຮັບ", r.pos.sales, r.gl.sales)}${row("ຄ່າບໍລິການ", r.pos.svc, r.gl.svc)}${row("VAT ຂາຍ", r.pos.vat, r.gl.vat)}${row("ທິບຄ້າງຈ່າຍ", r.pos.tips, r.gl.tips)}${r.stock ? row("ສະຕັອກ ດຽວນີ້ (POS ເທິຍບ ບັນຊີ 1300)", r.stock.pos, r.stock.gl) : ""}</tbody></table></div>
      ${r.stock && r.stock.pos !== r.stock.gl ? `<p class="hint mt-2">ສະຕັອກຕ່າງກັນ ${M(r.stock.gl - r.stock.pos)}: ປົກກະຕິແມ່ນຍັງບໍ່ໄດ້ໃສ່ <b>ຍອດສະຕັອກຍົກມາ</b> ຕອນເລີ່ມເຊື່ອມ (Dr ສິນຄ້າຄົງເຫຼືອ · Cr Opening Balance Equity), ຫຼື ມີການຊື້ທີ່ບັນທຶກທາງອື່ນ.</p>` : ""}`;
  }

  async function pull() {
    const b = view().querySelector("#pi-pull"); if (b) { b.disabled = true; b.textContent = "ກຳລັງດຶງ…"; }
    try { const r = await Posin.sync({ role: window.AppCtx.currentRole() }); UI.toast("ດຶງແລ້ວ: ໃໝ່ " + r.added + " · ລົງບັນຊີ " + r.posted + " · ລໍກວດ " + r.held + " · ຕິດຂັດ " + r.blocked + (r.adjusted ? " · ປັບ " + r.adjusted : ""), r.blocked ? "warn" : "ok"); }
    catch (e) { UI.toast(e.message, "err"); }
    render();
  }

  function dayModal(id) {
    const r = Store.get("pos_days", id), d = r.day, M2 = Posin.mapping(), L = Posin.buildLines(d, M2), t = Posin.totals(L);
    const kv = (k, v) => v ? `<div class="flex justify-between gap-3 text-sm"><span class="text-slate-500">${E(k)}</span><b>${typeof v === "number" ? M(v) : E(v)}</b></div>` : "";
    const obj = (title, o) => Object.keys(o || {}).length ? `<div class="mt-3"><div class="font-semibold text-sm mb-1">${E(title)}</div>${Object.keys(o).map(k => kv(k, o[k])).join("")}</div>` : "";
    UI.modal("POS " + r.date + " · " + r.branch_name, `<div class="flex items-center gap-2 mb-3">${chip(r)}${r.je_id ? `<span class="hint">${E((Store.get("journal_entries", r.je_id) || {}).number || "")}</span>` : ""}</div>
      ${(r.issues || []).map(i => `<div class="booking mb-1" style="${i.level === "block" ? "background:#fef2f2;border-color:#fca5a5" : i.level === "warn" ? "background:#fffbeb;border-color:#fcd34d" : ""}">${E(i.msg)}</div>`).join("")}
      <div class="grid md:grid-cols-2 gap-4 mt-3"><div>${kv("ບິນ", d.bills + "")}${kv("ລາຍຮັບສຸດທິ", d.sales)}${kv("ຄ່າບໍລິການ (" + d.svcPct + "%)", d.svc)}${kv("VAT (" + d.vatPct + "%)", d.vat)}${kv("ທິບ", d.tips)}${kv("ຄ່າທຳນຽມບັດ", d.fees)}${kv("ຄືນເງິນ", d.refunds)}${kv("ຂາຍຕິດໜີ້", d.credit)}${kv("ມັດຈຳທີ່ໃຊ້", d.depUsed)}${kv("ຕົ້ນທຶນ (COGS)", d.cogs)}${kv("ຂອງເສຍ", d.waste)}${kv("ຂາດຈາກນັບສາງ", d.shortage)}${kv("ເງິນສົດເກີນ/ຂາດ", d.cashDiff)}${d.voids && d.voids.n ? kv("Void", d.voids.n + " ບິນ · " + M(d.voids.amt)) : ""}</div>
      <div>${obj("ວິທີຮັບເງິນ", d.pay)}${obj("ຂາຍຕາມໝວດ", d.byCat)}${obj("ລາຍຈ່າຍຈາກລິ້ນຊັກ", d.expenses)}${obj("ຮັບໜີ້ຄືນ", d.creditPays)}${obj("ມັດຈຳທີ່ຮັບ", d.deposits)}</div></div>
      <div class="mt-4"><div class="font-semibold text-sm mb-1">Journal ທີ່ຈະລົງ ${t.dr === t.cr ? "" : '<span class="chip s-bad">ບໍ່ສົມດຸນ</span>'}</div><table class="data"><thead><tr><th>ບັນຊີ</th><th>ລາຍລະອຽດ</th><th class="num">Dr</th><th class="num">Cr</th></tr></thead><tbody>
      ${L.map(l => `<tr><td>${E(Acc.accName(l.account))}</td><td class="hint">${E(l.memo)}</td><td class="num">${l.debit ? M(l.debit) : ""}</td><td class="num">${l.credit ? M(l.credit) : ""}</td></tr>`).join("")}
      <tr><td colspan="2"><b>ລວມ</b></td><td class="num"><b>${M(t.dr)}</b></td><td class="num"><b>${M(t.cr)}</b></td></tr></tbody></table></div>
      ${r.status !== "posted" && can() ? `<div class="flex justify-end gap-2 mt-4"><button class="btn btn-ghost" data-sk2>ຂ້າມມື້ນີ້</button><button class="btn btn-primary" data-ok2>ອະນຸມັດ & ລົງບັນຊີ</button></div>` : ""}`, { wide: true, onMount: (bd, close) => {
        const ok = bd.querySelector("[data-ok2]"), sk = bd.querySelector("[data-sk2]");
        if (ok) ok.onclick = () => { try { Posin.post(id, window.AppCtx.currentRole()); close(); UI.toast("ລົງບັນຊີແລ້ວ", "ok"); render(); } catch (e) { UI.toast(e.message, "err"); } };
        if (sk) sk.onclick = () => { close(); skipModal(id); };
      } });
  }

  function skipModal(id) {
    UI.modal("ຂ້າມມື້ນີ້?", `<p class="text-sm text-slate-600 mb-2">ມື້ນີ້ຈະບໍ່ລົງບັນຊີ (ບໍ່ດຶງມາໃໝ່). ໃສ່ເຫດຜົນ ເພື່ອໃຫ້ຜູ້ກວດເຫັນ.</p><input class="input" id="sk-r" placeholder="ເຫດຜົນ (ຈຳເປັນ)"><div class="flex justify-end gap-2 mt-4"><button class="btn btn-ghost" data-c>ຍົກເລີກ</button><button class="btn btn-danger" id="sk-go">ຂ້າມ</button></div>`, { onMount: (bd, close) => {
      bd.querySelector("[data-c]").onclick = close;
      bd.querySelector("#sk-go").onclick = () => { const r = bd.querySelector("#sk-r").value.trim(); if (!r) return UI.toast("ໃສ່ເຫດຜົນ", "warn"); Posin.skip(id, r, window.AppCtx.currentRole()); close(); render(); };
    } });
  }

  function settingsModal() {
    const lk = Posin.link();
    UI.modal("ຕັ້ງການເຊື່ອມຕໍ່ POS", `<div class="space-y-3">
      <div><label class="field">URL ຂອງ POS server</label><input class="input" id="ps-url" placeholder="https://stpos.store/api/b1" value="${E(lk.url)}"></div>
      <div><label class="field">ລະຫັດອ່ານບັນຊີ (ACCT_TOKEN)</label><input class="input" id="ps-tok" type="password" autocomplete="off" placeholder="${lk.token ? "ຕັ້ງແລ້ວ — ປ່ອຍວ່າງ = ບໍ່ປ່ຽນ" : "ວາງລະຫັດທີ່ນີ້"}"><p class="hint mt-1">ເກັບໃນ browser ເຄື່ອງນີ້ເທົ່ານັ້ນ (ບໍ່ຂຶ້ນ GitHub ຫຼື ບັນທຶກໃນຖານຂໍ້ມູນ). ລະຫັດນີ້ອ່ານໄດ້ສະເພາະສະຫຼຸບບັນຊີ ປ່ຽນຂໍ້ມູນ POS ບໍ່ໄດ້.</p></div>
      <div class="grid sm:grid-cols-2 gap-3"><div><label class="field">ເລີ່ມດຶງຕັ້ງແຕ່ວັນທີ</label><input class="input" type="date" id="ps-start" value="${E(lk.start)}"></div>
        <div><label class="field">ເງິນສົດເກີນ/ຂາດ ເກີນເທົ່າໃດ ໃຫ້ຄົນກວດ (ກີບ)</label><input class="input num" type="number" id="ps-lim" value="${lk.cash_diff_limit}"></div></div>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="ps-auto" ${lk.auto ? "checked" : ""}> ດຶງ ແລະ ລົງບັນຊີເອງ ທຸກຄັ້ງທີ່ເປີດ ERP (ມື້ປົກກະຕິ)</label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="ps-live" ${lk.live ? "checked" : ""}> ລົງບັນຊີທຸລະກຳຂອງມື້ນີ້ທັນທີ (ບໍ່ລໍມື້ອື່ນ) — ບິນເພີ່ມພາຍຫຼັງ ລົງເປັນລາຍການປັບຕື່ມ</label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="ps-hold" ${lk.hold_on_warn ? "checked" : ""}> ມື້ທີ່ມີຂໍ້ສັງເກດ (ເງິນຂາດ, ຄືນເງິນຫຼາຍ, ຍອດຕ່າງຈາກປົກກະຕິ) ໃຫ້ຄົນກວດກ່ອນ</label></div>
      <div class="flex justify-between gap-2 mt-4"><button class="btn btn-ghost" id="ps-test">ທົດສອບການເຊື່ອມຕໍ່</button><div class="flex gap-2"><button class="btn btn-ghost" data-c>ປິດ</button><button class="btn btn-primary" id="ps-save">ບັນທຶກ</button></div></div>
      <p class="hint mt-2" id="ps-msg"></p>`, { onMount: (bd, close) => {
        const q = s => bd.querySelector(s);
        const save = () => { if (!can()) { UI.toast("ບໍ່ມີສິດ", "warn"); return false; }
          Posin.setLink({ url: q("#ps-url").value.trim().replace(/\/+$/, ""), start: q("#ps-start").value, cash_diff_limit: Number(q("#ps-lim").value) || 0, auto: q("#ps-auto").checked, live: q("#ps-live").checked, hold_on_warn: q("#ps-hold").checked }, q("#ps-tok").value.trim() || undefined); return true; };
        q("[data-c]").onclick = close;
        q("#ps-save").onclick = () => { if (save()) { close(); UI.toast("ບັນທຶກແລ້ວ", "ok"); render(); } };
        q("#ps-test").onclick = async () => {
          if (!save()) return; const m = q("#ps-msg"); m.textContent = "ກຳລັງທົດສອບ…";
          try { const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10), r = await Posin.fetchRange(y, y); m.textContent = r && r.ok ? "✓ ເຊື່ອມຕໍ່ໄດ້ — POS ມີ " + (r.branches || []).length + " ສາຂາ" : "✗ " + ((r && r.err) || "POS ຕອບຜິດ") + (r && r.err === "token" ? " (ລະຫັດບໍ່ຖືກ)" : ""); }
          catch (e) { m.textContent = "✗ " + e.message; }
        };
      } });
  }

  function mappingModal() {
    const M2 = Posin.mapping(), recs = Posin.recs();
    const uniq = f => [...new Set(recs.reduce((a, r) => a.concat(f(r.day)), []))].sort();
    const methods = uniq(d => Object.keys(d.pay || {}).concat(Object.keys(d.creditPays || {}), Object.keys(d.deposits || {}))), cats = uniq(d => Object.keys(d.byCat || {})), exps = uniq(d => Object.keys(d.expenses || {}));
    const accts = Store.where("accounts", a => !Number(a.is_header)), dl = `<datalist id="pm-acc">${accts.map(a => `<option value="${E(a.code + " " + a.name)}">`).join("")}</datalist>`;
    const cell = (key, cur, extra) => `<input class="input" list="pm-acc" data-k="${E(key)}" value="${E(cur ? (cur === "INV" || cur === "SKIP" ? cur : (Acc.accName(cur))) : "")}" ${extra || ""}>`;
    const row = (label, key, cur, hint) => `<tr><td>${E(label)}${hint ? `<div class="hint">${E(hint)}</div>` : ""}</td><td>${cell(key, cur)}</td></tr>`;
    const fixed = [["ເງິນສົດໃນລິ້ນຊັກ", "drawer", M2.drawer], ["ບັນຊີ ວິທີຮັບເງິນອື່ນໆ (ເລີ່ມຕົ້ນ)", "methodDefault", M2.methodDefault], ["ລາຍຮັບ (ເລີ່ມຕົ້ນ)", "sales", M2.sales], ["ຄ່າບໍລິການ", "svc", M2.svc], ["ທິບຄ້າງຈ່າຍ", "tips", M2.tips], ["ຄ່າທຳນຽມບັດທີ່ເກັບຈາກລູກຄ້າ", "fees", M2.fees], ["ມັດຈຳລູກຄ້າ", "deposits", M2.deposits], ["ຂອງເສຍ", "waste", M2.waste], ["ຂາດຈາກການນັບສາງ", "shortage", M2.shortage], ["ເງິນສົດເກີນ/ຂາດ", "overshort", M2.overshort], ["ລາຍຈ່າຍຈາກລິ້ນຊັກ — ຈ່າຍຈາກບັນຊີ", "expFrom", M2.expFrom]];
    UI.modal("ຕັ້ງບັນຊີ POS → ERP", dl + `<p class="hint mb-3">ພິມເລກ ຫຼື ຊື່ບັນຊີ. ໝວດລາຍຈ່າຍ: ໃສ່ <b>INV</b> = ເຂົ້າສະຕັອກ (ຊື້ວັດຖຸດິບ), <b>SKIP</b> = ບໍ່ລົງບັນຊີ (ເຊັ່ນ ເງິນເດືອນທີ່ລົງຜ່ານໜ້າເງິນເດືອນ ERP ແລ້ວ).</p>
      <div class="grid md:grid-cols-2 gap-4"><div><h4 class="font-semibold mb-1">ວິທີຮັບເງິນ</h4><table class="data"><tbody>${methods.map(m => row(m, "m:" + m, Posin.acctMethod(M2, m))).join("") || '<tr><td class="hint">ຍັງບໍ່ມີ</td></tr>'}</tbody></table>
        <h4 class="font-semibold mt-3 mb-1">ໝວດລາຍຮັບ (ເມນູ)</h4><table class="data"><tbody>${cats.map(c => row(c, "c:" + c, Posin.acctCat(M2, c))).join("") || '<tr><td class="hint">ຍັງບໍ່ມີ</td></tr>'}</tbody></table>
        <h4 class="font-semibold mt-3 mb-1">ໝວດລາຍຈ່າຍ (ຈາກລິ້ນຊັກ)</h4><table class="data"><tbody>${exps.concat(Object.keys(M2.exp).filter(k => exps.indexOf(k) === -1)).map(c => row(c, "e:" + c, M2.exp[c] === undefined ? M2.expDefault : M2.exp[c])).join("")}</tbody></table></div>
      <div><h4 class="font-semibold mb-1">ບັນຊີອື່ນໆ</h4><table class="data"><tbody>${fixed.map(f => row(f[0], "f:" + f[1], f[2])).join("")}</tbody></table></div></div>
      <div class="flex justify-end gap-2 mt-4"><button class="btn btn-ghost" data-c>ປິດ</button><button class="btn btn-primary" id="pm-save">ບັນທຶກ</button></div>`, { wide: true, onMount: (bd, close) => {
        bd.querySelector("[data-c]").onclick = close;
        bd.querySelector("#pm-save").onclick = () => {
          if (!can()) return UI.toast("ບໍ່ມີສິດ", "warn");
          const code = v => { v = String(v || "").trim(); if (v === "INV" || v === "SKIP") return v; const c = v.split(/\s+/)[0]; return c; };
          const patch = { methods: {}, cats: {}, exp: {} }, bad = [];
          bd.querySelectorAll("input[data-k]").forEach(el => {
            const [kind, ...rest] = el.dataset.k.split(":"), name = rest.join(":"), v = code(el.value); if (!v) return;
            if (v !== "INV" && v !== "SKIP" && !Acc.acc(v)) { bad.push(name + " → " + v); return; }
            if (kind === "m") patch.methods[name] = v; else if (kind === "c") patch.cats[name] = v; else if (kind === "e") patch.exp[name] = v; else patch[name] = v;
          });
          if (bad.length) return UI.toast("ບໍ່ພົບບັນຊີ: " + bad.slice(0, 3).join(", "), "err");
          Posin.setMapping(patch); close(); UI.toast("ບັນທຶກການຕັ້ງບັນຊີແລ້ວ (ໃຊ້ກັບມື້ທີ່ຍັງບໍ່ລົງບັນຊີ)", "ok"); render();
        };
      } });
  }

  window.PosinUI = { page: render };
})();
