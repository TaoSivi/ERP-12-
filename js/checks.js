/* ============================================================
   LaoBooks ERP – Control checks
   1) Bank reconciliation: match statement lines to the BANK LEDGER (every cash movement,
      whatever created it), one-to-one, by amount + date (±3 days) + reference.
      Unmatched bank-only items (fees, interest) can be booked in one click.
   2) Anomaly scan: patterns that usually mean a mistake (or worse) — for a manager's weekly look.
   Pure logic (no DOM).
   ============================================================ */
(function () {
  const round = n => Acc.round(n);
  const today = () => new Date().toISOString().slice(0, 10);
  const days = (a, b) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86400000));
  const norm = s => String(s || "").toLowerCase().replace(/[\s.,\-_/()]+/g, "").replace(/(ຈຳກັດ|ບໍລິສັດ|ltd|co|company|limited)/g, "");

  /* ---------- 1. bank reconciliation ---------- */
  function bankLines(stmt) {
    const banks = Store.all("bank_accounts");
    const b = stmt && stmt.bank_id ? banks.find(x => x.id === stmt.bank_id) : null;
    const codes = new Set((b ? [b] : banks).map(x => String(x.gl_account)));
    const used = new Set(Store.where("bank_statements", s => s.matched_line).map(s => s.matched_line));
    const out = [];
    Store.all("journal_lines").forEach(l => {
      if (!codes.has(String(l.account)) || used.has(l.id)) return;
      const je = Store.get("journal_entries", l.je_id);
      if (!je || !(je.status === "posted" || je.status === "reversed")) return;
      out.push({ line: l, je, amount: round(Number(l.debit) - Number(l.credit)) });
    });
    return out;
  }
  function refHit(stmt, c) {
    const ref = String(stmt.ref || "").trim().toLowerCase();
    if (ref.length < 3) return false;
    return [c.je.memo, c.je.number, c.line.memo].some(x => String(x || "").toLowerCase().indexOf(ref) !== -1);
  }
  function matchBank() {
    let n = 0;
    Store.where("bank_statements", s => !s.matched).sort((a, b) => a.date.localeCompare(b.date)).forEach(st => {
      const amt = Number(st.amount), pool = bankLines(st).filter(c => days(c.je.date, st.date) <= 3);
      let cands = pool.filter(c => Math.abs(c.amount - amt) < 1);
      if (!cands.length && amt > 0) cands = pool.filter(c => Math.abs(Math.abs(c.amount) - amt) < 1); // statements exported without signs
      if (!cands.length) return;
      cands.sort((a, b) => (refHit(st, b) - refHit(st, a)) || (days(a.je.date, st.date) - days(b.je.date, st.date)));
      const best = cands[0];
      Store.update("bank_statements", st.id, { matched: true, matched_line: best.line.id, matched_je: best.je.id, matched_by: refHit(st, best) ? "ref" : "amount+date" });
      n++;
    });
    return n;
  }
  // book an item that only exists on the bank side: fee (money out) or interest/other income (money in)
  function postBankItem(stmtId) {
    const st = Store.get("bank_statements", stmtId);
    if (!st || st.matched) throw new Error("ລາຍການນີ້ຈັບຄູ່ແລ້ວ");
    const bank = (st.bank_id && Store.get("bank_accounts", st.bank_id)) || Store.all("bank_accounts")[0];
    const amt = round(Math.abs(Number(st.amount))), out = Number(st.amount) < 0;
    const je = Acc.postJournal({ date: st.date, source_type: "BANK_ITEM", source_id: st.id, memo: (out ? "ຄ່າທຳນຽມທະນາຄານ " : "ລາຍຮັບຈາກທະນາຄານ ") + (st.ref || ""),
      lines: out ? [{ account: Acc.PA("BANK_FEE"), debit: amt, credit: 0, memo: st.ref || "" }, { account: bank.gl_account, debit: 0, credit: amt, memo: st.ref || "" }]
                 : [{ account: bank.gl_account, debit: amt, credit: 0, memo: st.ref || "" }, { account: Acc.PA("OTHER_INC"), debit: 0, credit: amt, memo: st.ref || "" }] });
    const line = Store.where("journal_lines", l => l.je_id === je.id && String(l.account) === String(bank.gl_account))[0];
    Store.update("bank_statements", st.id, { matched: true, matched_line: line.id, matched_je: je.id, matched_by: "booked" });
    return je;
  }
  function importStatement(text, bankId) {
    let n = 0;
    String(text || "").trim().split(/\r?\n/).forEach(ln => {
      const p = ln.split(",");
      if (p.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(p[0].trim())) return;
      Store.insert("bank_statements", { date: p[0].trim(), ref: p[1].trim(), amount: parseFloat(p[2]) || 0, bank_id: bankId || "", matched: false });
      n++;
    });
    return n;
  }

  /* ---------- 2. anomaly scan ---------- */
  function scan(asOf) {
    asOf = asOf || today();
    const out = [], add = (sev, title, detail, link) => out.push({ sev, title, detail, link: link || "" });
    // duplicate master data
    [["vendors", "ຜູ້ສະໜອງ", "#/vendors"], ["customers", "ລູກຄ້າ", "#/customers"]].forEach(([coll, lbl, link]) => {
      const seen = {};
      Store.all(coll).forEach(x => {
        [x.tin && "tin:" + String(x.tin).trim(), "name:" + norm(x.name)].filter(k => k && k.length > 6).forEach(k => {
          if (seen[k] && seen[k] !== x.id) add("high", lbl + " ຊ້ຳກັນ", (Store.get(coll, seen[k]) || {}).name + " ↔ " + x.name + (k.indexOf("tin:") === 0 ? " (TIN ດຽວກັນ)" : " (ຊື່ຄ້າຍກັນ)"), link);
          else seen[k] = x.id;
        });
      });
    });
    const limit = Number((Store.get("settings", "company") || {}).approval_limit) || 0;
    // bills split to stay under the approval limit
    if (limit > 0) {
      const byV = {};
      Store.where("bills", b => ["posted", "partial", "paid"].indexOf(b.status) !== -1 && Number(b.total) <= limit).forEach(b => (byV[b.vendor_id] = byV[b.vendor_id] || []).push(b));
      Object.keys(byV).forEach(v => {
        const list = byV[v].sort((a, b) => a.date.localeCompare(b.date));
        for (let i = 0; i < list.length; i++) {
          const grp = list.filter(b => days(b.date, list[i].date) <= 3 && b.date >= list[i].date);
          const sum = grp.reduce((s, b) => s + Number(b.total), 0);
          if (grp.length > 1 && sum > limit) { add("high", "ບິນອາດຖືກແບ່ງຫຼົບວົງເງິນອະນຸມັດ", (Store.get("vendors", v) || {}).name + ": " + grp.map(b => b.number).join(", ") + " ລວມ " + Math.round(sum).toLocaleString("en-US"), "#/bills"); break; }
        }
      });
    }
    // manual journals: round amounts, Sundays, back-dated
    Store.where("journal_entries", j => j.source_type === "MANUAL" && j.status === "posted").forEach(j => {
      if (Number(j.total_debit) >= 1000000 && Number(j.total_debit) % 1000000 === 0) add("mid", "Journal ມືຍອດກົມ", j.number + " · " + Math.round(j.total_debit).toLocaleString("en-US"), "#/gl");
      if (new Date(j.date + "T00:00:00Z").getUTCDay() === 0) add("low", "Journal ມືລົງວັນອາທິດ", j.number + " · " + j.date, "#/gl");
      if (j.created_at && days(j.date, j.created_at.slice(0, 10)) > 30 && j.date < j.created_at.slice(0, 10)) add("mid", "Journal ມືລົງວັນທີຍ້ອນຫຼັງ > 30 ວັນ", j.number + " · ວັນທີ " + j.date + " ບັນທຶກ " + j.created_at.slice(0, 10), "#/gl");
    });
    // money left uncleared
    Store.where("bank_statements", s => !s.matched && days(s.date, asOf) > 30).forEach(s => add("mid", "ລາຍການທະນາຄານຄ້າງຈັບຄູ່ > 30 ວັນ", s.date + " " + (s.ref || "") + " " + Math.round(s.amount).toLocaleString("en-US"), "#/banking"));
    if (window.Flows) Flows.overdueAdvances(asOf).forEach(a => add("high", "ເງິນສຳຮອງເກີນກຳນົດເຄລຍ", a.number + " · " + a.payee + " · ກຳນົດ " + a.due_clear, "#/requests?id=" + a.id));
    // staff overrides of guard warnings still not reviewed
    const rv = Store.where("guard_log", l => l.needs_review).length;
    if (rv) add("mid", "ພະນັກງານຢືນຢັນຂ້າມຄຳເຕືອນ ລໍທົບທວນ", rv + " ລາຍການ", "");
    const ORDER = { high: 0, mid: 1, low: 2 };
    return out.sort((a, b) => ORDER[a.sev] - ORDER[b.sev]);
  }

  window.Checks = { matchBank, postBankItem, importStatement, bankLines, scan };
})();
