/* LaoBooks ERP – API token screen (Settings › API). Logic in extin.js, mailbox script in gas/Code.gs. */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s));
  const EXAMPLE = '{"action":"ingest","token":"<INGEST token>","records":[{"id":"POS-1001","source":"myshop","type":"sale","date":"2026-10-19","amount":100000,"vat":10000,"pay":"cash","memo":"ຂາຍໜ້າຮ້ານ"}]}';

  function open() {
    if (["Admin", "Manager", "Accountant"].indexOf(window.AppCtx.currentRole()) < 0) return UI.toast("ສະເພາະ Admin / Manager / Accountant", "warn");
    const k = ExtIn.link(), rows = ExtIn.recs().slice(0, 30);
    const tok = (label, v, hint) => `<div class="mb-3"><label class="field">${label}</label><div class="flex gap-2"><input class="input" readonly data-tok value="${E(v)}" placeholder="— ຍັງບໍ່ໄດ້ສ້າງ —"><button class="btn btn-ghost btn-sm" data-copy="${E(v)}" ${v ? "" : "disabled"}>ຄັດລອກ</button></div><p class="hint">${hint}</p></div>`;
    UI.modal("API ເຊື່ອມແອັບອື່ນ", `<p class="hint mb-3">ແອັບອື່ນສົ່ງທຸລະກຳເຂົ້າ "ຕູ້ຈົດໝາຍ" (Google Apps Script) ດ້ວຍ token; ERP ດຶງມາລົງບັນຊີອັດຕະໂນມັດ. Token ເກັບໃນ browser ນີ້ ແລະ ໃນ Script Properties ເທົ່ານັ້ນ.</p>
      <div class="mb-3"><label class="field">URL ຂອງ Web App (…/exec)</label><input class="input" id="x-url" value="${E(k.url)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
      ${tok("INGEST token (ໃຫ້ແອັບທີ່ ສົ່ງ)", k.ingest, "ໃສ່ເປັນ Script property ຊື່ INGEST_TOKEN ແລະ ໃຫ້ແອັບທີ່ສົ່ງ.")}
      ${tok("READ token (ERP ໃຊ້ດຶງ)", k.read, "ໃສ່ເປັນ Script property ຊື່ READ_TOKEN. ຢ່າໃຫ້ແອັບອື່ນ.")}
      <div class="flex flex-wrap gap-2 mb-4"><button class="btn btn-primary btn-sm" id="x-new">${k.ingest ? "ສ້າງ token ໃໝ່ (ອັນເກົ່າໃຊ້ບໍ່ໄດ້)" : "ສ້າງ token"}</button><button class="btn btn-ghost btn-sm" id="x-save">ບັນທຶກ URL</button><button class="btn btn-ghost btn-sm" id="x-pull">ດຶງຕອນນີ້</button><span class="hint self-center">ດຶງຄັ້ງລ່າສຸດ: ${E(k.last_pull || "-")}</span></div>
      <details class="mb-4"><summary class="cursor-pointer text-sm font-semibold">ວິທີຕັ້ງ + ຮູບແບບຂໍ້ມູນ</summary><div class="text-sm mt-2 space-y-2">
        <p>1) ເປີດ Google Sheet → Extensions → Apps Script → ວາງ <code>gas/Code.gs</code> ຈາກ repo. 2) Project Settings → Script properties: INGEST_TOKEN, READ_TOKEN. 3) Deploy → Web app (Execute as: Me, Access: Anyone) → ເອົາ URL ມາໃສ່ຂ້າງເທິງ.</p>
        <p>ແອັບທີ່ສົ່ງ POST (text/plain) ໄປ URL:</p><pre class="text-xs p-2 bg-slate-50 rounded overflow-x-auto whitespace-pre-wrap">${E(EXAMPLE)}</pre>
        <p><b>type</b>: <code>sale</code> (Dr ເງິນສົດ/ທະນາຄານ/ລູກໜີ້, Cr ລາຍຮັບ + VAT), <code>expense</code>, <code>journal</code> (<code>lines:[{account,debit,credit}]</code>). <b>pay</b>: cash|bank|credit. <b>account</b> ບໍ່ບັງຄັບ. <b>id</b> ຊ້ຳ = ບໍ່ລົງຊ້ຳ. ສູງສຸດ 200 ລາຍການ/ຄັ້ງ.</p></div></details>
      <div class="tbl-wrap"><table class="data"><thead><tr><th>ແຫຼ່ງ:id</th><th>ວັນທີ</th><th class="num">ຍອດ</th><th>ສະຖານະ</th></tr></thead><tbody>${rows.map(r => `<tr><td>${E(r.id)}</td><td>${E(r.date)}</td><td class="num">${UI.money(r.amount)}</td><td>${r.status === "posted" ? "ລົງບັນຊີແລ້ວ" : "ຕິດຂັດ: " + E(r.error)}</td></tr>`).join("") || '<tr><td colspan="4" class="text-center text-slate-400 py-3">ຍັງບໍ່ມີ</td></tr>'}</tbody></table></div>`, { wide: true });
    const q = s => document.querySelector(s);
    q("#x-save").onclick = () => { ExtIn.setUrl(q("#x-url").value.trim()); UI.toast("ບັນທຶກ URL ແລ້ວ", "ok"); };
    q("#x-new").onclick = () => { const go = () => { ExtIn.newTokens(); open(); UI.toast("ສ້າງ token ແລ້ວ — ໃສ່ໃນ Script Properties", "ok"); }; if (k.ingest) UI.confirmDialog("ສ້າງ token ໃໝ່? token ເກົ່າຈະໃຊ້ບໍ່ໄດ້ — ຕ້ອງປ່ຽນໃນ Script Properties ແລະ ແອັບທີ່ສົ່ງ", go); else go(); };
    q("#x-pull").onclick = async () => { try { ExtIn.setUrl(q("#x-url").value.trim()); const r = await ExtIn.pull(); open(); UI.toast("ລົງບັນຊີ " + r.posted + " · ຕິດຂັດ " + r.blocked, r.blocked ? "warn" : "ok"); } catch (e) { UI.toast(e.message, "err"); } };
    document.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy).then(() => UI.toast("ຄັດລອກແລ້ວ", "ok")); });
  }
  window.ExtInUI = { open };
})();
