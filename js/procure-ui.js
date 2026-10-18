/* ============================================================
   LaoBooks ERP – Procurement screens (action-first UI)
   List  : "waiting for you" cards first, then all cases with ONE next-step button each.
   Detail: stepper + a single "next step" box that contains the whole action inline
           (no extra pop-ups), the items, the audit trail and what each step books.
   Uses: Procure (logic), UI, Store, Acc, and window.AppCtx from app.js
         (currentRole, canApprove, guardedPost, poPrint).
   ============================================================ */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s)), M = v => UI.money(v);
  const view = () => document.getElementById("view");
  const role = () => window.AppCtx.currentRole();
  const params = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const open = id => { location.hash = id ? "#/procure?id=" + id : "#/procure"; };
  const vendorName = id => (Store.get("vendors", id) || {}).name || "—";
  const KIND = { stock: "ສິນຄ້າເຂົ້າສາງ", expense: "ຄ່າໃຊ້ຈ່າຍ / ບໍລິການ", asset: "ຊັບສິນຖາວອນ" };
  const DID = { create: "ສ້າງໃບຂໍຊື້", submit: "ສົ່ງຂໍອະນຸມັດ", approve: "ອະນຸມັດ", reject: "ປະຕິເສດ", return: "ສົ່ງຄືນໃຫ້ແກ້", cancel: "ຍົກເລີກ",
    quote: "ເພີ່ມໃບສະເໜີ", create_po: "ສ້າງ PO", receive: "ຮັບເຄື່ອງ", short_close: "ປິດການຮັບ (ບໍ່ຄົບ)", bill: "ບັນທຶກບິນ", pay: "ຈ່າຍເງິນ" };
  let filter = "mine";

  function act(fn, okMsg) {
    try { fn(); if (okMsg) UI.toast(okMsg, "ok"); render(); }
    catch (e) { UI.toast(e.message, "err"); }
  }
  function render() { const id = params().get("id"); if (id && Store.get("purchase_requisitions", id)) detail(id); else list(); }

  /* ---------- small building blocks ---------- */
  function chip(st) {
    const cls = st === "draft" ? "s-draft" : (st === "pr_approval" || st === "po_approval") ? "s-wait" : st === "closed" ? "s-done" : Procure.ENDED[st] ? "s-bad" : "s-run";
    return `<span class="chip ${cls}">${E(Procure.stageLabel(st))}</span>`;
  }
  function pct(st) { const i = Procure.STAGES.findIndex(s => s.id === st); return i < 0 ? 100 : Math.round(i / (Procure.STAGES.length - 1) * 100); }
  function stepper(st) {
    const cur = Procure.STAGES.findIndex(s => s.id === st), bad = st === "rejected" || st === "cancelled";
    return `<div class="stepper">${Procure.STAGES.map((s, i) => {
      const cls = bad ? (i === 0 ? "bad" : "") : i < cur || st === "closed" ? "done" : i === cur ? "cur" : "";
      return `<div class="step ${cls}"><div class="dot">${cls === "done" ? "✓" : cls === "bad" ? "✕" : i + 1}</div>${E(s.short)}</div>`;
    }).join("")}</div>`;
  }
  function roleBar() {
    return `<span class="role-pill" title="ປ່ຽນບົດບາດໄດ້ທີ່ ຕັ້ງຄ່າ">👤 ບົດບາດ: ${E(role())}</span>`;
  }

  /* =================== LIST =================== */
  function list() {
    const r = role();
    const all = Store.all("purchase_requisitions").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const queue = Procure.queue(r);
    const drafts = all.filter(c => Procure.stageOf(c) === "draft");
    const mine = queue.concat(drafts.filter(d => queue.indexOf(d) === -1));
    const sets = {
      mine, open: all.filter(c => !Procure.ENDED[Procure.stageOf(c)]),
      done: all.filter(c => Procure.ENDED[Procure.stageOf(c)]), all
    };
    const rows = sets[filter] || all;

    view().innerHTML = UI.pageHead("ຈັດຊື້", "ຂໍຊື້ → ອະນຸມັດ → ສະເໜີລາຄາ → PO → ຮັບເຄື່ອງ → ບິນ → ຈ່າຍ",
      roleBar() + `<button class="btn btn-primary btn-lg" id="pc-new">＋ ຂໍຊື້ໃໝ່</button>`) +
      `<div class="section-title">ລໍຖ້າທ່ານ <span class="count ${mine.length ? "" : "zero"}">${mine.length}</span></div>` +
      (mine.length
        ? `<div class="ac-list cols mb-6">${mine.slice(0, 6).map(card).join("")}</div>`
        : `<div class="ac-empty mb-6">✓ ບໍ່ມີວຽກຈັດຊື້ລໍທ່ານ</div>`) +
      `<div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div class="seg">${[["mine", "ລໍຂ້ອຍ"], ["open", "ກຳລັງດຳເນີນ"], ["done", "ສິ້ນສຸດ"], ["all", "ທັງໝົດ"]].map(([k, t]) =>
          `<button data-f="${k}" class="${filter === k ? "on" : ""}">${t} (${sets[k].length})</button>`).join("")}</div>
      </div>` +
      (rows.length ? UI.table([
        { h: "ເລກທີ", render: c => `<a class="font-semibold text-brand-700" href="#/procure?id=${c.id}">${E(c.number)}</a>` },
        { h: "ຈຸດປະສົງ", render: c => `${E(c.purpose)}<div class="hint">${E(c.requester)}${c.dept ? " · " + E(c.dept) : ""}</div>` },
        { h: "ຍອດ", cls: "num", render: c => M(c.po_id ? (Store.get("purchase_orders", c.po_id) || {}).total : c.est_total) },
        { h: "ສະຖານະ", render: c => { const st = Procure.stageOf(c); return chip(st) + `<div class="mini-bar"><i style="width:${pct(st)}%"></i></div>`; } },
        { h: "ຂັ້ນຕໍ່ໄປ", render: c => nextCell(c) }
      ], rows) : `<div class="card p-8 text-center text-slate-500">ຍັງບໍ່ມີລາຍການ — ກົດ <b>＋ ຂໍຊື້ໃໝ່</b> ເພື່ອເລີ່ມ</div>`);

    view().querySelector("#pc-new").onclick = newCase;
    view().querySelectorAll("[data-f]").forEach(b => b.onclick = () => { filter = b.dataset.f; list(); });
    view().querySelectorAll("[data-open]").forEach(b => b.onclick = () => open(b.dataset.open));
  }
  function card(c) {
    const n = Procure.nextAction(c, role());
    const amt = c.po_id ? (Store.get("purchase_orders", c.po_id) || {}).total : c.est_total;
    const tone = n.stage === "pr_approval" || n.stage === "po_approval" ? "warn" : "";
    return `<div class="ac-card ${tone}"><div class="ac-ic">${n.stage === "draft" ? "📝" : tone ? "✍️" : n.stage === "receiving" ? "📦" : n.stage === "paying" ? "💸" : "🧾"}</div>
      <div class="ac-body"><div class="ac-title">${E(c.number)} · ${E(c.purpose)}</div>
      <div class="ac-meta">${M(amt)}${c.need_by ? " · ຕ້ອງການ " + E(UI.fmtDate(c.need_by)) : ""}</div></div>
      <button class="btn btn-primary" data-open="${c.id}">${E(n.label)} →</button></div>`;
  }
  function nextCell(c) {
    const n = Procure.nextAction(c, role());
    if (Procure.ENDED[n.stage]) return `<span class="hint">—</span>`;
    return n.allowed ? `<button class="btn btn-primary btn-sm" data-open="${c.id}">${E(n.label)} →</button>`
      : `<span class="hint">ລໍ ${E(n.waitingFor.join(" / "))}</span>`;
  }

  /* =================== NEW REQUEST (one dialog, submit in one click) =================== */
  function newCase() {
    const items = Store.where("items", i => i.status !== "inactive");
    let lines = [{ item_id: "", description: "", kind: "expense", qty: 1, price: 0 }];
    const itemOpts = sel => `<option value="">— ພິມລາຍການໃໝ່ —</option>` + items.map(i => `<option value="${i.id}" ${i.id === sel ? "selected" : ""}>${E(i.name)}</option>`).join("");
    UI.modal("ຂໍຊື້ໃໝ່", `
      <div class="grid sm:grid-cols-2 gap-3 mb-3">
        <div class="sm:col-span-2"><label class="field">ຊື້ເພື່ອຫຍັງ? *</label><input class="input" id="nc-purpose" placeholder="ເຊັ່ນ: ຄອມພິວເຕີໃຫ້ພະນັກງານບັນຊີໃໝ່"></div>
        <div class="sm:col-span-2"><label class="field">ເຫດຜົນ / ຄວາມຈຳເປັນ (ໃບສະເໜີ)</label><textarea class="input" id="nc-just" rows="2" placeholder="ເປັນຫຍັງຕ້ອງຊື້, ຖ້າບໍ່ຊື້ຈະມີຜົນແນວໃດ"></textarea></div>
        <div><label class="field">ຜູ້ຂໍ</label><input class="input" id="nc-req" value="${E(role())}"></div>
        <div><label class="field">ຕ້ອງການພາຍໃນວັນທີ</label><input class="input" type="date" id="nc-need"></div>
      </div>
      <div class="overflow-x-auto"><table class="data"><thead><tr><th>ລາຍການ</th><th>ປະເພດ</th><th class="num">ຈຳນວນ</th><th class="num">ລາຄາປະມານ</th><th></th></tr></thead><tbody id="nc-lines"></tbody></table></div>
      <div class="flex items-center justify-between mt-2"><button class="btn btn-ghost btn-sm" id="nc-add">＋ ເພີ່ມລາຍການ</button><div>ລວມປະມານ: <b id="nc-total">0</b></div></div>
      <div class="booking mt-2" id="nc-chain"></div>
      <p class="hint mt-3">ປະເພດກຳນົດການລົງບັນຊີຕອນຮັບເຄື່ອງ: ສິນຄ້າເຂົ້າສາງ → ສິນຄ້າຄົງເຫຼືອ, ຄ່າໃຊ້ຈ່າຍ → ບັນຊີຄ່າໃຊ້ຈ່າຍ, ຊັບສິນຖາວອນ → ລົງທະບຽນຊັບສິນ + ຄິດຄ່າເສື່ອມໃຫ້ອັດຕະໂນມັດ.</p>
      <div class="flex flex-wrap justify-end gap-2 mt-4">
        <button class="btn btn-ghost" id="nc-draft">ບັນທຶກເປັນຮ່າງ</button>
        <button class="btn btn-primary btn-lg" id="nc-submit">ສົ່ງຂໍອະນຸມັດ →</button>
      </div>`, { wide: true, onMount: (bd, close) => {
        const q = s => bd.querySelector(s);
        function draw() {
          q("#nc-lines").innerHTML = lines.map((l, i) => `<tr>
            <td style="min-width:220px"><select class="input mb-1" data-i="${i}" data-k="item_id">${itemOpts(l.item_id)}</select>
              ${l.item_id ? "" : `<input class="input" data-i="${i}" data-k="description" placeholder="ຊື່ລາຍການ" value="${E(l.description)}">`}</td>
            <td><select class="input" data-i="${i}" data-k="kind">${Object.keys(KIND).map(k => `<option value="${k}" ${l.kind === k ? "selected" : ""}>${KIND[k]}</option>`).join("")}</select></td>
            <td style="width:90px"><input class="input num" type="number" min="0" data-i="${i}" data-k="qty" value="${l.qty}"></td>
            <td style="width:140px"><input class="input num" type="number" min="0" data-i="${i}" data-k="price" value="${l.price}"></td>
            <td>${lines.length > 1 ? `<button class="text-red-500" data-del="${i}">✕</button>` : ""}</td></tr>`).join("");
          const tot = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
          q("#nc-total").textContent = M(tot);
          q("#nc-chain").innerHTML = "✍️ <span>ຕ້ອງຜ່ານ: <b>" + Approval.chainLabels(Approval.chainFor("PURCHASE", tot)).map(E).join(" → ") + "</b> ແລ້ວຈຶ່ງໄປຝ່າຍຈັດຊື້</span>";
          bd.querySelectorAll("[data-k]").forEach(el => el.onchange = () => {
            const l = lines[+el.dataset.i], k = el.dataset.k;
            l[k] = (k === "qty" || k === "price") ? Number(el.value) || 0 : el.value;
            if (k === "item_id") { const it = Store.get("items", el.value); if (it) { l.kind = it.type === "stock" ? "stock" : "expense"; l.price = Number(it.buy_price) || l.price; l.description = it.name; } }
            draw();
          });
          bd.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { lines.splice(+b.dataset.del, 1); draw(); });
        }
        draw();
        q("#nc-add").onclick = () => { lines.push({ item_id: "", description: "", kind: "expense", qty: 1, price: 0 }); draw(); };
        const save = submitToo => {
          try {
            const c = Procure.create({ purpose: q("#nc-purpose").value, justification: q("#nc-just").value, requester: q("#nc-req").value, need_by: q("#nc-need").value, lines }, role());
            if (submitToo) Procure.submit(c.id, role());
            close(); UI.toast(submitToo ? "ສົ່ງ " + c.number + " ຂໍອະນຸມັດແລ້ວ" : "ບັນທຶກຮ່າງ " + c.number, "ok"); open(c.id);
          } catch (e) { UI.toast(e.message, "err"); }
        };
        q("#nc-draft").onclick = () => save(false);
        q("#nc-submit").onclick = () => save(true);
      } });
  }

  /* =================== DETAIL =================== */
  function detail(id) {
    const c = Store.get("purchase_requisitions", id), s = Procure.summary(c), n = Procure.nextAction(c, role());
    const amount = s.po ? s.po.total : s.est;
    view().innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div><a class="hint" href="#/procure">← ກັບໄປລາຍການຈັດຊື້</a>
          <h1 class="page-title mt-1">${E(c.number)} · ${E(c.purpose)}</h1>
          <p class="page-sub">${E(c.requester)} · ${E(UI.fmtDate(c.date))}${c.need_by ? " · ຕ້ອງການ " + E(UI.fmtDate(c.need_by)) : ""} · <b>${M(amount)}</b>${s.po ? " · " + E(vendorName(s.po.vendor_id)) : ""}</p></div>
        <div class="flex gap-2 items-center">${roleBar()}${chip(s.stage)}</div>
      </div>
      <div class="card p-4 mb-4">${stepper(s.stage)}</div>
      <div class="grid lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 space-y-4 min-w-0">
          <div id="next">${nextBox(c, s, n)}</div>
          ${itemsCard(s)}
        </div>
        <div class="space-y-4 min-w-0">${trailCard(s)}${bookingCard(s)}</div>
      </div>`;
    bindNext(c, s, n);
  }

  function chainHtml(c, s) {
    const cs = Approval.chainState(c, "PURCHASE", s.est);
    return `<div class="flex flex-wrap gap-2 mt-2">${cs.steps.map((s, i) => { const sig = cs.done.filter(d => d.step === i), ok = sig.length >= s.need; return `<span class="chip ${ok ? "s-done" : i === cs.step ? "s-wait" : "s-draft"}">${i + 1}. ${E(Approval.stepLabel(cs.chain[i]))}${sig.length ? " ✓ " + sig.map(d => E(d.name || d.role)).join(", ") : ""}${s.need > 1 && !ok ? " (" + sig.length + "/" + s.need + ")" : ""}</span>`; }).join('<span class="hint">→</span>')}</div>`;
  }
  function budgetHtml(c) {
    const b = Procure.budgetCheck(c.id);
    if (!b.length) return '<div class="booking mt-2">📊 <span>ບໍ່ມີງົບປະມານຕັ້ງໄວ້ສຳລັບລາຍການນີ້</span></div>';
    return b.map(x => `<div class="booking mt-2" style="${x.over ? "background:#fef2f2;border-color:#fca5a5" : ""}">📊 <span><b>${E(x.name)}</b>: ງົບ ${M(x.budget)} · ໃຊ້ແລ້ວ ${M(x.actual)} · ຜູກມັດ ${M(x.committed)} · ຂໍນີ້ ${M(x.request)} → <b>${x.over ? "ເກີນງົບ " + M(-x.remaining) : "ເຫຼືອ " + M(x.remaining)}</b></span></div>`).join("");
  }
  function waitBox(n) {
    return `<div class="next-box wait"><div class="nb-kicker">ຂັ້ນຕໍ່ໄປ</div><div class="nb-title">${E(n.label)}</div>
      <p class="text-sm text-slate-600">⏳ ${E(n.why || ("ລໍຖ້າ " + n.waitingFor.join(" / ")))}</p></div>`;
  }
  const note = (ph) => `<textarea class="input mt-3" id="nx-note" rows="2" placeholder="${E(ph)}"></textarea>`;
  const booking = st => `<div class="booking mt-3">📒 <span>${E(Procure.BOOKING[st])}</span></div>`;

  function nextBox(c, s, n) {
    const st = s.stage;
    if (st === "closed") return `<div class="next-box done"><div class="nb-kicker">ສຳເລັດ</div><div class="nb-title">✓ ຂະບວນການຄົບແລ້ວ</div><p class="text-sm text-slate-600">ຮັບເຄື່ອງ, ລົງບັນຊີ ແລະ ຈ່າຍເງິນຄົບຖ້ວນ.</p></div>`;
    if (Procure.ENDED[st]) return `<div class="next-box stop"><div class="nb-kicker">ສິ້ນສຸດ</div><div class="nb-title">${E(Procure.ENDED[st])}</div></div>`;
    if (!n.allowed) return waitBox(n);
    const head = (title, sub) => `<div class="nb-kicker">ທ່ານຕ້ອງເຮັດ</div><div class="nb-title">${E(title)}</div>${sub ? `<p class="text-sm text-slate-600">${sub}</p>` : ""}`;

    if (st === "draft") return `<div class="next-box">${head("ສົ່ງຂໍອະນຸມັດ", "ກວດລາຍການດ້ານລຸ່ມ ແລ້ວສົ່ງໃຫ້ຫົວໜ້າອະນຸມັດ")}
      <div class="flex flex-wrap gap-2 mt-3"><button class="btn btn-primary btn-lg" id="nx-go">ສົ່ງຂໍອະນຸມັດ →</button><button class="btn btn-ghost" id="nx-cancel">ຍົກເລີກໃບນີ້</button></div>${booking(st)}</div>`;

    if (st === "pr_approval") return `<div class="next-box">${head("ອະນຸມັດການຂໍຊື້?", "ຍອດປະມານ <b>" + M(s.est) + "</b> · " + s.lines.length + " ລາຍການ")}${chainHtml(c, s)}${c.justification ? `<div class="booking mt-2">💬 <span>${E(c.justification)}</span></div>` : ""}${budgetHtml(c)}
      ${note("ໝາຍເຫດ (ຈຳເປັນ ຖ້າສົ່ງຄືນ ຫຼື ປະຕິເສດ)")}
      <div class="flex flex-wrap gap-2 mt-3"><button class="btn btn-ok btn-lg" id="nx-go">✓ ອະນຸມັດ</button><button class="btn btn-ghost" id="nx-return">↩ ສົ່ງຄືນໃຫ້ແກ້</button><button class="btn btn-danger" id="nx-reject">✕ ປະຕິເສດ</button></div>${booking(st)}</div>`;

    if (st === "sourcing") {
      const rule = Procure.quoteRule(c.id), sel = s.quotes.find(q => q.selected);
      const cheapest = s.quotes.length ? Math.min.apply(null, s.quotes.map(q => Number(q.amount))) : 0;
      const needReason = rule.have < rule.required || (sel && Number(sel.amount) > cheapest);
      const vends = Store.all("vendors");
      return `<div class="next-box">${head("ເກັບໃບສະເໜີລາຄາ ແລ້ວສ້າງ PO", "ຍອດນີ້ຕ້ອງການ <b>" + rule.required + "</b> ໃບສະເໜີ · ມີແລ້ວ <b>" + rule.have + "</b>")}
        ${s.quotes.length ? `<div class="overflow-x-auto mt-3"><table class="data"><thead><tr><th></th><th>ຜູ້ສະໜອງ</th><th class="num">ລາຄາ</th><th class="num">ສົ່ງ (ວັນ)</th><th></th></tr></thead><tbody>
          ${s.quotes.map(q => `<tr><td><input type="radio" name="nx-q" value="${q.id}" ${q.selected ? "checked" : ""}></td><td>${E(vendorName(q.vendor_id))}${Number(q.amount) === cheapest ? ' <span class="chip s-done">ຖືກສຸດ</span>' : ""}<div class="hint">${E(q.note)}</div></td><td class="num">${M(q.amount)}</td><td class="num">${q.days || "-"}</td><td><button class="text-red-500" data-rmq="${q.id}">✕</button></td></tr>`).join("")}
        </tbody></table></div>` : ""}
        <div class="grid sm:grid-cols-4 gap-2 mt-3 items-end">
          <div class="sm:col-span-2"><label class="field">ຜູ້ສະໜອງ</label><select class="input" id="nx-v">${vends.map(v => `<option value="${v.id}">${E(v.name)}</option>`).join("")}</select></div>
          <div><label class="field">ລາຄາລວມ</label><input class="input num" type="number" id="nx-amt" value="${s.est || ""}"></div>
          <div><label class="field">ສົ່ງພາຍໃນ (ວັນ)</label><input class="input num" type="number" id="nx-days"></div>
        </div>
        <div class="flex justify-end mt-2"><button class="btn btn-ghost btn-sm" id="nx-addq">＋ ເພີ່ມໃບສະເໜີ</button></div>
        ${needReason ? `<label class="field mt-2">ເຫດຜົນ (ໃບສະເໜີບໍ່ຄົບ ຫຼື ບໍ່ເລືອກລາຄາຖືກສຸດ) *</label><textarea class="input" id="nx-reason" rows="2"></textarea>` : ""}
        <div class="flex flex-wrap gap-2 mt-3"><button class="btn btn-primary btn-lg" id="nx-go" ${sel ? "" : "disabled"}>ສ້າງ PO ຈາກໃບທີ່ເລືອກ →</button><button class="btn btn-ghost" id="nx-cancel">ຍົກເລີກ</button></div>${booking(st)}</div>`;
    }

    if (st === "po_approval") return `<div class="next-box">${head("ອະນຸມັດ PO " + E(s.po.number) + "?", E(vendorName(s.po.vendor_id)) + " · <b>" + M(s.po.total) + "</b>" + (Number(s.po.total) > Number(s.est) ? ' · <span class="text-amber-600">ສູງກວ່າທີ່ຂໍ ' + M(Number(s.po.total) - Number(s.est)) + "</span>" : ""))}
      ${note("ໝາຍເຫດ (ຈຳເປັນ ຖ້າປະຕິເສດ)")}
      <div class="flex flex-wrap gap-2 mt-3"><button class="btn btn-ok btn-lg" id="nx-go">✓ ອະນຸມັດ PO</button><button class="btn btn-danger" id="nx-reject">✕ ປະຕິເສດ (ກັບໄປຫາລາຄາ)</button><button class="btn btn-ghost" id="nx-print">🖨 ເບິ່ງ PO</button></div>${booking(st)}</div>`;

    if (st === "receiving") return `<div class="next-box">${head("ຮັບເຄື່ອງເຂົ້າ", "ໃສ່ຈຳນວນທີ່ໄດ້ຮັບແທ້ — ຮັບບາງສ່ວນກໍໄດ້")}
      <div class="overflow-x-auto mt-3"><table class="data"><thead><tr><th>ລາຍການ</th><th class="num">ສັ່ງ</th><th class="num">ຮັບແລ້ວ</th><th class="num">ຮັບຄັ້ງນີ້</th></tr></thead><tbody>
        ${s.poLines.map(l => { const rem = Number(l.qty) - Number(l.received_qty || 0); return `<tr><td>${E(l.description)}<div class="hint">${E(KIND[l.kind] || "")}</div></td><td class="num">${l.qty}</td><td class="num">${l.received_qty || 0}</td><td style="width:110px"><input class="input num" type="number" min="0" max="${rem}" data-rcv="${l.id}" value="${rem}" ${rem <= 0 ? "disabled" : ""}></td></tr>`; }).join("")}
      </tbody></table></div>
      <div class="grid sm:grid-cols-2 gap-2 mt-3"><div><label class="field">ວັນທີຮັບ</label><input class="input" type="date" id="nx-date" value="${UI.today()}"></div></div>
      <div class="flex flex-wrap gap-2 mt-3"><button class="btn btn-primary btn-lg" id="nx-go">📦 ຮັບເຄື່ອງ & ລົງບັນຊີ</button>
        ${s.poLines.some(l => Number(l.received_qty) > 0) ? `<button class="btn btn-ghost" id="nx-short">ປິດການຮັບ (ຜູ້ສະໜອງບໍ່ສົ່ງສ່ວນທີ່ເຫຼືອ)</button>` : ""}</div>${booking(st)}</div>`;

    if (st === "invoicing") return `<div class="next-box">${head("ບັນທຶກບິນຂອງຜູ້ສະໜອງ", "ລະບົບຕື່ມຈຳນວນ/ລາຄາຕາມ PO ໃຫ້ — ແກ້ສະເພາະທີ່ບິນຕ່າງ. ລະບົບຈະກວດ 3-way match (PO · ຮັບເຄື່ອງ · ບິນ)")}
      <div class="grid sm:grid-cols-3 gap-2 mt-3">
        <div><label class="field">ເລກທີ່ບິນຜູ້ສະໜອງ *</label><input class="input" id="nx-ref"></div>
        <div><label class="field">ວັນທີບິນ</label><input class="input" type="date" id="nx-date" value="${UI.today()}"></div>
        <div><label class="field">VAT</label><label class="flex items-center gap-2 mt-2 text-sm"><input type="checkbox" id="nx-vat" checked> ມີ VAT 10%</label></div>
      </div>
      <div class="overflow-x-auto mt-3"><table class="data"><thead><tr><th>ລາຍການ</th><th class="num">ຈຳນວນ</th><th class="num">ຍອດເງິນຕາມບິນ (ກ່ອນ VAT)</th><th class="num">ຕາມ PO</th></tr></thead><tbody>
        ${s.poLines.map(l => { const open = Number(l.received_qty || 0) - Number(l.billed_qty || 0); return open <= 0 ? "" : `<tr><td>${E(l.description)}</td><td style="width:100px"><input class="input num" type="number" data-bq="${l.id}" value="${open}"></td><td style="width:170px"><input class="input num" type="number" data-bp="${l.id}" data-po-price="${l.price}" value="${Math.round(open * l.price)}"></td><td class="num hint">${M(Math.round(open * l.price))}</td></tr>`; }).join("")}
      </tbody></table></div>
      <div class="flex flex-wrap gap-2 mt-3"><button class="btn btn-primary btn-lg" id="nx-go">🧾 ບັນທຶກບິນ & ລົງບັນຊີ</button></div>${booking(st)}</div>`;

    if (st === "paying") {
      const due = s.bills.filter(b => b.status === "posted" || b.status === "partial").reduce((t, b) => t + Number(b.total) - Number(b.paid || 0), 0);
      const banks = Store.all("bank_accounts");
      return `<div class="next-box">${head("ຈ່າຍເງິນຜູ້ສະໜອງ", "ຍອດຄ້າງ <b>" + M(due) + "</b> · " + E(vendorName(s.po.vendor_id)))}
        <div class="grid sm:grid-cols-3 gap-2 mt-3">
          <div><label class="field">ຈ່າຍຈາກ</label><select class="input" id="nx-bank">${banks.map(b => `<option value="${b.id}">${E(b.name)}</option>`).join("")}</select></div>
          <div><label class="field">ຈຳນວນ</label><input class="input num" type="number" id="nx-amt" value="${Acc.round(due)}"></div>
          <div><label class="field">ວັນທີ</label><input class="input" type="date" id="nx-date" value="${UI.today()}"></div>
        </div>
        <div class="flex gap-2 mt-3"><button class="btn btn-primary btn-lg" id="nx-go">💸 ຈ່າຍເງິນ</button></div>${booking(st)}</div>`;
    }
    return waitBox(n);
  }

  function bindNext(c, s, n) {
    const q = sel => view().querySelector(sel), r = role(), noteV = () => (q("#nx-note") ? q("#nx-note").value : "");
    const on = (sel, fn) => { const el = q(sel); if (el) el.onclick = fn; };
    const st = s.stage;
    if (st === "draft") { on("#nx-go", () => act(() => Procure.submit(c.id, r), "ສົ່ງຂໍອະນຸມັດແລ້ວ")); }
    if (st === "pr_approval") {
      on("#nx-go", () => act(() => Procure.approvePR(c.id, r, noteV()), "ອະນຸມັດແລ້ວ — ສົ່ງຕໍ່ຝ່າຍຈັດຊື້"));
      on("#nx-return", () => act(() => Procure.returnPR(c.id, r, noteV()), "ສົ່ງຄືນໃຫ້ຜູ້ຂໍແກ້ແລ້ວ"));
      on("#nx-reject", () => act(() => Procure.rejectPR(c.id, r, noteV()), "ປະຕິເສດແລ້ວ"));
    }
    if (st === "sourcing") {
      on("#nx-addq", () => act(() => Procure.addQuote(c.id, { vendor_id: q("#nx-v").value, amount: Number(q("#nx-amt").value), days: Number(q("#nx-days").value) }, r), "ເພີ່ມໃບສະເໜີແລ້ວ"));
      view().querySelectorAll("[name=nx-q]").forEach(el => el.onchange = () => act(() => Procure.selectQuote(c.id, el.value, r)));
      view().querySelectorAll("[data-rmq]").forEach(b => b.onclick = () => act(() => Procure.removeQuote(c.id, b.dataset.rmq, r)));
      on("#nx-go", () => act(() => { const po = Procure.createPO(c.id, r, q("#nx-reason") ? q("#nx-reason").value : ""); UI.toast("ສ້າງ " + po.number + " — ລໍອະນຸມັດ", "ok"); }));
    }
    on("#nx-cancel", () => UI.confirmDialog("ຍົກເລີກ " + c.number + "?", () => act(() => Procure.cancel(c.id, r, "ຍົກເລີກ"), "ຍົກເລີກແລ້ວ")));
    if (st === "po_approval") {
      on("#nx-go", () => act(() => Procure.approvePO(c.id, r, noteV()), "ອະນຸມັດ PO ແລ້ວ — ລໍຮັບເຄື່ອງ"));
      on("#nx-reject", () => act(() => Procure.rejectPO(c.id, r, noteV()), "ປະຕິເສດ PO — ກັບໄປຫາລາຄາ"));
      on("#nx-print", () => window.AppCtx.poPrint && window.AppCtx.poPrint(s.po));
    }
    if (st === "receiving") {
      on("#nx-go", () => act(() => {
        const receipt = Array.from(view().querySelectorAll("[data-rcv]")).map(el => ({ po_line_id: el.dataset.rcv, qty: Number(el.value) || 0 }));
        const g = Procure.receive(c.id, r, { date: q("#nx-date").value, receipt });
        UI.toast(g.number + " ລົງບັນຊີແລ້ວ " + M(g.total), "ok");
      }));
      on("#nx-short", () => {
        UI.modal("ປິດການຮັບ (ຮັບບໍ່ຄົບ)", `<p class="text-sm mb-2">ສ່ວນທີ່ຍັງບໍ່ໄດ້ຮັບ ຈະບໍ່ຖືກບິນ ແລະ ບໍ່ຈ່າຍ.</p><textarea class="input" id="sc-note" rows="2" placeholder="ເຫດຜົນ *"></textarea>
          <div class="flex justify-end gap-2 mt-3"><button class="btn btn-ghost" data-x>ຍົກເລີກ</button><button class="btn btn-primary" id="sc-go">ປິດການຮັບ</button></div>`,
          { onMount: (bd, close) => { bd.querySelector("[data-x]").onclick = close; bd.querySelector("#sc-go").onclick = () => { close(); act(() => Procure.shortClose(c.id, r, bd.querySelector("#sc-note").value), "ປິດການຮັບແລ້ວ — ໄປຂັ້ນບິນ"); }; } });
      });
    }
    if (st === "invoicing") {
      on("#nx-go", () => {
        let bill;
        try {
          const lines = Array.from(view().querySelectorAll("[data-bq]")).map(el => { const qty = Number(el.value) || 0, amt = Number(view().querySelector(`[data-bp="${el.dataset.bq}"]`).value) || 0; return { po_line_id: el.dataset.bq, qty, price: qty ? amt / qty : 0 }; });
          bill = Procure.prepareBill(c.id, r, { vendor_ref: q("#nx-ref").value, date: q("#nx-date").value, vat: q("#nx-vat").checked, lines });
        } catch (e) { return UI.toast(e.message, "err"); }
        // the Guard runs the 3-way match (+ duplicate checks); cancelling removes the draft bill
        window.AppCtx.guardedPost("bill", bill,
          () => act(() => Procure.finishBill(c.id, bill.id, r), "ບັນທຶກບິນ " + bill.number + " ແລ້ວ"),
          { onCancel: () => { Procure.discardBill(bill.id); render(); } });
      });
    }
    if (st === "paying") {
      on("#nx-go", () => act(() => Procure.pay(c.id, r, { bank_id: q("#nx-bank").value, amount: Number(q("#nx-amt").value), date: q("#nx-date").value }), "ຈ່າຍເງິນແລ້ວ"));
    }
  }

  function itemsCard(s) {
    const lines = s.poLines.length ? s.poLines : s.lines;
    return `<div class="card p-5"><div class="section-title">ລາຍການ</div><div class="overflow-x-auto"><table class="data"><thead><tr><th>ລາຍການ</th><th>ປະເພດ</th><th class="num">ຈຳນວນ</th><th class="num">ຍອດ</th>${s.poLines.length ? '<th class="num">ຮັບ</th><th class="num">ບິນ</th>' : ""}</tr></thead><tbody>
      ${lines.map(l => `<tr><td>${E(l.description)}</td><td>${E(KIND[l.kind] || "")}</td><td class="num">${l.qty}</td><td class="num">${M(l.line_total != null ? l.line_total : l.qty * l.price)}</td>${s.poLines.length ? `<td class="num">${l.received_qty || 0}</td><td class="num">${l.billed_qty || 0}</td>` : ""}</tr>`).join("")}
    </tbody></table></div></div>`;
  }
  function trailCard(s) {
    return `<div class="card p-5"><div class="section-title">ປະຫວັດ (ໃຜເຮັດຫຍັງ)</div><ul class="timeline">
      ${s.history.map(h => `<li><b>${E(DID[h.action] || h.action)}</b> · ${E(h.role)}${h.note ? `<div class="text-slate-600">${E(h.note)}</div>` : ""}<div class="t-when">${E(h.ts.slice(0, 16).replace("T", " "))}</div></li>`).join("") || '<li class="hint">—</li>'}
    </ul></div>`;
  }
  function bookingCard(s) {
    const jes = s.grns.map(g => ["ຮັບເຄື່ອງ " + g.number, g.total]).concat(s.bills.map(b => ["ບິນ " + b.number, b.total]));
    return `<div class="card p-5"><div class="section-title">ການລົງບັນຊີ</div>
      <div class="text-sm space-y-2">
        <div class="booking">1–4 · ຂໍຊື້, ສະເໜີ, PO: <b>ບໍ່ລົງບັນຊີ</b></div>
        <div class="booking">5 · ຮັບເຄື່ອງ: Dr ສິນຄ້າ/ຄ່າໃຊ້ຈ່າຍ/ຊັບສິນ · Cr GR/IR</div>
        <div class="booking">6 · ບິນ: Dr GR/IR + VAT · Cr ເຈົ້າໜີ້</div>
        <div class="booking">7 · ຈ່າຍ: Dr ເຈົ້າໜີ້ · Cr ທະນາຄານ</div>
      </div>
      ${jes.length ? `<div class="mt-3 text-sm">${jes.map(j => `<div class="flex justify-between border-t border-slate-100 py-1"><span>${E(j[0])}</span><b>${M(j[1])}</b></div>`).join("")}</div>` : ""}
    </div>`;
  }

  window.ProcureUI = { page: render, newCase };
})();
