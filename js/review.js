/* ============================================================
   ST ERP – Staff pick a CATEGORY, accounting checks the journal afterwards
   · Cat      – categories (name → account) so staff never see account codes / Dr-Cr; roles that can open the ledger still do
   · Review   – a posted journal can be flagged "ລໍກວດ" (by source type, by amount, or by a flagged category); finance confirms it,
                or sends a correction (type JEFIX → goes through the approval chain, then reverses the old entry and posts the new one)
   · ReviewUI – the "ກວດບັນຊີ" page + rule / category editors
   ============================================================ */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s)), M = v => UI.money(v);
  const role = () => (window.AppCtx && AppCtx.currentRole ? AppCtx.currentRole() : "Admin");
  const who = () => (window.AppCtx && AppCtx.userLabel ? AppCtx.userLabel() : role());
  const sees = r => { try { return !!Perms.can(r || role(), "gl", "view"); } catch (e) { return true; } };

  /* ---------------- categories ---------------- */
  const catItems = () => ((Store.get("settings", "categories") || {}).items || []);
  const setSetting = (id, data) => { const cur = Store.get("settings", id); if (cur) Store.update("settings", id, data); else Store.insert("settings", Object.assign({ id }, data)); };
  const Cat = {
    sees,
    items: kind => catItems().filter(c => !kind || c.kind === kind),
    // the accounts a person may pick: everything for ledger roles; only the defined categories for everyone else (the one already chosen stays)
    accounts(list, kind, keep) {
      if (sees()) return list;
      const codes = Cat.items(kind).map(c => c.account);
      return codes.length ? list.filter(a => codes.indexOf(a.code) >= 0 || a.code === keep) : list;
    },
    label(a, kind) { if (sees()) return a.code + " " + a.name; const c = Cat.items(kind).find(x => x.account === a.code); return c ? c.name : a.name; },
    save: items => setSetting("categories", { items })
  };

  /* ---------------- review rules ---------------- */
  const TYPES = [["BILL", "Bill ຊື້"], ["REQUEST", "ຂໍເບີກ / ຂໍຈ່າຍ / ລາຍຈ່າຍ"], ["PAYMENT", "ຮັບ / ຈ່າຍເງິນ"], ["GRN", "ຮັບສິນຄ້າ"], ["PAYROLL", "ເງິນເດືອນ"], ["QUICK", "ບັນທຶກດ່ວນ"], ["MANUAL", "Journal ມື"], ["STOCK_ADJ", "ປັບ/ຈ່າຍສະຕັອກ"], ["INVOICE", "Invoice ຂາຍ"], ["TRANSFER", "ໂອນເງິນ"], ["DEPR", "ຄ່າເສື່ອມ"], ["POS_DAILY", "ຍອດຂາຍ POS ລາຍວັນ"]];
  const TYPE_NAME = {}; TYPES.forEach(t => { TYPE_NAME[t[0]] = t[1]; });
  const DEFAULT_TYPES = ["BILL", "REQUEST", "QUICK", "MANUAL", "STOCK_ADJ", "PAYROLL"];
  const rules = () => Object.assign({ types: DEFAULT_TYPES, min: 0 }, Store.get("settings", "review") || {});

  // called by Acc.postJournal for every new entry
  function needs(source_type, total, lines) {
    if (Store.isDry && Store.isDry()) return false;
    const r = rules();
    if (Number(r.min) > 0 && Number(total) >= Number(r.min)) return true;
    const flagged = catItems().filter(c => c.review).map(c => c.account);
    if (flagged.length && (lines || []).some(l => flagged.indexOf(l.account) >= 0)) return true;
    return (r.types || []).indexOf(source_type) >= 0;
  }
  const pending = () => Store.where("journal_entries", j => j.review === "pending" && j.status === "posted").sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  function needLedger() { if (!sees()) throw new Error("ສະເພາະການເງິນ / ການບັນຊີ ກວດ Journal ໄດ້"); }
  function confirm(id) {
    needLedger();
    const je = Store.get("journal_entries", id); if (!je || je.review !== "pending") throw new Error("Journal ນີ້ບໍ່ໄດ້ລໍກວດ");
    Store.update("journal_entries", id, { review: "confirmed", reviewed_by: who(), reviewed_at: new Date().toISOString() });
    Acc.audit("review", "journal_entries", id, je.number + " ຢືນຢັນ");
  }
  function confirmMany(ids) { needLedger(); ids.forEach(confirm); return ids.length; }

  /* ---------------- correction = a gate document ---------------- */
  const linesOf = id => Store.where("journal_lines", l => l.je_id === id);
  Gate.register("JEFIX", {
    label: "ແກ້ໄຂ Journal (ກວດບັນຊີ)", prefix: "JF", title: ["ໃບຂໍແກ້ໄຂ Journal", "JOURNAL CORRECTION"],
    attachHint: "ເຫດຜົນ / ເອກະສານອ້າງອີງ",
    amount: p => (p.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0),
    validate(p) {
      if (!String(p.reason || "").trim()) throw new Error("ໃສ່ເຫດຜົນທີ່ແກ້ໄຂ");
      (p.lines || []).forEach(l => { const a = Acc.acc(l.account); if (!a) throw new Error("ບໍ່ພົບບັນຊີ " + l.account); if (Number(a.is_header)) throw new Error("ບັນຊີຫົວໝວດ: " + l.account); });
    },
    describe(p) {
      const je = Store.get("journal_entries", p.je_id) || {}, nm = c => String((Acc.acc(c) || {}).name || c);
      const old = linesOf(p.je_id).map(l => ["ເດີມ · " + l.account + " " + nm(l.account), l.debit ? M(l.debit) : "", l.credit ? M(l.credit) : ""]);
      const now = (p.lines || []).map(l => ["ໃໝ່ · " + l.account + " " + nm(l.account), l.debit ? M(l.debit) : "", l.credit ? M(l.credit) : ""]);
      return { meta: [["Journal ເດີມ", je.number || "-"], ["ແຫຼ່ງ", TYPE_NAME[je.source_type] || je.source_type || "-"], ["ເຫດຜົນ", p.reason || ""]], cols: ["ບັນຊີ", "Dr", "Cr"], rows: old.concat(now), totals: [["ຍອດ", M(je.total_debit || 0), true]] };
    },
    run(p) {
      const je = Store.get("journal_entries", p.je_id); if (!je || je.status !== "posted") throw new Error("Journal ເດີມຖືກແກ້/ຍົກເລີກແລ້ວ");
      const rev = linesOf(je.id).map(l => ({ account: l.account, debit: l.credit, credit: l.debit, memo: "ກັບລາຍການ " + je.number }));
      Acc.postJournal({ date: je.date, source_type: je.source_type + "_VOID", source_id: je.source_id, memo: "ແກ້ໄຂ " + je.number + ": " + p.reason, lines: rev });
      const nj = Acc.postJournal({ date: je.date, source_type: je.source_type + "_FIX", source_id: je.source_id, memo: je.memo + " (ແກ້ໄຂ)", lines: p.lines.map(l => ({ account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo || "" })), dim: je.dim });
      Store.update("journal_entries", je.id, { status: "reversed", review: "fixed", reviewed_by: who(), reviewed_at: new Date().toISOString() });
      Store.update("journal_entries", nj.id, { review: "confirmed", reviewed_by: who(), reviewed_at: new Date().toISOString() });
      return nj;
    }
  });

  /* ---------------- staff-facing wording: no accounting jargon ---------------- */
  const PLAIN = [[/\s*[&+]\s*ລົງບັນຊີ/g, ""], [/ລົງບັນຊີແລ້ວ/g, "ສຳເລັດແລ້ວ"], [/ລົງບັນຊີ/g, "ບັນທຶກ"]];
  function plainNode(root) {
    if (!document.body.classList.contains("no-acct") || !root.querySelectorAll) return;
    const hit = root.matches && root.matches(SEL) ? [root] : [];
    Array.from(root.querySelectorAll(SEL)).concat(hit).forEach(el => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t;
      while ((t = w.nextNode())) { let v = t.nodeValue; PLAIN.forEach(([a, b]) => { v = v.replace(a, b); }); if (v !== t.nodeValue) t.nodeValue = v; }
    });
  }
  const SEL = ".btn, .toast-tx, .dv-lb, .nb-title, .chip, .dv-notice";
  function applyView() {
    document.body.classList.toggle("no-acct", !sees());
    if (!applyView.obs) { applyView.obs = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) plainNode(n); }))); applyView.obs.observe(document.body, { childList: true, subtree: true }); }
    plainNode(document.body);
  }

  window.Cat = Cat;
  window.Review = { rules, needs, pending, confirm, confirmMany, TYPES, TYPE_NAME, applyView, sees };
})();
