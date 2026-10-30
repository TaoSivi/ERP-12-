/* ============================================================
   ST ERP – Import a "ປື້ມບັນຊີປະຈຳວັນ" (daily journal book) from Excel
   Each sheet row = ONE Dr account + ONE Cr account + amount. Rows with the same voucher number and date form one journal entry.
   parse(rows)  → { vouchers, accounts, errors }   (rows = sheet as arrays; pure, no store access)
   plan(parsed) → what the import would add / skip     run(parsed) → writes (one batch, all-or-nothing)
   Keeps the book's own voucher number (PV-LT-JAN26-004) and reference; re-running skips vouchers already imported.
   ============================================================ */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s));
  const num = v => { const n = Number(String(v == null ? "" : v).replace(/,/g, "")); return isFinite(n) ? n : 0; };
  const iso = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || "").trim()); return m ? m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0") : ""; };

  // the book's columns: 0 seq · 1 date · 2 voucher · 3 reference · 4 Dr account · 5 Cr account · 6 memo · 7 original value · 8 rate · 9 Dr amount · 10 Cr amount
  function parse(rows) {
    const byKey = {}, order = [], accounts = {}, errors = [];
    (rows || []).forEach((r, i) => {
      const date = iso(r[1]); if (!date || r[4] == null || r[5] == null) return;
      const dr = String(r[4]).trim(), cr = String(r[5]).trim(), amtD = num(r[9]), amtC = num(r[10]), no = String(r[2] == null ? "" : r[2]).trim();
      if (!no) { errors.push("ແຖວ " + (i + 1) + ": ບໍ່ມີເລກໃບຢັ້ງຢືນ"); return; }
      if (Math.abs(amtD - amtC) > 0.5) { errors.push("ແຖວ " + (i + 1) + " (" + no + "): ຍອດ Dr ≠ Cr"); return; }
      const key = no + "|" + date;
      if (!byKey[key]) { byKey[key] = { key, no, date, ref: String(r[3] == null ? "" : r[3]).trim(), memo: String(r[6] || "").trim(), lines: [] }; order.push(key); }
      const orig = String(r[7] || ""), rate = num(r[8]) || 1, fx = rate !== 1 || (orig && !/ກີບ/.test(orig));
      byKey[key].lines.push({ dr, cr, amount: amtD, fx: fx ? orig + " @" + rate : "" });
      accounts[dr] = 1; accounts[cr] = 1;
    });
    const vouchers = order.map(k => byKey[k]);
    vouchers.forEach(v => { v.total = v.lines.reduce((s, l) => s + l.amount, 0); });
    return { vouchers, accounts: Object.keys(accounts), errors };
  }

  // type of an account code the book uses but our chart lacks: nearest known parent in the LT chart, else by first digits
  function classify(code) {
    const lt = {}; (window.COA_LT || []).forEach(r => { lt[r[0]] = r; });
    if (lt[code]) return lt[code][2];
    for (let n = code.length - 1; n >= 3; n--) { const p = code.slice(0, n).replace(/\.$/, ""); if (lt[p]) return lt[p][2]; }
    const d = code[0], d2 = code.slice(0, 2);
    if (d === "1" || d === "2") return "Asset";
    if (d === "3") return "Equity";
    if (d === "4") return d2 === "43" ? "Revenue" : "Liability";
    if (d === "7") return "Revenue";
    return "Expense"; // 5, 6, 8, 9
  }

  function plan(parsed) {
    const have = {}; Store.all("accounts").forEach(a => { have[a.code] = 1; });
    const done = {}; Store.where("journal_entries", j => j.source_type === "IMPORT").forEach(j => { done[j.source_id] = 1; });
    const fresh = parsed.vouchers.filter(v => !done[v.key]);
    const used = {}; fresh.forEach(v => v.lines.forEach(l => { used[l.dr] = 1; used[l.cr] = 1; }));
    const newAcc = Object.keys(used).filter(c => !have[c]);
    const sum = fresh.reduce((s, v) => s + v.total, 0), dates = parsed.vouchers.map(v => v.date).sort();
    return { fresh, skipped: parsed.vouchers.length - fresh.length, newAcc, total: sum, from: dates[0] || "", to: dates[dates.length - 1] || "", lines: fresh.reduce((s, v) => s + v.lines.length, 0) };
  }

  function run(parsed) {
    const pl = plan(parsed);
    if (!pl.fresh.length) return { entries: 0, accounts: 0 };
    const byCode = {}; Store.all("accounts").forEach(a => { byCode[a.code] = a; });
    const taken = {}; Store.all("journal_entries").forEach(j => { taken[j.number] = 1; });
    const at = new Date().toISOString();
    Store.batch(["accounts", "journal_entries", "journal_lines", "audit_log"], () => {
      pl.newAcc.forEach(code => { byCode[code] = Store.insert("accounts", { id: "acc_" + code, code, name: "(ຍັງບໍ່ຕັ້ງຊື່)", type: classify(code), is_header: 0, is_active: 1, imported: 1 }); });
      pl.fresh.forEach(v => {
        let number = v.no, k = 1; while (taken[number]) number = v.no + "-" + (++k); taken[number] = 1;
        const je = Store.insert("journal_entries", { number, date: v.date, source_type: "IMPORT", source_id: v.key, memo: v.memo + (v.ref ? " [" + v.ref + "]" : ""), total_debit: v.total, total_credit: v.total, status: "posted", posted_by: "import", created_at: at });
        v.lines.forEach(l => {
          const fx = l.fx ? l.fx : "";
          Store.insert("journal_lines", { je_id: je.id, account: l.dr, account_name: byCode[l.dr].name, debit: l.amount, credit: 0, memo: fx });
          Store.insert("journal_lines", { je_id: je.id, account: l.cr, account_name: byCode[l.cr].name, debit: 0, credit: l.amount, memo: fx });
        });
      });
      Acc.audit("import", "journal_entries", "JV_IMPORT", pl.fresh.length + " vouchers / " + pl.lines + " lines from journal book");
    });
    return { entries: pl.fresh.length, accounts: pl.newAcc.length };
  }

  function modal() {
    if (Store.mode === "cloud") return UI.toast("ນຳເຂົ້າຈຳນວນຫຼາຍໃຊ້ໄດ້ສະເພາະໂໝດ Demo (ຖານໃນ browser)", "warn");
    UI.modal("ນຳເຂົ້າປຶ້ມບັນຊີປະຈຳວັນ (Excel)", `<p class="hint mb-3">ເລືອກໄຟລ໌ປື້ມບັນຊີປະຈຳວັນ (.xlsx). ລະບົບລົງໃຫ້ຕາມເລກໃບຢັ້ງຢືນເດີມ, ສ້າງບັນຊີທີ່ຍັງບໍ່ມີ, ແລະ ຂ້າມໃບທີ່ເຄີຍນຳເຂົ້າແລ້ວ. ນຳເຂົ້າເຂົ້າບໍລິສັດທີ່ກຳລັງໃຊ້ຢູ່ ( ${E((window.AppCtx && AppCtx.company ? AppCtx.company().name : "") || "")} ).</p>
      <input type="file" id="jv-file" accept=".xlsx,.xls" class="input"><div id="jv-out" class="mt-3 text-sm"></div>
      <div class="flex justify-end gap-2 mt-4"><button class="btn btn-ghost" data-x>ປິດ</button><button class="btn btn-primary" id="jv-go" disabled>ນຳເຂົ້າ</button></div>`, { onMount: (bd, close) => {
        let parsed = null; const out = bd.querySelector("#jv-out"), go = bd.querySelector("#jv-go");
        bd.querySelector("[data-x]").onclick = close;
        bd.querySelector("#jv-file").onchange = ev => {
          const f = ev.target.files[0]; if (!f) return; if (typeof XLSX === "undefined") return UI.toast("ຍັງໂຫລດ XLSX ບໍ່ສຳເລັດ — ລອງໃໝ່", "err");
          const rd = new FileReader();
          rd.onload = () => {
            try {
              const wb = XLSX.read(rd.result, { type: "array" }), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
              parsed = parse(rows); const p = plan(parsed);
              out.innerHTML = `<div class="grid grid-cols-2 gap-2"><div class="booking"><span>ໃບຢັ້ງຢືນທີ່ຈະເພີ່ມ <b>${p.fresh.length}</b> (${p.lines} ແຖວ)</span></div><div class="booking"><span>ຂ້າມ (ເຄີຍນຳເຂົ້າ) <b>${p.skipped}</b></span></div>
                <div class="booking"><span>ຊ່ວງວັນທີ <b>${E(p.from)} → ${E(p.to)}</b></span></div><div class="booking"><span>ຍອດ Dr = Cr <b>${UI.money(p.total)}</b></span></div>
                <div class="booking"><span>ບັນຊີໃໝ່ທີ່ຈະສ້າງ <b>${p.newAcc.length}</b></span></div><div class="booking" style="${parsed.errors.length ? "background:#fef2f2;border-color:#fca5a5" : ""}"><span>ແຖວມີບັນຫາ <b>${parsed.errors.length}</b></span></div></div>
                ${parsed.errors.length ? `<div class="hint mt-2">${parsed.errors.slice(0, 5).map(E).join("<br>")}</div>` : ""}
                <p class="hint mt-2">ບັນຊີໃໝ່ຈະຕັ້ງຊື່ "(ຍັງບໍ່ຕັ້ງຊື່)" ແລະ ເດົາປະເພດຕາມຜັງ LT — ກວດ/ປ່ຽນຊື່ໃນ ບັນຊີແຍກປະເພດ ພາຍຫຼັງ. ຍອດຍົກມາ (ປີ 2025) ບໍ່ຢູ່ໃນໄຟລ໌ນີ້ — ນຳເຂົ້າແຍກດ້ວຍ Opening Bal.</p>`;
              go.disabled = !p.fresh.length;
            } catch (e) { out.innerHTML = '<span class="text-red-600">ອ່ານໄຟລ໌ບໍ່ໄດ້: ' + E(e.message) + "</span>"; }
          };
          rd.readAsArrayBuffer(f);
        };
        go.onclick = () => { go.disabled = true; try { const r = run(parsed); close(); UI.toast("ນຳເຂົ້າ " + r.entries + " ໃບຢັ້ງຢືນ, ສ້າງ " + r.accounts + " ບັນຊີ ✓", "ok"); location.hash = "#/gl"; if (window.AppCtx && AppCtx.refresh) AppCtx.refresh(); } catch (e) { go.disabled = false; UI.toast("ນຳເຂົ້າບໍ່ສຳເລັດ (ບໍ່ມີຫຍັງຖືກບັນທຶກ): " + e.message, "err"); } };
      } });
  }

  window.JVImport = { parse, classify, plan, run, modal };
})();
