/* ============================================================
   LaoBooks ERP – ຮັບທຸລະກຳຈາກແອັບອື່ນ (API token)
   Other apps POST records to a mailbox (gas/Code.gs, own INGEST token); the ERP pulls them with a
   separate READ token and posts each one. Both tokens live ONLY in this browser (localStorage) and in
   the Apps Script properties — never in the repo.
   Record: {id, source, type:"sale"|"expense"|"journal", date:"YYYY-MM-DD", memo?, amount, vat?, pay?:"cash"|"bank"|"credit", account?, lines?:[{account,debit,credit}]}
   • IDEMPOTENT  one `ext_in` row per source:id; pulling twice never posts twice.
   • A record that cannot post (unknown account, unbalanced, locked period …) is `blocked` with the reason.
   ============================================================ */
(function () {
  const round = n => Math.round((Number(n) || 0) * 100) / 100;
  const PAY = { cash: "1110", bank: "1100" };
  const get = id => Store.get("settings", id);
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k) || ""; localStorage.setItem(k, v); } catch (e) { return ""; } };
  let transport = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) }).then(r => r.json());

  function link() { const c = get("ext_link") || {}; return { url: String(c.url || "").trim(), ingest: ls("laobooks_ext_ingest"), read: ls("laobooks_ext_read"), last_pull: c.last_pull || "" }; }
  function setUrl(url) { if (get("ext_link")) Store.update("settings", "ext_link", { url }); else Store.insert("settings", { id: "ext_link", url }); }
  function hex(n) { const a = new Uint8Array(n); window.crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, "0")).join(""); }
  function newTokens() { const t = { ingest: "ing_" + hex(24), read: "rd_" + hex(24) }; ls("laobooks_ext_ingest", t.ingest); ls("laobooks_ext_read", t.read); return t; }

  function lines(r) {
    if (r.type === "journal") return (r.lines || []).map(l => ({ account: String(l.account), debit: round(l.debit), credit: round(l.credit) }));
    const amt = round(r.amount), vat = round(r.vat || 0), tot = round(amt + vat), sale = r.type === "sale";
    if (!(amt > 0)) throw new Error("amount ຕ້ອງ > 0");
    const pay = r.pay || "bank", settle = PAY[pay] || (pay === "credit" ? (sale ? "1200" : "2100") : null);
    if (!settle) throw new Error("pay ຕ້ອງເປັນ cash|bank|credit");
    const acct = String(r.account || (sale ? "4100" : "5200"));
    return sale ? [{ account: settle, debit: tot, credit: 0 }, { account: acct, debit: 0, credit: amt }].concat(vat ? [{ account: "2200", debit: 0, credit: vat }] : [])
      : [{ account: acct, debit: amt, credit: 0 }].concat(vat ? [{ account: "1400", debit: vat, credit: 0 }] : []).concat([{ account: settle, debit: 0, credit: tot }]);
  }
  function check(r) {
    if (!r || typeof r !== "object") throw new Error("record ບໍ່ຖືກຕ້ອງ");
    if (!/^[\w.\-]{1,64}$/.test(String(r.id || ""))) throw new Error("id ຕ້ອງເປັນ a-z 0-9 _ - . ≤64");
    if (!/^[\w.\-]{1,32}$/.test(String(r.source || ""))) throw new Error("source ບໍ່ຖືກຕ້ອງ");
    if (["sale", "expense", "journal"].indexOf(r.type) < 0) throw new Error("type ຕ້ອງເປັນ sale|expense|journal");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || "")) || isNaN(Date.parse(r.date))) throw new Error("date ຕ້ອງເປັນ YYYY-MM-DD");
    const ls2 = lines(r), d = round(ls2.reduce((s, l) => s + l.debit, 0)), c = round(ls2.reduce((s, l) => s + l.credit, 0));
    if (ls2.length < 2 || !(d > 0) || Math.abs(d - c) > 0.5) throw new Error("ບໍ່ດຸ່ນ ຫຼື ບໍ່ມີລາຍການ (Dr " + d + " ≠ Cr " + c + ")");
    ls2.forEach(l => { const a = Acc.acc(l.account); if (!a || a.is_header) throw new Error("ບໍ່ມີບັນຊີ " + l.account); if (l.debit < 0 || l.credit < 0 || (l.debit && l.credit)) throw new Error("ລາຍການ " + l.account + " ບໍ່ຖືກ"); });
    return ls2;
  }
  const keyOf = r => String(r && r.source) + ":" + String(r && r.id);
  function process(r) {
    const key = keyOf(r), have = Store.get("ext_in", key);
    if (have && have.status === "posted") return have;
    const base = { id: key, source: String(r.source), ext_id: String(r.id), date: String(r.date), type: String(r.type), amount: round(r.amount), memo: String(r.memo || ""), received: new Date().toISOString() };
    try {
      const ls2 = check(r), je = Acc.postJournal({ date: r.date, source_type: "EXT:" + r.source, source_id: key, memo: (r.memo || r.type) + " · " + r.source + ":" + r.id, lines: ls2 });
      Object.assign(base, { status: "posted", je_id: je && je.id, error: "" });
    } catch (e) { Object.assign(base, { status: "blocked", error: e.message }); }
    if (have) Store.update("ext_in", key, base); else Store.insert("ext_in", base);
    return Store.get("ext_in", key);
  }
  async function pull() {
    const k = link(); if (!k.url || !k.read) throw new Error("ຍັງບໍ່ໄດ້ຕັ້ງ URL / token");
    const res = await transport(k.url, { action: "pull", token: k.read });
    if (!res || !res.ok) throw new Error((res && res.error) || "pull ບໍ່ສຳເລັດ");
    const done = (res.records || []).map(process), ack = done.map(d => d.id);
    if (ack.length) await transport(k.url, { action: "ack", token: k.read, ids: ack });
    Store.update("settings", "ext_link", { last_pull: new Date().toISOString().slice(0, 16).replace("T", " ") });
    return { posted: done.filter(d => d.status === "posted").length, blocked: done.filter(d => d.status === "blocked").length };
  }
  const recs = () => Store.all("ext_in").sort((a, b) => String(b.received).localeCompare(String(a.received)));
  window.ExtIn = { link, setUrl, newTokens, check, process, pull, recs, setTransport: f => { transport = f; } };
})();
