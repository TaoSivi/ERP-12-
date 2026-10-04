/* ============================================================
   LaoBooks ERP – Guard (pre-posting checks + precedents)
   ------------------------------------------------------------
   Runs BEFORE a document / manual journal is posted and returns findings.
   • severity "warn"  → anyone may continue, but must give a reason
   • severity "block" → only a Manager/Admin may continue (with a reason)
   Reasons accepted from an approver are stored as PRECEDENTS: the next time the
   same rule + key shows up, the post goes through automatically (and is logged).
   The same `review()` seam is where an AI reviewer can be plugged in later.
   Pure logic only (no DOM) so it can be unit-tested in Node.
   ============================================================ */
(function () {
  const DAY = 86400000;
  const today = () => new Date().toISOString().slice(0, 10);
  const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
  const money = n => Math.round(Number(n) || 0).toLocaleString("en-US");

  const LIVE = { invoice: ["posted", "partial", "paid"], bill: ["posted", "partial", "paid"] };

  // learnable=false → a precedent may never auto-pass this rule (duplicates, missing memo, big manual JE)
  function F(rule, severity, key, msg, learnable) {
    return { rule, severity, key: rule + ":" + key, msg, learnable: learnable !== false };
  }

  function docTotal(kind, doc) {
    return kind === "invoice"
      ? Acc.invoiceTotals(Store.where("invoice_lines", l => l.invoice_id === doc.id)).total
      : Acc.billTotals(Store.where("bill_lines", l => l.bill_id === doc.id)).total;
  }

  function dateChecks(out, date) {
    if (!date) return;
    const d = dayDiff(date, today());
    if (d > 0) out.push(F("DATE_FUTURE", "warn", "x", "ວັນທີເອກະສານ (" + date + ") ຢູ່ໃນອະນາຄົດ " + d + " ວັນ"));
    if (d < -60) out.push(F("DATE_OLD", "warn", "x", "ວັນທີເອກະສານ (" + date + ") ຍ້ອນຫຼັງເກີນ 60 ວັນ"));
  }

  function checkDocument(kind, doc) {
    const out = [];
    const partyField = kind === "invoice" ? "customer_id" : "vendor_id";
    const coll = kind === "invoice" ? "invoices" : "bills";
    const party = doc[partyField] || "";
    const total = docTotal(kind, doc);
    const label = kind === "invoice" ? "Invoice" : "Bill";

    const prior = Store.where(coll, d => d.id !== doc.id && d[partyField] === party && LIVE[kind].includes(d.status));

    // exact duplicate: same party, same total, within 7 days
    const dup = prior.find(d => Math.abs(docTotal(kind, d) - total) < 0.5 && Math.abs(dayDiff(d.date, doc.date)) <= 7);
    if (dup) out.push(F("DUPLICATE", "block", kind + ":" + party,
      label + " ນີ້ຄ້າຍກັບ " + dup.number + " (ຄູ່ຄ້າດຽວກັນ, ຍອດ " + money(total) + " ຄືກັນ, ວັນທີໃກ້ກັນ) — ອາດບັນທຶກຊ້ຳ", false));

    // unusually large for this party (needs history)
    if (prior.length >= 3) {
      const avg = prior.reduce((s, d) => s + docTotal(kind, d), 0) / prior.length;
      if (avg > 0 && total > avg * 3)
        out.push(F("UNUSUAL_AMOUNT", "warn", kind + ":" + party,
          "ຍອດ " + money(total) + " ສູງກວ່າສະເລ່ຍຂອງຄູ່ຄ້ານີ້ (" + money(avg) + ") ເກີນ 3 ເທົ່າ"));
    }

    if (kind === "invoice") {
      Store.where("invoice_lines", l => l.invoice_id === doc.id).forEach(l => {
        const it = Store.get("items", l.item_id);
        const cost = it ? Number(it.avg_cost) || 0 : 0;
        const ra = it && it.income_account ? Acc.acc(it.income_account) : null;
        if (ra && ra.type !== "Revenue")
          out.push(F("ACCOUNT_TYPE", "warn", ra.code, "ສິນຄ້າ " + it.name + " ລົງລາຍຮັບເຂົ້າບັນຊີ " + ra.code + " " + ra.name + " (ປະເພດ " + ra.type + ") — ກວດການຕັ້ງບັນຊີສິນຄ້າ"));
        if (it && it.type === "stock" && cost > 0 && Number(l.price) - (Number(l.discount) || 0) / (Number(l.qty) || 1) < cost)
          out.push(F("BELOW_COST", "warn", it.id, "ຂາຍ " + it.name + " ຕ່ຳກວ່າຕົ້ນທຶນ (ລາຄາ " + money(l.price) + " < ຕົ້ນທຶນ " + money(cost) + ")"));
      });
    } else {
      if (doc.po_id && window.Procure)
        Procure.matchFindings(doc).forEach(m => out.push(F(m.rule, "block", "x", "3-way match: " + m.msg, false)));
      Store.where("bill_lines", l => l.bill_id === doc.id).forEach(l => {
        const a = Acc.acc(l.account_id || "5200");
        if (a && (a.type === "Revenue" || a.type === "Equity"))
          out.push(F("ACCOUNT_TYPE", "warn", a.code, "ບັນຊີ " + a.code + " " + a.name + " ເປັນປະເພດ " + a.type + " — ບໍ່ຄວນໃຊ້ກັບຄ່າໃຊ້ຈ່າຍ/ຊື້"));
      });
    }
    dateChecks(out, doc.date);
    return out;
  }

  // manual journal: { date, memo, lines:[{account,debit,credit}] }
  function checkJournal(doc, opts) {
    opts = opts || {};
    const out = [];
    const memo = String(doc.memo || "").trim();
    if (!opts.skipMemo && memo.length < 5)
      out.push(F("JE_MEMO", "block", "x", "Journal ມືບໍ່ມີຄຳອະທິບາຍ (memo) — ຕ້ອງລະບຸເຫດຜົນຂອງລາຍການ", false));

    const control = { "1200": "ລູກໜີ້ (AR)", "2100": "ເຈົ້າໜີ້ (AP)", "1300": "ສິນຄ້າຄົງເຫຼືອ", "1400": "VAT ຊື້", "2200": "VAT ຂາຍ" };
    const seen = new Set();
    (doc.lines || []).forEach(l => {
      const code = String(l.account);
      if (control[code] && !seen.has(code) && (Number(l.debit) || Number(l.credit))) {
        seen.add(code);
        out.push(F("JE_CONTROL", "warn", code, "ແກ້ບັນຊີຄຸມ " + code + " " + control[code] + " ດ້ວຍມື — ປົກກະຕິຄວນຜ່ານ Invoice/Bill/Payment"));
      }
    });
    const bankCodes = new Set(Store.all("bank_accounts").map(b => String(b.gl_account)));
    (doc.lines || []).forEach(l => {
      const code = String(l.account);
      if (bankCodes.has(code) && !seen.has(code) && (Number(l.debit) || Number(l.credit))) {
        seen.add(code);
        out.push(F("JE_CASH", "warn", code, "ແກ້ບັນຊີເງິນສົດ/ທະນາຄານ " + code + " ດ້ວຍມື — ຄວນໃຊ້ໜ້າທະນາຄານ/ຮັບ-ຈ່າຍເງິນ"));
      }
    });

    const company = Store.get("settings", "company") || {};
    const limit = Number(company.approval_limit) || 0;
    const amount = (doc.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0);
    if (limit > 0 && amount > limit)
      out.push(F("JE_LARGE", "block", "x", "ຍອດ " + money(amount) + " ເກີນວົງເງິນອະນຸມັດ (" + money(limit) + ")", false));
    dateChecks(out, doc.date);
    return out;
  }

  /* ---------- precedents + log ---------- */
  function findPrecedent(f) {
    if (!f.learnable) return null;
    return Store.where("precedents", p => p.rule === f.rule && p.key === f.key && p.active !== false)[0] || null;
  }

  // → { status: "ok" | "precedent" | "needs_decision", findings: [...], needsApprover: bool }
  function review(kind, doc, opts) {
    const findings = (kind === "journal" ? checkJournal(doc, opts) : checkDocument(kind, doc))
      .map(f => Object.assign(f, { precedent: findPrecedent(f) }));
    if (!findings.length) return { status: "ok", findings, needsApprover: false };
    if (findings.every(f => f.precedent)) return { status: "precedent", findings, needsApprover: false };
    const open = findings.filter(f => !f.precedent);
    return { status: "needs_decision", findings, needsApprover: open.some(f => f.severity === "block") };
  }

  // Record the outcome. `role` is the acting role, `isApprover` whether they may approve.
  // Reasons from approvers become precedents; reasons from staff are logged for review.
  function record({ kind, doc, result, reason, role, isApprover }) {
    const ts = new Date().toISOString();
    const outcome = result.status === "precedent" ? "auto_precedent" : (isApprover ? "approved" : "staff_override");
    result.findings.forEach(f => {
      if (f.precedent) {
        Store.update("precedents", f.precedent.id, { uses: (Number(f.precedent.uses) || 0) + 1, last_used: ts });
      } else if (isApprover && f.learnable) {
        Store.insert("precedents", { rule: f.rule, key: f.key, reason, msg: f.msg, approved_by: role, ts, uses: 0, active: true });
      }
    });
    Store.insert("guard_log", {
      ts, kind, doc_id: doc.id || "", doc_ref: doc.number || doc.memo || "", role, outcome, reason: reason || "",
      findings: result.findings.map(f => f.rule + ": " + f.msg).join(" | "),
      needs_review: outcome === "staff_override"
    });
    return outcome;
  }

  window.Guard = { review, record, checkDocument, checkJournal };
})();
