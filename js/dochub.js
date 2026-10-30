/* ============================================================
   ST ERP – "ເອກະສານທັງໝົດ": one page that lists the 11 document types, who needs them and where to start.
   Each card: what it is · counts (waiting / total) · "+ ສ້າງ" to start one · "ເບິ່ງລາຍການ" to open the list.
   Cards a role cannot open are hidden, so people only see their own documents.
   ============================================================ */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s));
  const view = () => document.getElementById("view");
  const ctx = () => window.AppCtx || {};
  const gate = (types, st) => Store.where("gate_docs", d => types.indexOf(d.type) >= 0 && d.status === (st || "approval")).length;
  const gateAll = types => Store.where("gate_docs", d => types.indexOf(d.type) >= 0).length;
  const cases = stage => Store.all("purchase_requisitions").filter(c => { try { return Procure.stageOf(c) === stage; } catch (e) { return false; } }).length;
  const go = (hash, tip) => () => { if (tip) UI.toast(tip, "info"); location.hash = hash; };

  const GROUPS = ["ຊື້", "ຂາຍ", "ເງິນ", "ສາງ", "ຄົນ & ຊັບສິນ", "ລາຍຈ່າຍ"];
  const DOCS = [
    { g: "ຊື້", ic: "📋", name: "ໃບສັ່ງຊື້ (PO)", hint: "ສັ່ງຊື້ຈາກຜູ້ສະໜອງ. ເລີ່ມຈາກ ໃບຂໍຊື້ → ໃບສະເໜີລາຄາ → PO", route: "procure", list: "#/procure", key: "ຊື້ ສັ່ງຊື້ po purchase order",
      create: () => ProcureUI.newCase(), count: () => Store.all("purchase_orders").length, wait: () => cases("po_approval") },
    { g: "ຊື້", ic: "📦", name: "ໃບຮັບສິນຄ້າ (GRN)", hint: "ເຄື່ອງມາຮອດແລ້ວ — ໃສ່ຈຳນວນທີ່ໄດ້ຮັບແທ້", route: "procure", list: "#/procure", key: "ຮັບສິນຄ້າ ຮັບເຄື່ອງ grn goods receipt",
      create: go("#/procure", "ເປີດໃບຈັດຊື້ທີ່ຢູ່ຂັ້ນ \"ຮັບເຄື່ອງ\" ແລ້ວກົດ ຮັບເຄື່ອງ"), count: () => Store.all("grns").length, wait: () => cases("receiving") + gate(["GRN"]) },
    { g: "ຊື້", ic: "📥", name: "ໃບບິນຊື້ (Bill)", hint: "ບິນຈາກຜູ້ສະໜອງ ທີ່ຕ້ອງຈ່າຍ", route: "bills", list: "#/bills", key: "ບິນຊື້ bill ເຈົ້າໜີ້ vendor",
      create: () => ctx().newBill(), count: () => Store.all("bills").length, wait: () => Store.where("bills", b => b.status === "draft").length },
    { g: "ຂາຍ", ic: "🧾", name: "ໃບບິນຂາຍ (Invoice)", hint: "ເກັບເງິນລູກຄ້າ — ຂາຍເຊື່ອ ຫຼື ອອກບິນ", route: "invoices", list: "#/invoices", key: "ບິນຂາຍ invoice ລູກໜີ້ ລູກຄ້າ",
      create: () => ctx().newInvoice(), count: () => Store.all("invoices").length, wait: () => Store.where("invoices", b => b.status === "draft").length },
    { g: "ເງິນ", ic: "💵", name: "ໃບຮັບເງິນ", hint: "ລູກຄ້າຈ່າຍເງິນແລ້ວ — ເປີດ Invoice ແລ້ວກົດ ຮັບເງິນ", route: "invoices", list: "#/banking", key: "ຮັບເງິນ receipt ຮັບຊຳລະ",
      create: go("#/invoices", "ເປີດ Invoice ທີ່ລູກຄ້າຈ່າຍ ແລ້ວກົດ ຮັບເງິນ"), count: () => Store.where("payments", p => p.type === "receive").length, wait: () => gate(["RCPT"]) },
    { g: "ເງິນ", ic: "💸", name: "ໃບຈ່າຍເງິນ", hint: "ຈ່າຍເງິນຜູ້ສະໜອງ — ເປີດ Bill ແລ້ວກົດ ຈ່າຍ", route: "bills", list: "#/banking", key: "ຈ່າຍເງິນ payment ຈ່າຍ voucher",
      create: go("#/bills", "ເປີດ Bill ທີ່ຕ້ອງຈ່າຍ ແລ້ວກົດ ຈ່າຍ"), count: () => Store.where("payments", p => p.type === "pay").length, wait: () => gate(["PAYV", "PAYC"]) },
    { g: "ສາງ", ic: "📤", name: "ໃບຈ່າຍສິນຄ້າ", hint: "ເບີກສິນຄ້າອອກຈາກສາງໃຊ້ໃນຫ້ອງການ/ໂຄງການ", route: "inventory", list: "#/inventory", key: "ຈ່າຍສິນຄ້າ ເບີກ ສາງ issue",
      create: () => StockDocUI.form("ISS"), count: () => Store.where("stock_docs", d => d.type === "ISS").length, wait: () => Store.where("stock_docs", d => d.type === "ISS" && d.status === "approval").length },
    { g: "ສາງ", ic: "🔧", name: "ໃບປັບປຸງສາງ", hint: "ແກ້ຈຳນວນສິນຄ້າ (ເສຍ/ຂາດ/ເກີນ) ຫຼື ກວດນັບ", route: "inventory", list: "#/inventory", key: "ປັບປຸງສາງ ກວດນັບ adjust count ສະຕັອກ",
      create: () => StockDocUI.form("ADJ"), count: () => Store.where("stock_docs", d => d.type === "ADJ" || d.type === "CNT").length, wait: () => Store.where("stock_docs", d => (d.type === "ADJ" || d.type === "CNT") && d.status === "approval").length },
    { g: "ຄົນ & ຊັບສິນ", ic: "💼", name: "ໃບເງິນເດືອນ", hint: "ຄິດ ແລະ ອະນຸມັດເງິນເດືອນປະຈຳເດືອນ", route: "payroll", list: "#/payroll", key: "ເງິນເດືອນ payroll ພະນັກງານ",
      create: go("#/payroll", "ກົດ ▶ ຄິດເງິນເດືອນ ເພື່ອເລີ່ມງວດໃໝ່"), count: () => Store.all("payroll").length, wait: () => gate(["PAYROLL"]) },
    { g: "ຄົນ & ຊັບສິນ", ic: "🏗", name: "ໃບຄ່າເສື່ອມ", hint: "ຄ່າເສື່ອມລາຄາຊັບສິນປະຈຳເດືອນ", route: "assets", list: "#/assets", key: "ຄ່າເສື່ອມ depreciation ຊັບສິນ",
      create: go("#/assets", "ກົດ Run ຄ່າເສື່ອມ ເພື່ອສ້າງໃບປະຈຳເດືອນ"), count: () => gateAll(["DEPR"]) + Store.where("journal_entries", j => j.source_type === "DEPR").length, wait: () => gate(["DEPR"]) },
    { g: "ລາຍຈ່າຍ", ic: "🧳", name: "ໃບລາຍຈ່າຍ / ຂໍເບີກ", hint: "ຂໍເບີກເງິນ, ຂໍຈ່າຍ, ເຄລຍເງິນແຮ, ລາຍຈ່າຍຕ່າງໆ", route: "requests", list: "#/requests", key: "ລາຍຈ່າຍ ຂໍເບີກ ຂໍຈ່າຍ expense ເງິນແຮ",
      create: () => FlowsUI.newRequest("EXP"), count: () => Store.all("requests").length, wait: () => Store.where("requests", r => r.stage === "approval").length }
  ];

  // lanes = the order documents follow; "flow" lanes number the steps and draw arrows between them
  const LANES = [
    { t: "ຂະບວນຊື້", s: "ໃບສັ່ງຊື້ → ຮັບສິນຄ້າ → ບິນຊື້ → ຈ່າຍເງິນ", flow: true, docs: [0, 1, 2, 5] },
    { t: "ຂະບວນຂາຍ", s: "ອອກບິນຂາຍ → ຮັບເງິນ", flow: true, docs: [3, 4] },
    { t: "ສາງ", s: "ເບີກ ແລະ ແກ້ຈຳນວນສິນຄ້າ", docs: [6, 7] },
    { t: "ຄົນ & ຊັບສິນ", s: "ປະຈຳເດືອນ", docs: [8, 9] },
    { t: "ລາຍຈ່າຍ", s: "ຂໍເບີກ / ຂໍຈ່າຍ", docs: [10] }
  ];

  function page() {
    const allowed = ctx().allowed || (() => true), canDo = ctx().canDo || (() => true);
    const q = (view().querySelector("#dh-q") || {}).value || "";
    const ok = d => allowed(d.route), pend = DOCS.filter(ok).reduce((s, d) => s + d.wait(), 0), total = DOCS.filter(ok).reduce((s, d) => s + d.count(), 0);
    const tile = (d, step, flow) => { const w = d.wait(), n = d.count(), i = DOCS.indexOf(d);
      return `<article class="dh-tile${flow ? " flow" : ""}" data-name="${E((d.name + " " + d.key + " " + d.hint).toLowerCase())}">
        <div class="dh-head">${flow ? `<span class="dh-step">${step}</span>` : ""}<span class="dh-ic">${d.ic}</span><h3 class="dh-name">${E(d.name)}</h3></div>
        <p class="dh-hint">${E(d.hint)}</p>
        <div class="dh-foot"><span class="dh-count${w ? " warn" : ""}">${w ? "⏳ ລໍອະນຸມັດ " + w : "ທັງໝົດ " + n}</span>
          <span class="dh-act">${canDo("create", d.route) ? `<button class="btn btn-primary btn-sm" data-new="${i}">+ ສ້າງ</button>` : ""}<a class="btn btn-ghost btn-sm" href="${d.list}">ເບິ່ງ</a></span></div></article>`; };
    view().innerHTML = `<div class="dh-top"><div><h1 class="page-title">ເອກະສານທັງໝົດ</h1><p class="page-sub">ເລືອກປະເພດ → ກົດ + ສ້າງ ເພື່ອເລີ່ມ. ລູກສອນ → ຄືລຳດັບເອກະສານທີ່ຕໍ່ກັນ.</p></div>
        <a class="dh-wait${pend ? " on" : ""}" href="#/gate"><b>${pend}</b><span>ລໍອະນຸມັດ<br><small>ເອກະສານທັງໝົດ ${total}</small></span></a></div>
      <input class="input dh-q" id="dh-q" type="search" placeholder="🔍 ຄົ້ນຫາ: ບິນ, ເງິນເດືອນ, ຮັບເຄື່ອງ, ຈ່າຍ..." value="${E(q)}">` +
      LANES.map(l => { const ds = l.docs.map(i => DOCS[i]).filter(ok); return ds.length ? `<section class="dh-lane" data-lane><header><h2>${E(l.t)}</h2><span>${E(l.s)}</span></header><div class="dh-row">${ds.map((d, k) => tile(d, k + 1, l.flow && ds.length > 1)).join("")}</div></section>` : ""; }).join("") +
      '<p class="hint mt-4" id="dh-none" style="display:none">ບໍ່ພົບເອກະສານທີ່ຄົ້ນຫາ</p>';
    const apply = () => { const t = view().querySelector("#dh-q").value.trim().toLowerCase(); let any = 0;
      view().querySelectorAll(".dh-tile").forEach(c => { const on = !t || c.dataset.name.indexOf(t) >= 0; c.style.display = on ? "" : "none"; if (on) any++; });
      view().querySelectorAll("[data-lane]").forEach(s => { s.style.display = Array.from(s.querySelectorAll(".dh-tile")).some(c => c.style.display !== "none") ? "" : "none"; });
      view().querySelector("#dh-none").style.display = any ? "none" : ""; };
    view().querySelector("#dh-q").oninput = apply; apply();
    view().querySelectorAll("[data-new]").forEach(b => b.onclick = () => { try { DOCS[Number(b.dataset.new)].create(); } catch (e) { UI.toast(e.message, "err"); } });
  }

  window.DocHub = { page, DOCS };
})();
