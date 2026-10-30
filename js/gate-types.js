/* ============================================================
   LaoBooks ERP – What each gate document is and what it does when approved
   register(type, { label, prefix, title:[lao, eng], amount(p), validate(p), describe(p) → document body, run(p, {role}) })
   describe() fills the printable document (meta / lines / totals); run() is the SAME function the button used to call.
   ============================================================ */
(function () {
  const M = v => UI.money(v);
  const nameOf = (coll, id, f) => ((Store.get(coll, id) || {})[f || "name"]) || "-";

  Gate.register("GRN", {
    attachHint: "ຮູບເຄື່ອງທີ່ໄດ້ຮັບ + ໃບສົ່ງເຄື່ອງ",
    label: "ໃບຮັບສິນຄ້າ (GRN)", prefix: "GRQ", title: ["ໃບຂໍຮັບສິນຄ້າເຂົ້າສາງ", "GOODS RECEIPT REQUEST"],
    lines(p) { return (p.receipt || []).filter(r => Number(r.qty) > 0).map(r => { const l = Store.get("po_lines", r.po_line_id) || {}; return { l, qty: Number(r.qty) }; }); },
    amount(p) { return this.lines(p).reduce((s, x) => s + x.qty * Number(x.l.price || 0), 0); },
    validate(p) { if (!this.lines(p).length) throw new Error("ໃສ່ຈຳນວນທີ່ໄດ້ຮັບ"); },
    describe(p) {
      const c = Store.get("purchase_requisitions", p.case_id) || {}, po = Store.get("purchase_orders", c.po_id) || {};
      return { meta: [["ອ້າງອີງ PO", po.number || "-"], ["ຜູ້ສະໜອງ", nameOf("vendors", po.vendor_id)], ["ວັນທີຮັບເຄື່ອງ", UI.fmtDate(p.date)], ["ໝາຍເຫດ", p.note || ""]],
        cols: ["ລາຍການ", "ຈຳນວນຮັບ", "ລາຄາ", "ລວມ"], rows: this.lines(p).map(x => [x.l.description || "", String(x.qty), M(x.l.price), M(x.qty * Number(x.l.price))]), totals: [["ມູນຄ່າຮັບເຄື່ອງ", M(this.amount(p)), true]] };
    },
    run: p => Procure.receive(p.case_id, p.role, { date: p.date, receipt: p.receipt, note: p.note })
  });

  Gate.register("RCPT", {
    attachHint: "ສະລິບໂອນ / ຫຼັກຖານການຮັບເງິນ",
    label: "ໃບຮັບເງິນ (ຮັບຊຳລະ Invoice)", prefix: "RQ", title: ["ໃບຂໍບັນທຶກຮັບເງິນ", "RECEIPT REQUEST"],
    amount: p => Number(p.amount) || 0,
    validate(p) { if (!(Number(p.amount) > 0)) throw new Error("ໃສ່ຈຳນວນ"); },
    describe(p, d) {
      const inv = Store.get("invoices", p.invoice_id) || {}, bank = Store.get("bank_accounts", p.bank_id) || {};
      return { meta: [["Invoice", inv.number || "-"], ["ລູກຄ້າ", nameOf("customers", inv.customer_id)], ["ເຂົ້າບັນຊີ", bank.name || "-"], ["ວັນທີຮັບເງິນ", UI.fmtDate(p.date)]],
        cols: ["ລາຍການ", "ຍອດ"], rows: [["ຮັບຊຳລະ " + (inv.number || ""), M(p.amount)]], totals: [["ຍອດຮັບ", M(p.amount), true], ["ຄ້າງຫຼັງຮັບ", M(Number(inv.total || 0) - Number(inv.paid || 0) - (d && d.status === "posted" ? 0 : Number(p.amount)))]] };
    },
    run: p => Acc.receivePayment({ invoice_id: p.invoice_id, bank_id: p.bank_id, amount: Number(p.amount), date: p.date })
  });

  Gate.register("PAYV", {
    attachHint: "ໃບເກັບເງິນ + ສະລິບໂອນ",
    label: "ໃບຈ່າຍເງິນ (ຈ່າຍ Bill)", prefix: "PQ", title: ["ໃບຂໍຈ່າຍເງິນ Bill", "PAYMENT REQUEST"],
    amount: p => Number(p.amount) || 0,
    validate(p) { if (!(Number(p.amount) > 0)) throw new Error("ໃສ່ຈຳນວນ"); },
    describe(p, d) {
      const b = Store.get("bills", p.bill_id) || {}, bank = Store.get("bank_accounts", p.bank_id) || {};
      return { meta: [["Bill", b.number || "-"], ["ຜູ້ສະໜອງ", nameOf("vendors", b.vendor_id)], ["ຈ່າຍຈາກບັນຊີ", bank.name || "-"], ["ວັນທີຈ່າຍ", UI.fmtDate(p.date)]],
        cols: ["ລາຍການ", "ຍອດ"], rows: [["ຈ່າຍ " + (b.number || ""), M(p.amount)]], totals: [["ຍອດຈ່າຍ", M(p.amount), true], ["ຄ້າງຫຼັງຈ່າຍ", M(Number(b.total || 0) - Number(b.paid || 0) - (d && d.status === "posted" ? 0 : Number(p.amount)))]] };
    },
    run: p => Acc.payBill({ bill_id: p.bill_id, bank_id: p.bank_id, amount: Number(p.amount), date: p.date })
  });

  Gate.register("DEPR", {
    attachHint: "ຕາຕະລາງຄ່າເສື່ອມ (ຖ້າມີ)",
    label: "ໃບຄ່າເສື່ອມລາຄາ", prefix: "DQ", title: ["ໃບອະນຸມັດຄ່າເສື່ອມລາຄາ", "DEPRECIATION APPROVAL"],
    amount: p => Number(p.amount) || 0,
    describe(p) {
      const rows = Store.where("assets", a => a.status === "active" && Number(a.acc_dep) < Number(a.cost) && (!a.date || a.date.slice(0, 7) <= p.period))
        .map(a => [a.name, M(a.cost), M(Math.min(Number(a.cost) / Number(a.life_months || 1), Number(a.cost) - Number(a.acc_dep)))]);
      return { meta: [["ງວດ", p.period], ["ວັນທີລົງບັນຊີ", UI.fmtDate(p.date)]], cols: ["ຊັບສິນ", "ຕົ້ນທຶນ", "ຄ່າເສື່ອມງວດນີ້"], rows, totals: [["ລວມຄ່າເສື່ອມ", M(p.amount), true]] };
    },
    run: p => Autopost.manual("DEPR", "", p.date)
  });

  Gate.register("PAYROLL", {
    attachHint: "ໃບເງິນເດືອນ / ໃບລາຍຊື່ລົງລາຍເຊັນ",
    label: "ໃບເງິນເດືອນ", prefix: "SQ", title: ["ໃບອະນຸມັດເງິນເດືອນ", "PAYROLL APPROVAL"],
    amount: p => Number((Store.get("payroll", p.run_id) || {}).net_total) || 0,
    describe(p) {
      const r = Store.get("payroll", p.run_id) || {};
      return { meta: [["ງວດ", r.period || "-"], ["ຈຳນວນພະນັກງານ", String(r.count || 0)], ["ຜູ້ຄິດເງິນເດືອນ", r.prepared_by || ""]],
        cols: ["ລາຍການ", "ຍອດ"], rows: [["ເງິນເດືອນລວມ (Gross)", M(r.gross_total)], ["ພາສີເງິນໄດ້ (PIT)", M(r.pit_total)], ["LSSO ພະນັກງານ", M(r.lsso_emp)], ["LSSO ນາຍຈ້າງ (ຄ່າໃຊ້ຈ່າຍ)", M(r.lsso_er)]], totals: [["ຈ່າຍສຸດທິ", M(r.net_total), true]] };
    },
    run(p, ctx) {
      const run = Store.get("payroll", p.run_id); if (!run) throw new Error("ບໍ່ພົບງວດເງິນເດືອນ");
      if (run.status === "posted") throw new Error("ງວດນີ້ລົງບັນຊີແລ້ວ");
      const bank = Store.all("bank_accounts")[0], date = p.date || new Date().toISOString().slice(0, 10);
      Acc.postJournal({ date, source_type: "PAYROLL", source_id: run.period, memo: "ເງິນເດືອນ " + run.period, lines: [
        { account: Acc.PA("SALARY"), debit: run.gross_total, credit: 0, memo: "ເງິນເດືອນ" },
        { account: Acc.PA("LSSO_EXP"), debit: run.lsso_er, credit: 0, memo: "LSSO ນາຍຈ້າງ" },
        { account: Acc.PA("PIT"), debit: 0, credit: run.pit_total, memo: "PIT ຄ້າງຈ່າຍ" },
        { account: Acc.PA("LSSO_PAY"), debit: 0, credit: run.lsso_total, memo: "LSSO ຄ້າງຈ່າຍ" },
        { account: bank ? bank.gl_account : "1100", debit: 0, credit: run.net_total, memo: "ຈ່າຍເງິນເດືອນສຸດທິ" }] });
      Store.update("payroll", run.id, { status: "posted", approved_by: ctx.role, approved_at: new Date().toISOString() });
      return run;
    }
  });

  Gate.register("PAYC", {
    attachHint: "ບິນຜູ້ສະໜອງ + ສະລິບໂອນ",
    label: "ໃບຈ່າຍເງິນ (ຂະບວນຈັດຊື້)", prefix: "PC", title: ["ໃບຂໍຈ່າຍເງິນ ຕາມໃບບິນຈັດຊື້", "PURCHASE PAYMENT REQUEST"],
    amount: p => Number(p.amount) || 0,
    validate(p) { if (!(Number(p.amount) > 0)) throw new Error("ໃສ່ຈຳນວນເງິນ"); },
    describe(p) {
      const c = Store.get("purchase_requisitions", p.case_id) || {}, bank = Store.get("bank_accounts", p.bank_id) || {};
      return { meta: [["ເລກຈັດຊື້", c.number || "-"], ["ເຫດຜົນ", c.purpose || ""], ["ຈ່າຍຈາກບັນຊີ", bank.name || "-"], ["ວັນທີຈ່າຍ", UI.fmtDate(p.date)]], cols: ["ລາຍການ", "ຍອດ"], rows: [["ຈ່າຍຜູ້ສະໜອງ " + (c.number || ""), M(p.amount)]], totals: [["ຍອດຈ່າຍ", M(p.amount), true]] };
    },
    run: p => Procure.pay(p.case_id, p.role, { bank_id: p.bank_id, amount: Number(p.amount), date: p.date })
  });
})();
