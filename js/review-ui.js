/* ST ERP – "ກວດບັນຊີ" page: journals waiting for finance, confirm in bulk or send a correction; rules + categories editors. Logic in review.js */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s)), M = v => UI.money(v);
  const view = () => document.getElementById("view");
  const filter = { f: "todo", sel: {} };
  const nameOf = c => String((Acc.acc(c) || {}).name || "");
  const linesOf = id => Store.where("journal_lines", l => l.je_id === id);
  const STATE = { pending: ["ລໍກວດ", "s-wait"], confirmed: ["ກວດແລ້ວ", "s-done"], fixed: ["ຖືກແກ້ໄຂ", "s-draft"] };

  function detail(id) {
    const je = Store.get("journal_entries", id), ls = linesOf(id), can = je.review === "pending" && Review.sees();
    const accts = Store.where("accounts", a => !Number(a.is_header));
    UI.modal("Journal " + je.number, `<div class="hint mb-2">${E(UI.fmtDate(je.date))} · ${E(Review.TYPE_NAME[je.source_type] || je.source_type || "")} · ບັນທຶກໂດຍ ${E(je.posted_by || "-")}<br>${E(je.memo || "")}</div>
      <datalist id="rv-acc">${accts.map(a => `<option value="${E(a.code)}">${E(a.name)}</option>`).join("")}</datalist>
      <table class="data"><thead><tr><th>ບັນຊີ</th><th>ຊື່</th><th class="num">Dr</th><th class="num">Cr</th></tr></thead><tbody>
        ${ls.map((l, i) => `<tr><td style="width:170px">${can ? `<input class="input" list="rv-acc" data-i="${i}" value="${E(l.account)}">` : E(l.account)}</td><td data-nm="${i}">${E(nameOf(l.account) || l.account_name)}</td><td class="num">${l.debit ? M(l.debit) : ""}</td><td class="num">${l.credit ? M(l.credit) : ""}</td></tr>`).join("")}</tbody></table>
      ${can ? `<label class="field mt-3">ຖ້າຈະແກ້ບັນຊີ — ເຫດຜົນ (ຕ້ອງໄດ້ຮັບອະນຸມັດກ່ອນ ຈຶ່ງແກ້ຈິງ)</label><input class="input" id="rv-reason" placeholder="ເຊັ່ນ: ຄວນລົງໝວດຄ່າເດີນທາງ ບໍ່ແມ່ນຄ່າອາຫານ">` : ""}
      <div class="flex flex-wrap justify-end gap-2 mt-4"><button class="btn btn-ghost" data-x>ປິດ</button>${can ? '<button class="btn btn-ghost" id="rv-fix">ສົ່ງຂໍແກ້ໄຂ</button><button class="btn btn-primary" id="rv-ok">✓ ຖືກຕ້ອງ — ຢືນຢັນ</button>' : ""}</div>`,
      { wide: true, onMount: (bd, close) => {
        bd.querySelector("[data-x]").onclick = close;
        bd.querySelectorAll("input[data-i]").forEach(inp => inp.oninput = () => { bd.querySelector(`[data-nm="${inp.dataset.i}"]`).textContent = nameOf(inp.value.trim()) || "— ບໍ່ພົບບັນຊີ —"; });
        const ok = bd.querySelector("#rv-ok"); if (ok) ok.onclick = () => { try { Review.confirm(id); close(); UI.toast("ຢືນຢັນແລ້ວ", "ok"); page(); } catch (e) { UI.toast(e.message, "err"); } };
        const fx = bd.querySelector("#rv-fix"); if (fx) fx.onclick = () => {
          const nl = ls.map((l, i) => ({ account: bd.querySelector(`input[data-i="${i}"]`).value.trim(), debit: l.debit, credit: l.credit, memo: l.memo }));
          if (nl.every((l, i) => l.account === ls[i].account)) return UI.toast("ຍັງບໍ່ໄດ້ປ່ຽນບັນຊີຫຍັງ", "warn");
          close(); GateUI.send("JEFIX", { je_id: id, lines: nl, reason: bd.querySelector("#rv-reason").value }, { key: "JEFIX:" + id, done: "ແກ້ໄຂ Journal ແລ້ວ ✓", after: page });
        };
      } });
  }

  function rulesModal() {
    const r = Review.rules();
    UI.modal("ກົດການກວດບັນຊີ", `<p class="hint mb-3">ພະນັກງານບັນທຶກເອງໄດ້ເລີຍ (ບໍ່ຕ້ອງຮູ້ບັນຊີ). Journal ຈະຖືກສົ່ງມາໃຫ້ການເງິນ/ບັນຊີກວດ ສະເພາະກໍລະນີລຸ່ມນີ້. ອັນອື່ນຖືວ່າຖືກຕ້ອງໂດຍອັດຕະໂນມັດ.</p>
      <div class="font-semibold mb-1">ກວດທຸກໃບຂອງປະເພດ:</div><div class="grid sm:grid-cols-2 gap-1 mb-3">${Review.TYPES.map(([k, l]) => `<label class="flex items-center gap-2 text-sm"><input type="checkbox" data-t="${k}" ${r.types.indexOf(k) >= 0 ? "checked" : ""}> ${E(l)}</label>`).join("")}</div>
      <label class="field">ກວດທຸກໃບທີ່ຍອດ ≥ (0 = ບໍ່ໃຊ້ເງື່ອນໄຂນີ້)</label><input class="input num" type="number" id="rv-min" value="${Number(r.min) || 0}" style="max-width:220px">
      <p class="hint mt-2">ຍັງສາມາດກຳນົດ "ກວດທຸກໃບ" ຕາມ ໝວດ ໄດ້ໃນປຸ່ມ "ໝວດສຳລັບພະນັກງານ".</p>
      <div class="flex justify-end gap-2 mt-4"><button class="btn btn-ghost" data-x>ຍົກເລີກ</button><button class="btn btn-primary" id="rv-save">ບັນທຶກ</button></div>`,
      { onMount: (bd, close) => {
        bd.querySelector("[data-x]").onclick = close;
        bd.querySelector("#rv-save").onclick = () => {
          const v = { types: Array.from(bd.querySelectorAll("[data-t]")).filter(c => c.checked).map(c => c.dataset.t), min: Number(bd.querySelector("#rv-min").value) || 0 };
          const cur = Store.get("settings", "review"); if (cur) Store.update("settings", "review", v); else Store.insert("settings", Object.assign({ id: "review" }, v));
          close(); UI.toast("ບັນທຶກກົດແລ້ວ", "ok");
        };
      } });
  }

  function catModal() {
    let items = JSON.parse(JSON.stringify(Cat.items()));
    const accts = Store.where("accounts", a => !Number(a.is_header) && (a.type === "Expense" || a.type === "Revenue") && a.name !== "(ຍັງບໍ່ຕັ້ງຊື່)");
    UI.modal("ໝວດສຳລັບພະນັກງານ", `<p class="hint mb-2">ພະນັກງານເລືອກແຕ່ "ໝວດ" (ຊື່ທີ່ເຂົ້າໃຈງ່າຍ) — ລະບົບຮູ້ເອງວ່າລົງບັນຊີໃດ. ໝວດທີ່ຕິກ "ກວດ" ຈະສົ່ງ Journal ມາໃຫ້ການເງິນກວດທຸກໃບ. ຖ້າບໍ່ມີໝວດ ພະນັກງານຈະເຫັນຊື່ບັນຊີ (ບໍ່ມີລະຫັດ).</p>
      <datalist id="ct-acc">${accts.map(a => `<option value="${E(a.code)}">${E(a.name)}</option>`).join("")}</datalist><div id="ct-rows"></div>
      <div class="flex flex-wrap gap-2 mt-2"><button class="btn btn-ghost btn-sm" id="ct-add">＋ ເພີ່ມໝວດ</button><button class="btn btn-ghost btn-sm" id="ct-gen">ສ້າງຈາກບັນຊີຄ່າໃຊ້ຈ່າຍ/ລາຍຮັບທີ່ມີຊື່</button></div>
      <div class="flex justify-end gap-2 mt-4"><button class="btn btn-ghost" data-x>ຍົກເລີກ</button><button class="btn btn-primary" id="ct-save">ບັນທຶກ</button></div>`,
      { wide: true, onMount: (bd, close) => {
        const rows = bd.querySelector("#ct-rows");
        const draw = () => { rows.innerHTML = items.map((c, i) => `<div class="grid gap-2 mb-2 items-center" style="grid-template-columns:2fr 1fr 1.2fr auto auto"><input class="input" data-k="name" data-i="${i}" placeholder="ຊື່ໝວດ (ເຊັ່ນ ຄ່ານ້ຳມັນ)" value="${E(c.name)}">
          <select class="input" data-k="kind" data-i="${i}"><option value="expense" ${c.kind === "expense" ? "selected" : ""}>ລາຍຈ່າຍ</option><option value="revenue" ${c.kind === "revenue" ? "selected" : ""}>ລາຍຮັບ</option></select>
          <input class="input" list="ct-acc" data-k="account" data-i="${i}" placeholder="ບັນຊີ" value="${E(c.account)}"><label class="text-sm flex items-center gap-1"><input type="checkbox" data-k="review" data-i="${i}" ${c.review ? "checked" : ""}> ກວດ</label><button class="text-red-500" data-del="${i}">✕</button></div>`).join("") || '<div class="hint">ຍັງບໍ່ມີໝວດ</div>'; };
        const read = () => rows.querySelectorAll("[data-k]").forEach(el => { items[el.dataset.i][el.dataset.k] = el.type === "checkbox" ? el.checked : el.value.trim(); });
        draw();
        bd.querySelector("[data-x]").onclick = close;
        bd.querySelector("#ct-add").onclick = () => { read(); items.push({ name: "", kind: "expense", account: "", review: false }); draw(); };
        bd.querySelector("#ct-gen").onclick = () => { read(); const have = items.map(c => c.account); accts.filter(a => have.indexOf(a.code) < 0).slice(0, 60).forEach(a => items.push({ name: a.name, kind: a.type === "Revenue" ? "revenue" : "expense", account: a.code, review: false })); draw(); };
        rows.onclick = e => { const d = e.target.closest("[data-del]"); if (d) { read(); items.splice(Number(d.dataset.del), 1); draw(); } };
        bd.querySelector("#ct-save").onclick = () => {
          read(); const bad = items.find(c => !c.name || !Acc.acc(c.account));
          if (bad) return UI.toast("ທຸກແຖວຕ້ອງມີຊື່ໝວດ ແລະ ບັນຊີທີ່ມີຢູ່ຈິງ" + (bad.name ? " (" + bad.name + ")" : ""), "warn");
          Cat.save(items); close(); UI.toast("ບັນທຶກ " + items.length + " ໝວດແລ້ວ", "ok");
        };
      } });
  }

  function page() {
    const all = Store.where("journal_entries", j => j.review).sort((a, b) => (b.date || "").localeCompare(a.date || "")), todo = all.filter(j => j.review === "pending" && j.status === "posted");
    const sets = { todo, done: all.filter(j => j.review === "confirmed" || j.review === "fixed"), all }, can = Review.sees();
    const seg = [["todo", "ລໍກວດ"], ["done", "ກວດແລ້ວ"], ["all", "ທັງໝົດ"]].map(([k, l]) => `<button data-f="${k}" class="${filter.f === k ? "on" : ""}">${l} (${sets[k].length})</button>`).join("");
    const rows = sets[filter.f].slice(0, 300);
    view().innerHTML = UI.pageHead("ກວດບັນຊີ", "Journal ທີ່ພະນັກງານບັນທຶກ — ການເງິນ/ບັນຊີກວດ ແລ້ວຢືນຢັນ ຫຼື ສົ່ງຂໍແກ້ໄຂ (ຕ້ອງໄດ້ຮັບອະນຸມັດ)",
      `<button class="btn btn-ghost" id="rv-cat">ໝວດສຳລັບພະນັກງານ</button><button class="btn btn-ghost" id="rv-rules">ຕັ້ງກົດການກວດ</button>`) +
      `<div class="flex flex-wrap items-center gap-2 mb-3"><div class="seg">${seg}</div>${filter.f === "todo" && can && rows.length ? '<button class="btn btn-ok btn-sm" id="rv-bulk">✓ ຢືນຢັນທີ່ເລືອກ</button><label class="text-sm flex items-center gap-1"><input type="checkbox" id="rv-all"> ເລືອກທັງໝົດ</label>' : ""}</div>` +
      UI.table([{ h: "", render: r => r.review === "pending" && can ? `<input type="checkbox" data-sel="${r.id}">` : "" }, { h: "ວັນທີ", render: r => UI.fmtDate(r.date) }, { h: "ເລກທີ", key: "number" }, { h: "ແຫຼ່ງ", render: r => E(Review.TYPE_NAME[r.source_type] || r.source_type || "") },
        { h: "ລາຍລະອຽດ", render: r => E(String(r.memo || "").slice(0, 70)) }, { h: "ຜູ້ບັນທຶກ", render: r => E(r.posted_by || "") }, { h: "ຍອດ", cls: "num", render: r => M(r.total_debit) },
        { h: "ສະຖານະ", render: r => { const s = STATE[r.review] || ["", ""]; return `<span class="chip ${s[1]}">${s[0]}</span>`; } }, { h: "", render: r => `<button class="btn btn-ghost btn-sm" data-open="${r.id}">${r.review === "pending" && can ? "ກວດ" : "ເບິ່ງ"}</button>` }], rows) +
      (sets[filter.f].length > rows.length ? `<p class="hint mt-2">ສະແດງ ${rows.length} ໃບທຳອິດ</p>` : "");
    const v = view(), on = (s, f) => { const b = v.querySelector(s); if (b) b.onclick = f; };
    v.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { filter.f = b.dataset.f; page(); });
    v.querySelectorAll("[data-open]").forEach(b => b.onclick = () => detail(b.dataset.open));
    on("#rv-rules", rulesModal); on("#rv-cat", catModal);
    const all2 = v.querySelector("#rv-all"); if (all2) all2.onchange = () => v.querySelectorAll("[data-sel]").forEach(c => { c.checked = all2.checked; });
    on("#rv-bulk", () => { const ids = Array.from(v.querySelectorAll("[data-sel]:checked")).map(c => c.dataset.sel); if (!ids.length) return UI.toast("ເລືອກລາຍການກ່ອນ", "warn"); try { UI.toast("ຢືນຢັນ " + Review.confirmMany(ids) + " ໃບແລ້ວ", "ok"); page(); } catch (e) { UI.toast(e.message, "err"); } });
  }

  window.ReviewUI = { page, detail, rulesModal, catModal };
})();
