/* ============================================================
   LaoBooks ERP – Requests & approvals screens (action-first UI)
   One page for: ເບີກເງິນສຳຮອງ · ເຄລຍເງິນສຳຮອງ · ຂໍເບີກຈ່າຍ / ເບີກຄືນ
   + the approval-matrix editor used by Settings.
   Uses Flows / Approval (logic), UI, Store, Acc, window.AppCtx (currentRole, canApprove).
   ============================================================ */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s)), M = v => UI.money(v);
  const view = () => document.getElementById("view");
  const role = () => window.AppCtx.currentRole();
  const params = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const open = id => { location.hash = id ? "#/requests?id=" + id : "#/requests"; };
  const ROLES = ["Manager", "Accountant", "Admin", "Purchasing", "HR", "Cashier"];
  const DID = { docs: "ແນບເອກະສານ", create: "ສ້າງ", submit: "ສົ່ງຂໍອະນຸມັດ", approve: "ອະນຸມັດ", reject: "ປະຕິເສດ", cancel: "ຍົກເລີກ", post: "ລົງບັນຊີອັດຕະໂນມັດ", pay: "ຈ່າຍເງິນ", refund: "ຮັບເງິນຄືນ" };
  const STEPS = {
    ADV: [["draft", "ຂໍ"], ["approval", "ອະນຸມັດ"], ["payout", "ຈ່າຍເງິນ"], ["open", "ລໍເຄລຍ"], ["closed", "ເຄລຍແລ້ວ"]],
    CLR: [["draft", "ຍື່ນໃບບິນ"], ["approval", "ອະນຸມັດ"], ["settle", "ຄືນ / ຈ່າຍເພີ່ມ"], ["closed", "ສຳເລັດ"]],
    PAY: [["draft", "ຂໍ"], ["approval", "ອະນຸມັດ"], ["payout", "ຈ່າຍເງິນ"], ["closed", "ສຳເລັດ"]]
  };
  const BOOK = {
    ADV: ["ອະນຸມັດ: ບໍ່ລົງບັນຊີ", "ຈ່າຍເງິນ: Dr ເງິນສຳຮອງພະນັກງານ · Cr ເງິນສົດ/ທະນາຄານ"],
    CLR: ["ອະນຸມັດ: Dr ຄ່າໃຊ້ຈ່າຍ + VAT · Cr ເງິນສຳຮອງພະນັກງານ", "ໃຊ້ບໍ່ໝົດ: Dr ເງິນສົດ · Cr ເງິນສຳຮອງ", "ໃຊ້ເກີນ: Dr ຄ້າງຈ່າຍພະນັກງານ · Cr ເງິນສົດ"],
    PAY: ["ອະນຸມັດ (ຜູ້ສະໜອງ): ສ້າງ Bill — Dr ຄ່າໃຊ້ຈ່າຍ + VAT · Cr ເຈົ້າໜີ້", "ອະນຸມັດ (ພະນັກງານ): Dr ຄ່າໃຊ້ຈ່າຍ + VAT · Cr ຄ້າງຈ່າຍພະນັກງານ", "ຈ່າຍເງິນ: Dr ເຈົ້າໜີ້/ຄ້າງຈ່າຍ · Cr ທະນາຄານ"]
  };
  // generic (voucher) types share one simple 3-step path
  Object.keys(Flows.VDEFS).forEach(k => { STEPS[k] = [["draft", "ຂໍ"], ["approval", "ອະນຸມັດ & ລົງບັນຊີ"], ["closed", "ສຳເລັດ"]]; BOOK[k] = [Flows.VDEFS[k].book]; });
  let filter = "mine";

  function act(fn, ok) { try { fn(); if (ok) UI.toast(ok, "ok"); render(); } catch (e) { UI.toast(e.message, "err"); } }
  function render() { const id = params().get("id"); if (id && Store.get("requests", id)) detail(id); else list(); }
  const expAccounts = () => Store.where("accounts", a => !a.is_header && a.type === "Expense" && a.code !== "5100");
  const banks = () => Store.all("bank_accounts");
  const chipCls = st => st === "draft" ? "s-draft" : st === "approval" ? "s-wait" : st === "closed" ? "s-done" : Flows.ENDED[st] ? "s-bad" : "s-run";
  const chip = r => `<span class="chip ${chipCls(r.stage)}">${E(Flows.STAGE_LABEL[r.stage] || r.stage)}</span>`;
  const typeTag = r => `${Flows.TYPES[r.type].icon} ${E(Flows.TYPES[r.type].label)}`;

  function stepper(r) {
    const steps = STEPS[r.type];
    const map = { refund: "settle", payout: r.type === "CLR" ? "settle" : "payout" };
    const cur = r.stage === "closed" ? steps.length - 1 : steps.findIndex(s => s[0] === (map[r.stage] || r.stage));
    const bad = r.stage === "rejected" || r.stage === "cancelled";
    return `<div class="stepper">${steps.map((s, i) => {
      const cls = bad ? (i === Math.max(cur, 1) ? "bad" : i < 1 ? "done" : "") : (i < cur || r.stage === "closed") ? "done" : i === cur ? "cur" : "";
      return `<div class="step ${cls}"><div class="dot">${cls === "done" ? "✓" : cls === "bad" ? "✕" : i + 1}</div>${E(s[1])}</div>`;
    }).join("")}</div>`;
  }
  function chainView(r) {
    const st = Approval.chainState(r, r.type, Flows.amountOf(r));
    return `<div class="flex flex-wrap gap-2 mt-2">${st.chain.map((c, i) => {
      const d = st.done[i];
      return `<span class="chip ${d ? "s-done" : i === st.step ? "s-wait" : "s-draft"}">${i + 1}. ${E(c)}${d ? " ✓" + (d.role !== c ? " (" + E(d.role) + ")" : "") : ""}</span>`;
    }).join('<span class="hint">→</span>')}</div>`;
  }

  /* =================== LIST =================== */
  function list() {
    const r = role(), all = Store.all("requests").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const queue = Flows.queue(r), drafts = all.filter(x => x.stage === "draft" && x.requester_role === r);
    const mine = queue.concat(drafts);
    const overdue = Flows.overdueAdvances();
    const sets = { mine, open: all.filter(x => !Flows.ENDED[x.stage]), ADV: all.filter(x => x.type === "ADV"), CLR: all.filter(x => x.type === "CLR"), PAY: all.filter(x => x.type === "PAY"), all };
    const rows = sets[filter] || all;
    view().innerHTML = UI.pageHead("ຄຳຂໍ & ອະນຸມັດ", "ເບີກເງິນສຳຮອງ · ເຄລຍເງິນສຳຮອງ · ຂໍເບີກຈ່າຍ — ອະນຸມັດຄົບແລ້ວ ລະບົບລົງບັນຊີໃຫ້ເອງ",
      `<span class="role-pill">👤 ບົດບາດ: ${E(r)}</span><button class="btn btn-primary btn-lg" id="rq-new">＋ ຄຳຂໍໃໝ່</button>`) +
      (overdue.length ? `<div class="ac-card danger mb-4"><div class="ac-ic">⏰</div><div class="ac-body"><div class="ac-title">ເງິນສຳຮອງເກີນກຳນົດເຄລຍ ${overdue.length} ໃບ</div><div class="ac-meta">${E(overdue.map(x => x.number + " " + x.payee + " (" + x.due_clear + ")").join(" · "))}</div></div><button class="btn btn-primary" data-new="CLR">ເຄລຍດຽວນີ້ →</button></div>` : "") +
      `<div class="section-title">ລໍຖ້າທ່ານ <span class="count ${mine.length ? "" : "zero"}">${mine.length}</span></div>` +
      (mine.length ? `<div class="ac-list cols mb-6">${mine.slice(0, 6).map(card).join("")}</div>` : `<div class="ac-empty mb-6">✓ ບໍ່ມີຄຳຂໍລໍທ່ານ</div>`) +
      `<div class="seg mb-3">${[["mine", "ລໍຂ້ອຍ"], ["open", "ກຳລັງດຳເນີນ"], ["ADV", "ເງິນສຳຮອງ"], ["CLR", "ເຄລຍ"], ["PAY", "ເບີກຈ່າຍ"], ["all", "ທັງໝົດ"]].map(([k, t]) => `<button data-f="${k}" class="${filter === k ? "on" : ""}">${t} (${sets[k].length})</button>`).join("")}</div>` +
      (rows.length ? UI.table([
        { h: "ເລກທີ", render: x => `<a class="font-semibold text-brand-700" href="#/requests?id=${x.id}">${E(x.number)}</a><div class="hint">${typeTag(x)}</div>` },
        { h: "ລາຍລະອຽດ", render: x => `${E(x.purpose)}<div class="hint">${E(x.payee || "")}</div>` },
        { h: "ຍອດ", cls: "num", render: x => M(Flows.amountOf(x)) },
        { h: "ສະຖານະ", render: x => chip(x) + (x.type === "ADV" && x.stage === "open" ? `<div class="hint">ກຳນົດເຄລຍ ${E(x.due_clear)}</div>` : "") },
        { h: "ຂັ້ນຕໍ່ໄປ", render: x => { const n = Flows.nextAction(x, r); return Flows.ENDED[x.stage] ? '<span class="hint">—</span>' : n.allowed ? `<button class="btn btn-primary btn-sm" data-open="${x.id}">${E(n.label)} →</button>` : `<span class="hint">${E(n.why)}</span>`; } }
      ], rows) : `<div class="card p-8 text-center text-slate-500">ຍັງບໍ່ມີ — ກົດ <b>＋ ຄຳຂໍໃໝ່</b></div>`);
    view().querySelector("#rq-new").onclick = () => newRequest();
    view().querySelectorAll("[data-new]").forEach(b => b.onclick = () => newRequest(b.dataset.new));
    view().querySelectorAll("[data-f]").forEach(b => b.onclick = () => { filter = b.dataset.f; list(); });
    view().querySelectorAll("[data-open]").forEach(b => b.onclick = () => open(b.dataset.open));
  }
  function card(x) {
    const n = Flows.nextAction(x, role());
    return `<div class="ac-card ${x.stage === "approval" ? "warn" : ""}"><div class="ac-ic">${Flows.TYPES[x.type].icon}</div>
      <div class="ac-body"><div class="ac-title">${E(x.number)} · ${E(x.purpose)}</div><div class="ac-meta">${E(x.payee || "")} · ${M(Flows.amountOf(x))}</div></div>
      <button class="btn btn-primary" data-open="${x.id}">${E(n.label)} →</button></div>`;
  }

  /* =================== NEW REQUEST =================== */
  function newRequest(preset) {
    let type = preset || "PAY", lines = [{ account: "5200", description: "", amount: 0, vat: false, receipt_no: "" }];
    const emps = Store.all("employees").map(e => e.name);
    const vends = Store.all("vendors");
    UI.modal("ຄຳຂໍໃໝ່", `
      <div class="seg mb-4" id="rq-types">${Object.keys(Flows.TYPES).map(k => `<button data-t="${k}">${Flows.TYPES[k].icon} ${E(Flows.TYPES[k].label)}</button>`).join("")}</div>
      <div id="rq-form"></div>
      <div class="booking mt-3" id="rq-chain"></div>
      <div class="flex flex-wrap justify-end gap-2 mt-4"><button class="btn btn-ghost" id="rq-draft">ບັນທຶກຮ່າງ</button><button class="btn btn-primary btn-lg" id="rq-submit">ສົ່ງຂໍອະນຸມັດ →</button></div>
      <datalist id="rq-emps">${emps.map(n => `<option value="${E(n)}">`).join("")}</datalist>`, { wide: true, onMount: (bd, close) => {
        const q = s => bd.querySelector(s);
        const linesTable = () => `<div class="overflow-x-auto mt-3"><table class="data"><thead><tr><th>ໝວດຄ່າໃຊ້ຈ່າຍ</th><th>ລາຍລະອຽດ</th><th>ເລກທີ່ບິນ *</th><th class="num">ຍອດຕາມບິນ</th><th>VAT</th><th></th></tr></thead><tbody>
          ${lines.map((l, i) => `<tr><td style="min-width:170px"><select class="input" data-i="${i}" data-k="account">${expAccounts().map(a => `<option value="${a.code}" ${a.code === l.account ? "selected" : ""}>${E(a.name)}</option>`).join("")}</select></td>
            <td><input class="input" data-i="${i}" data-k="description" value="${E(l.description)}"></td>
            <td style="width:120px"><input class="input" data-i="${i}" data-k="receipt_no" value="${E(l.receipt_no)}"></td>
            <td style="width:130px"><input class="input num" type="number" data-i="${i}" data-k="amount" value="${l.amount || ""}"></td>
            <td><input type="checkbox" data-i="${i}" data-k="vat" ${l.vat ? "checked" : ""} title="ຍອດລວມ VAT 10% ແລ້ວ"></td>
            <td>${lines.length > 1 ? `<button class="text-red-500" data-del="${i}">✕</button>` : ""}</td></tr>`).join("")}
          </tbody></table></div><div class="flex justify-between items-center mt-2"><button class="btn btn-ghost btn-sm" id="rq-add">＋ ເພີ່ມລາຍການ</button><div>ລວມ: <b id="rq-total"></b></div></div>
          <p class="hint mt-1">ໃສ່ຍອດເງິນຕາມໃບບິນ. ໝາຍ VAT ຖ້າໃບບິນມີ VAT 10% ລວມຢູ່ — ລະບົບແຍກ VAT ຊື້ໃຫ້ເອງ.</p>`;
        const total = () => type === "ADV" || Flows.VDEFS[type] ? Number((q("#rq-amt") || {}).value) || 0 : lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
        function refreshChain() {
          const t = total();
          if (q("#rq-total")) q("#rq-total").textContent = M(t);
          let extra = "";
          if (type === "CLR" && q("#rq-adv") && q("#rq-adv").value) {
            const adv = Store.get("requests", q("#rq-adv").value), d = Acc.round(Number(adv.amount) - t);
            extra = " · ເງິນສຳຮອງ " + M(adv.amount) + (d > 0 ? " → ພະນັກງານຕ້ອງຄືນ <b>" + M(d) + "</b>" : d < 0 ? " → ບໍລິສັດຈ່າຍເພີ່ມ <b>" + M(-d) + "</b>" : " → ພໍດີ");
          }
          q("#rq-chain").innerHTML = "✍️ <span>ຕ້ອງຜ່ານ: <b>" + Approval.chainFor(type, t).map(E).join(" → ") + "</b>" + extra + "</span>";
        }
        function draw() {
          bd.querySelectorAll("#rq-types [data-t]").forEach(b => b.classList.toggle("on", b.dataset.t === type));
          const openAdv = Flows.openAdvances().filter(a => !Store.where("requests", x => x.type === "CLR" && x.advance_id === a.id && !Flows.ENDED[x.stage]).length);
          let f = `<div class="grid sm:grid-cols-2 gap-3"><div class="sm:col-span-2"><label class="field">ຈຸດປະສົງ *</label><input class="input" id="rq-purpose" placeholder="${type === "ADV" ? "ເຊັ່ນ: ເດີນທາງໄປປາກເຊ ກວດສາຂາ" : type === "CLR" ? "ເຊັ່ນ: ເຄລຍຄ່າເດີນທາງປາກເຊ" : "ເຊັ່ນ: ຄ່າໄຟເດືອນ 9"}"></div>`;
          if (type === "ADV") f += `<div><label class="field">ຜູ້ເບີກ *</label><input class="input" id="rq-payee" list="rq-emps" value="${E(role())}"></div><div><label class="field">ຈຳນວນເງິນ *</label><input class="input num" type="number" id="rq-amt"></div></div>
            <p class="hint mt-2">ຕ້ອງເຄລຍພາຍໃນ ${Flows.settings().clear_days} ວັນຫຼັງຮັບເງິນ. ຖ້າມີເງິນສຳຮອງຄ້າງເກີນກຳນົດ ຈະເບີກໃໝ່ບໍ່ໄດ້.</p>`;
          if (type === "CLR") f += `<div class="sm:col-span-2"><label class="field">ເງິນສຳຮອງທີ່ຈະເຄລຍ *</label><select class="input" id="rq-adv">${openAdv.length ? openAdv.map(a => `<option value="${a.id}">${E(a.number)} · ${E(a.payee)} · ${M(a.amount)} · ກຳນົດ ${E(a.due_clear)}</option>`).join("") : '<option value="">— ບໍ່ມີເງິນສຳຮອງຄ້າງເຄລຍ —</option>'}</select></div></div>` + linesTable();
          if (type === "PAY") f += `<div><label class="field">ຈ່າຍໃຫ້</label><select class="input" id="rq-ptype"><option value="vendor">ຜູ້ສະໜອງ (ມີບິນ)</option><option value="employee">ພະນັກງານ (ເບີກຄືນ)</option></select></div>
            <div id="rq-pwrap"><label class="field">ຜູ້ສະໜອງ *</label><select class="input" id="rq-vendor">${vends.map(v => `<option value="${v.id}">${E(v.name)}</option>`).join("")}</select></div></div>` + linesTable();
          if (Flows.VDEFS[type]) f += genericFields(type);
          q("#rq-form").innerHTML = f;
          bindForm(); refreshChain();
        }
        // fields + document checklist of a generic type
        function genericFields(t) {
          const def = Flows.VDEFS[t], cb = Flows.cashBankAccounts(), ex = expAccounts();
          const opts = list => list.map(a => `<option value="${E(a.code)}">${E(a.code + " " + a.name)}</option>`).join("");
          // continues the grid opened with the purpose field in draw()
          return def.fields.map(x => `<div><label class="field">${E(x.label)}</label>${
            x.type === "number" ? `<input class="input num" type="number" id="rq-amt" min="0">` : `<select class="input" data-gf="${x.k}">${opts(x.type === "expense" ? ex : cb)}</select>`}</div>`).join("") +
            `<div class="sm:col-span-2">${docsPanel(def.docs.map(d => ({ key: d.key, label: d.label, ok: false, ref: "" })), true)}</div></div>`;
        }
        function bindForm() {
          bd.querySelectorAll("#rq-form [data-k]").forEach(el => el.onchange = el.oninput = () => {
            const l = lines[+el.dataset.i], k = el.dataset.k;
            l[k] = k === "vat" ? el.checked : k === "amount" ? Number(el.value) || 0 : el.value;
            refreshChain();
          });
          bd.querySelectorAll("#rq-form [data-del]").forEach(b => b.onclick = () => { lines.splice(+b.dataset.del, 1); draw(); });
          if (q("#rq-add")) q("#rq-add").onclick = () => { lines.push({ account: "5200", description: "", amount: 0, vat: false, receipt_no: "" }); draw(); };
          if (q("#rq-amt")) q("#rq-amt").oninput = refreshChain;
          if (q("#rq-adv")) q("#rq-adv").onchange = refreshChain;
          if (q("#rq-ptype")) q("#rq-ptype").onchange = () => {
            q("#rq-pwrap").innerHTML = q("#rq-ptype").value === "vendor"
              ? `<label class="field">ຜູ້ສະໜອງ *</label><select class="input" id="rq-vendor">${vends.map(v => `<option value="${v.id}">${E(v.name)}</option>`).join("")}</select>`
              : `<label class="field">ພະນັກງານ *</label><input class="input" id="rq-payee" list="rq-emps" value="${E(role())}">`;
          };
        }
        bd.querySelectorAll("#rq-types [data-t]").forEach(b => b.onclick = () => { type = b.dataset.t; draw(); });
        const save = submitToo => {
          try {
            const purpose = q("#rq-purpose").value;
            let data;
            if (type === "ADV") data = { purpose, payee: q("#rq-payee").value, amount: Number(q("#rq-amt").value) };
            if (type === "CLR") data = { purpose, advance_id: q("#rq-adv").value, lines };
            if (Flows.VDEFS[type]) {
              data = { purpose, amount: Number(q("#rq-amt").value), docs: readDocs(bd) };
              bd.querySelectorAll("[data-gf]").forEach(el => { data[el.dataset.gf] = el.value; });
            }
            if (type === "PAY") data = q("#rq-ptype").value === "vendor" ? { purpose, payee_type: "vendor", vendor_id: (q("#rq-vendor") || {}).value, lines } : { purpose, payee_type: "employee", payee: (q("#rq-payee") || {}).value, lines };
            const r = Flows.create(type, data, role());
            close();
            // the draft exists now; if submitting fails (e.g. documents missing) keep it and open it so the checklist is right there
            let sent = false;
            if (submitToo) { try { Flows.submit(r.id, role()); sent = true; } catch (e) { UI.toast("ບັນທຶກຮ່າງ " + r.number + " ແລ້ວ — " + e.message, "warn"); } }
            if (sent || !submitToo) UI.toast((sent ? "ສົ່ງ " : "ບັນທຶກຮ່າງ ") + r.number, "ok");
            open(r.id);
          } catch (e) { UI.toast(e.message, "err"); }
        };
        q("#rq-draft").onclick = () => save(false);
        q("#rq-submit").onclick = () => save(true);
        draw();
      } });
  }

  /* =================== required documents =================== */
  // checklist: tick the evidence you hold and write where it is (voucher no., file name, link)
  function docsPanel(docs, editable) {
    if (!docs.length) return "";
    return `<div class="mt-4" data-docs><div class="section-title">ເອກະສານແນບ <span class="count ${docs.every(d => d.ok && d.ref) ? "" : "zero"}">${docs.filter(d => d.ok && d.ref).length}/${docs.length}</span></div>
      <div class="space-y-2">${docs.map(d => `<div class="flex flex-wrap items-center gap-2"><label class="flex items-center gap-2 text-sm" style="min-width:260px"><input type="checkbox" data-dk="${E(d.key)}" ${d.ok ? "checked" : ""} ${editable ? "" : "disabled"}> ${E(d.label)}</label>
        <input class="input flex-1" style="min-width:160px" data-dr="${E(d.key)}" placeholder="ເລກທີ / ຊື່ໄຟລ໌ / ລິ້ງ" value="${E(d.ref)}" ${editable ? "" : "disabled"}></div>`).join("")}</div>
      <p class="hint mt-1">ຕ້ອງຕິກ ແລະ ໃສ່ຂໍ້ມູນອ້າງອີງ ຈຶ່ງຈະສົ່ງຂໍອະນຸມັດໄດ້</p></div>`;
  }
  function readDocs(root) {
    const out = {};
    root.querySelectorAll("[data-dk]").forEach(c => { out[c.dataset.dk] = { ok: c.checked, ref: (root.querySelector(`[data-dr="${c.dataset.dk}"]`) || {}).value || "" }; });
    return out;
  }

  /* =================== DETAIL =================== */
  function detail(id) {
    const r = Store.get("requests", id), n = Flows.nextAction(r, role()), lines = Flows.linesOf(id);
    const adv = r.advance_id ? Store.get("requests", r.advance_id) : null;
    view().innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div><a class="hint" href="#/requests">← ກັບໄປລາຍການຄຳຂໍ</a>
          <h1 class="page-title mt-1">${E(r.number)} · ${E(r.purpose)}</h1>
          <p class="page-sub">${typeTag(r)} · ${E(r.payee || "")} · <b>${M(Flows.amountOf(r))}</b> · ${E(UI.fmtDate(r.date))}${adv ? ` · ເຄລຍ <a class="text-brand-700" href="#/requests?id=${adv.id}">${E(adv.number)}</a>` : ""}</p></div>
        <div class="flex gap-2 items-center"><span class="role-pill">👤 ${E(role())}</span>${chip(r)}</div>
      </div>
      <div class="card p-4 mb-4">${stepper(r)}</div>
      <div class="grid lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 space-y-4 min-w-0">
          <div>${nextBox(r, n, adv)}</div>
          ${r.generic ? `<div class="card p-5"><div class="section-title">ລາຍລະອຽດ</div><div class="space-y-1 text-sm">${Flows.summary(r).map(s => `<div class="flex justify-between gap-3"><span class="text-slate-500">${E(s[0])}</span><b class="text-right">${E(s[1])}</b></div>`).join("")}</div></div>` : ""}
          ${Flows.docsOf(r).length ? `<div class="card p-5" id="docs-card">${docsPanel(Flows.docsOf(r), r.stage === "draft" || r.stage === "approval")}${r.stage === "draft" || r.stage === "approval" ? `<button class="btn btn-ghost btn-sm mt-3" id="docs-save">ບັນທຶກເອກະສານແນບ</button>` : ""}</div>` : ""}
          ${lines.length ? `<div class="card p-5"><div class="section-title">ລາຍການ</div><div class="overflow-x-auto"><table class="data"><thead><tr><th>ໝວດ</th><th>ລາຍລະອຽດ</th><th>ເລກທີ່ບິນ</th><th class="num">ຍອດ</th><th class="num">VAT</th></tr></thead><tbody>
            ${lines.map(l => { const v = Flows.splitVat(l); return `<tr><td>${E(Acc.accName(l.account))}</td><td>${E(l.description)}</td><td>${E(l.receipt_no)}</td><td class="num">${M(v.gross)}</td><td class="num">${v.vat ? M(v.vat) : "-"}</td></tr>`; }).join("")}
          </tbody></table></div></div>` : ""}
        </div>
        <div class="space-y-4 min-w-0">
          <div class="card p-5"><div class="section-title">ປະຫວັດ</div><ul class="timeline">${Flows.history(id).map(h => `<li><b>${E(DID[h.action] || h.action)}</b> · ${E(h.role)}${h.note ? `<div class="text-slate-600">${E(h.note)}</div>` : ""}<div class="t-when">${E(h.ts.slice(0, 16).replace("T", " "))}</div></li>`).join("")}</ul></div>
          <div class="card p-5"><div class="section-title">ການລົງບັນຊີ</div><div class="space-y-2">${BOOK[r.type].map(b => `<div class="booking">📒 <span>${E(b)}</span></div>`).join("")}</div></div>
        </div>
      </div>`;
    bindDetail(r);
  }
  function nextBox(r, n, adv) {
    const head = (t, sub) => `<div class="nb-kicker">ທ່ານຕ້ອງເຮັດ</div><div class="nb-title">${E(t)}</div>${sub ? `<p class="text-sm text-slate-600">${sub}</p>` : ""}`;
    if (r.stage === "closed") return `<div class="next-box done"><div class="nb-kicker">ສຳເລັດ</div><div class="nb-title">✓ ຄົບຂັ້ນຕອນ ແລະ ລົງບັນຊີແລ້ວ</div></div>`;
    if (Flows.ENDED[r.stage]) return `<div class="next-box stop"><div class="nb-kicker">ສິ້ນສຸດ</div><div class="nb-title">${E(Flows.STAGE_LABEL[r.stage])}</div></div>`;
    const warn = Flows.warnings(r).map(w => `<div class="booking mt-2" style="background:#fffbeb;border-color:#fcd34d">${E(w)}</div>`).join("");
    if (!n.allowed) return `<div class="next-box wait"><div class="nb-kicker">ຂັ້ນຕໍ່ໄປ</div><div class="nb-title">${E(n.label)}</div><p class="text-sm text-slate-600">⏳ ${E(n.why)}</p>${r.stage === "approval" ? chainView(r) : ""}</div>`;
    const bankSel = `<div class="grid sm:grid-cols-2 gap-2 mt-3"><div><label class="field">ບັນຊີເງິນ</label><select class="input" id="nx-bank">${banks().map(b => `<option value="${b.id}">${E(b.name)}</option>`).join("")}</select></div><div><label class="field">ວັນທີ</label><input class="input" type="date" id="nx-date" value="${UI.today()}"></div></div>`;
    if (r.stage === "draft") return `<div class="next-box">${head("ສົ່ງຂໍອະນຸມັດ")}<div class="flex gap-2 mt-3"><button class="btn btn-primary btn-lg" id="nx-go">ສົ່ງຂໍອະນຸມັດ →</button><button class="btn btn-ghost" id="nx-cancel">ຍົກເລີກ</button></div></div>`;
    if (r.stage === "approval") {
      const st = Approval.chainState(r, r.type, Flows.amountOf(r)), last = st.step === st.chain.length - 1;
      return `<div class="next-box">${head("ອະນຸມັດ " + Flows.TYPES[r.type].label + "?", "<b>" + M(Flows.amountOf(r)) + "</b> · " + E(r.payee || "") + " · ຂັ້ນ " + (st.step + 1) + "/" + st.chain.length)}
        ${chainView(r)}${warn}
        <textarea class="input mt-3" id="nx-note" rows="2" placeholder="ໝາຍເຫດ (ຈຳເປັນ ຖ້າປະຕິເສດ)"></textarea>
        <div class="flex flex-wrap gap-2 mt-3"><button class="btn btn-ok btn-lg" id="nx-go">✓ ${last && r.type !== "ADV" ? "ອະນຸມັດ & ລົງບັນຊີ" : "ອະນຸມັດ"}</button><button class="btn btn-danger" id="nx-reject">✕ ປະຕິເສດ</button></div></div>`;
    }
    if (r.stage === "payout") {
      const amt = r.type === "ADV" ? r.amount : r.type === "CLR" ? r.extra : r.posted_total;
      return `<div class="next-box">${head(r.type === "CLR" ? "ຈ່າຍສ່ວນທີ່ໃຊ້ເກີນຄືນໃຫ້ " + E(r.payee) : "ຈ່າຍເງິນໃຫ້ " + E(r.payee), "ຈຳນວນ <b>" + M(amt) + "</b>")}${bankSel}
        <div class="flex gap-2 mt-3"><button class="btn btn-primary btn-lg" id="nx-pay">💸 ຈ່າຍ & ລົງບັນຊີ</button></div></div>`;
    }
    if (r.stage === "refund") return `<div class="next-box">${head("ຮັບເງິນສຳຮອງທີ່ເຫຼືອຄືນຈາກ " + E(r.payee), "ຈຳນວນ <b>" + M(r.refund) + "</b>")}${bankSel}
        <div class="flex gap-2 mt-3"><button class="btn btn-primary btn-lg" id="nx-refund">💵 ຮັບເງິນຄືນ & ລົງບັນຊີ</button></div></div>`;
    if (r.stage === "open") return `<div class="next-box wait"><div class="nb-kicker">ລໍເຄລຍ</div><div class="nb-title">ລໍ ${E(r.payee)} ຍື່ນໃບບິນເຄລຍ</div><p class="text-sm text-slate-600">ກຳນົດ ${E(r.due_clear)}</p><button class="btn btn-primary mt-3" id="nx-clr">🧾 ສ້າງໃບເຄລຍ</button></div>`;
    return "";
  }
  function bindDetail(r) {
    const q = s => view().querySelector(s), on = (s, f) => { const el = q(s); if (el) el.onclick = f; }, me = role();
    if (r.stage === "draft") on("#nx-go", () => act(() => Flows.submit(r.id, me), "ສົ່ງຂໍອະນຸມັດແລ້ວ"));
    on("#nx-cancel", () => UI.confirmDialog("ຍົກເລີກ " + r.number + "?", () => act(() => Flows.cancel(r.id, me), "ຍົກເລີກແລ້ວ")));
    if (r.stage === "approval") {
      on("#nx-go", () => act(() => { const x = Flows.approve(r.id, me, q("#nx-note").value); UI.toast(x.stage === "approval" ? "ອະນຸມັດແລ້ວ — ສົ່ງຕໍ່ຂັ້ນຕໍ່ໄປ" : "ອະນຸມັດຄົບ" + (x.stage === "payout" && r.type !== "ADV" ? " & ລົງບັນຊີແລ້ວ" : ""), "ok"); }));
      on("#nx-reject", () => act(() => Flows.reject(r.id, me, q("#nx-note").value), "ປະຕິເສດແລ້ວ"));
    }
    on("#nx-pay", () => act(() => Flows.pay(r.id, me, { bank_id: q("#nx-bank").value, date: q("#nx-date").value }), "ຈ່າຍເງິນ & ລົງບັນຊີແລ້ວ"));
    on("#nx-refund", () => act(() => Flows.receiveRefund(r.id, me, { bank_id: q("#nx-bank").value, date: q("#nx-date").value }), "ຮັບເງິນຄືນ & ລົງບັນຊີແລ້ວ"));
    on("#nx-clr", () => newRequest("CLR"));
    on("#docs-save", () => act(() => Flows.setDocs(r.id, readDocs(view().querySelector("#docs-card")), me), "ບັນທຶກເອກະສານແນບແລ້ວ"));
  }

  /* =================== Approval matrix editor (Settings) =================== */
  function matrixModal() {
    const m = Approval.matrix(), can = window.AppCtx.currentRole() === "Admin";
    let tiers = m.tiers.map(t => ({ max: t.max, chain: t.chain.slice() }));
    const fs = Flows.settings();
    UI.modal("✍️ ຂັ້ນອະນຸມັດຕາມວົງເງິນ", `<p class="hint mb-3">ໃຊ້ກັບ ຂໍຊື້, ເບີກເງິນສຳຮອງ, ເຄລຍ, ຂໍເບີກຈ່າຍ. ຜູ້ຂໍອະນຸມັດເອງບໍ່ໄດ້ ແລະ ແຕ່ລະບົດບາດອະນຸມັດໄດ້ຂັ້ນດຽວ.</p>
      <div id="mx-rows"></div>
      ${can ? `<button class="btn btn-ghost btn-sm mt-2" id="mx-add">＋ ເພີ່ມຂັ້ນວົງເງິນ</button>` : ""}
      <label class="flex items-center gap-2 text-sm mt-4"><input type="checkbox" id="mx-docs" ${fs.require_docs ? "checked" : ""} ${can ? "" : "disabled"}> ບັງຄັບເອກະສານແນບກ່ອນສົ່ງ (ເງິນສຳຮອງ / ເຄລຍ / ຂໍເບີກຈ່າຍ) — ປະເພດໃໝ່ (ໂອນເງິນ, ຄ່າທຳນຽມ) ບັງຄັບສະເໝີ</label>
      <div class="grid sm:grid-cols-2 gap-3 mt-4"><div><label class="field">ເງິນສຳຮອງຕ້ອງເຄລຍພາຍໃນ (ວັນ)</label><input class="input num" type="number" id="mx-clear" value="${fs.clear_days}" ${can ? "" : "disabled"}></div></div>
      <div class="flex justify-end gap-2 mt-4">${can ? `<button class="btn btn-primary" id="mx-save">ບັນທຶກ</button>` : '<span class="hint">ສະເພາະ Admin ແກ້ໄຂໄດ້</span>'}</div>`, { wide: true, onMount: (bd, close) => {
        const q = s => bd.querySelector(s);
        function draw() {
          q("#mx-rows").innerHTML = tiers.map((t, i) => `<div class="card p-3 mb-2"><div class="flex flex-wrap items-end gap-2">
            <div><label class="field">ບໍ່ເກີນ (₭) — ວ່າງ = ບໍ່ຈຳກັດ</label><input class="input num" type="number" data-max="${i}" value="${t.max === null ? "" : t.max}" ${can ? "" : "disabled"}></div>
            ${[0, 1, 2].map(j => `<div><label class="field">ຂັ້ນ ${j + 1}</label><select class="input" data-ch="${i}" data-j="${j}" ${can ? "" : "disabled"}><option value="">—</option>${ROLES.map(rl => `<option ${t.chain[j] === rl ? "selected" : ""}>${rl}</option>`).join("")}</select></div>`).join("")}
            ${can && tiers.length > 1 ? `<button class="text-red-500 mb-2" data-rm="${i}">✕</button>` : ""}</div></div>`).join("");
          bd.querySelectorAll("[data-max]").forEach(el => el.onchange = () => { tiers[+el.dataset.max].max = el.value === "" ? null : Number(el.value); });
          bd.querySelectorAll("[data-ch]").forEach(el => el.onchange = () => { const t = tiers[+el.dataset.ch]; t.chain[+el.dataset.j] = el.value; t.chain = t.chain.slice(0, 3); });
          bd.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { tiers.splice(+b.dataset.rm, 1); draw(); });
        }
        draw();
        if (!can) return;
        q("#mx-add").onclick = () => { tiers.push({ max: null, chain: ["Manager"] }); draw(); };
        q("#mx-save").onclick = () => {
          try {
            tiers.forEach(t => { t.chain = t.chain.filter(Boolean); if (new Set(t.chain).size !== t.chain.length) throw new Error("ບົດບາດຊ້ຳກັນໃນຂັ້ນດຽວ"); });
            Approval.setMatrix(tiers);
            const cd = Number(q("#mx-clear").value) || 15;
            const rd = q("#mx-docs").checked;
            if (Store.get("settings", "flows")) Store.update("settings", "flows", { clear_days: cd, require_docs: rd }); else Store.insert("settings", { id: "flows", clear_days: cd, require_docs: rd });
            close(); UI.toast("ບັນທຶກຂັ້ນອະນຸມັດແລ້ວ (ໃຊ້ກັບຄຳຂໍໃໝ່)", "ok");
          } catch (e) { UI.toast(e.message, "err"); }
        };
      } });
  }

  window.FlowsUI = { page: render, newRequest, matrixModal };
})();
