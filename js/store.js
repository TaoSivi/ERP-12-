/* ============================================================
   LaoBooks ERP – Data Store
   Works in two modes:
   • Demo Mode  → data kept in browser localStorage
   • Cloud Mode → data read/written to Google Sheet via Apps Script
   Same API either way:  Store.all(c) / .get(c,id) / .insert / .update / .remove
   ============================================================ */
(function () {
  const COLLECTIONS = [
    "settings","accounts","taxcodes","customers","vendors","items",
    "invoices","invoice_lines","bills","bill_lines",
    "journal_entries","journal_lines","payments","bank_accounts","stock_moves",
    "quotes","quote_lines","purchase_orders","po_lines",
    "credit_notes","cn_lines","debit_notes","dn_lines","prepaids","deferreds","fx_rates",
    "cost_centres","projects",
    "purchase_requisitions","pr_lines","recurring","bank_statements","locations","stock_serials","stock_transfers","leaves",
    "companies","salary_revisions","pos_days","ext_in","stock_docs",
    "sales_orders","so_lines","deliveries","delivery_lines","users","holidays",
    "boms","bom_lines",
    "employees","payroll","assets","budgets","audit_log",
    "precedents","guard_log","auto_runs","pr_quotes","approvals","grns","grn_lines","requests","request_lines","accruals","documents","doc_folders","announcements","announcement_acks","workflows","doc_templates","departments"
  ];

  const LS_KEY = "laobooks_db_v1";
  let DB = {};
  let backend = null;
  let counter = 0;

  function uid(prefix) {
    counter++;
    return (prefix || "id") + "_" + Date.now().toString(36) + counter.toString(36);
  }

  /* ---------- Local (Demo) backend ---------- */
  const LocalBackend = {
    kind: "demo",
    async loadAll() {
      const raw = localStorage.getItem(LS_KEY);
      const data = raw ? JSON.parse(raw) : {};
      const out = {};
      COLLECTIONS.forEach(c => (out[c] = data[c] || []));
      return out;
    },
    persist() { localStorage.setItem(LS_KEY, JSON.stringify(DB)); },
    async append() { this.persist(); },
    async update() { this.persist(); },
    async remove() { this.persist(); }
  };

  /* ---------- Remote (Google Sheet) backend ---------- */
  const RemoteBackend = {
    kind: "cloud",
    url: "",
    async call(action, payload) {
      const res = await fetch(this.url, {
        method: "POST",
        // text/plain avoids CORS pre-flight with Apps Script
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, payload })
      });
      const txt = await res.text();
      let json;
      try { json = JSON.parse(txt); } catch (e) { throw new Error("ຕອບກັບບໍ່ຖືກຕ້ອງ: " + txt.slice(0, 120)); }
      if (!json.ok) throw new Error(json.error || "server error");
      return json.data;
    },
    async loadAll() {
      const data = await this.call("loadAll", {});
      const out = {};
      COLLECTIONS.forEach(c => (out[c] = data[c] || []));
      return out;
    },
    async append(coll, obj) { await this.call("append", { sheet: coll, row: obj }); },
    async update(coll, id, obj) { await this.call("update", { sheet: coll, id, row: obj }); },
    async remove(coll, id) { await this.call("remove", { sheet: coll, id }); }
  };

  /* ---------- Seed defaults ---------- */
  function seedAccounts() {
    if (DB.accounts.length) return;
    const A = [
      ["1000","ໝວດຊັບສິນ","Asset",1],
      ["1100","ທະນາຄານ & ເງິນສົດ","Asset",0],
      ["1200","ລູກໜີ້ການຄ້າ (AR)","Asset",0],
      ["1300","ສິນຄ້າຄົງເຫຼືອ","Asset",0],
      ["1400","VAT ຮັບຄືນ (Input)","Asset",0],
      ["1500","GR/IR Clearing","Asset",0],
      ["1600","ຄ່າໃຊ້ຈ່າຍລ່ວງໜ້າ","Asset",0],
      ["1700","ຊັບສິນຖາວອນ","Asset",0],
      ["1750","ຄ່າເສື່ອມສະສົມ","Asset",0],
      ["2000","ໝວດໜີ້ສິນ","Liability",1],
      ["2100","ເຈົ້າໜີ້ການຄ້າ (AP)","Liability",0],
      ["2200","VAT ຕ້ອງຈ່າຍ (Output)","Liability",0],
      ["2300","PIT ຄ້າງຈ່າຍ","Liability",0],
      ["2350","LSSO ຄ້າງຈ່າຍ","Liability",0],
      ["2400","WHT ຄ້າງຈ່າຍ","Liability",0],
      ["2500","ເງິນຮັບລ່ວງໜ້າ","Liability",0],
      ["3000","ໝວດທຶນ","Equity",1],
      ["3100","ທຶນເຈົ້າຂອງ","Equity",0],
      ["3150","ຖອນທຶນ","Equity",0],
      ["3200","ກຳໄລສະສົມ","Equity",0],
      ["3900","Opening Balance Equity","Equity",0],
      ["4000","ໝວດລາຍຮັບ","Revenue",1],
      ["4100","ລາຍຮັບຈາກການຂາຍ","Revenue",0],
      ["4200","ລາຍຮັບອື່ນ","Revenue",0],
      ["4900","ກຳໄລ/ຂາດທຶນ ອັດຕາແລກປ່ຽນ","Revenue",0],
      ["5000","ໝວດຄ່າໃຊ້ຈ່າຍ","Expense",1],
      ["5100","ຕົ້ນທຶນຂາຍ (COGS)","Expense",0],
      ["5200","ຄ່າໃຊ້ຈ່າຍທົ່ວໄປ","Expense",0],
      ["5300","ເງິນເດືອນ","Expense",0],
      ["5350","LSSO ນາຍຈ້າງ","Expense",0],
      ["5400","ຄ່າເສື່ອມລາຄາ","Expense",0],
      ["5500","ໜີ້ສູນ (Bad Debt)","Expense",0],
      ["1250","ເງິນຄ້ຳປະກັນຮັບ (Retention)","Asset",0],
      ["1350","ງານລະຫວ່າງດຳເນີນ (WIP)","Asset",0],
      ["2550","ເງິນຄ້ຳປະກັນຈ່າຍ","Liability",0],
      ["2600","ອາກອນກຳໄລ ຄ້າງຈ່າຍ","Liability",0],
      ["5600","ຄ່າອາກອນກຳໄລ","Expense",0]
    ];
    A.forEach(([code,name,type,isHeader]) => {
      DB.accounts.push({ id: "acc_"+code, code, name, type, is_header: isHeader, is_active: 1 });
    });
  }

  // Accounts added after v1.7 — created on existing databases too (never renamed or removed)
  const EXTRA_ACCOUNTS = [
    ["1110","ເງິນສົດໜ້າຮ້ານ (ລິ້ນຊັກ)","Asset"],
    ["1120","ລໍເຂົ້າທະນາຄານ (ບັດ/QR)","Asset"],
    ["2170","ທິບຄ້າງຈ່າຍພະນັກງານ","Liability"],
    ["4110","ລາຍຮັບ ອາຫານ","Revenue"],
    ["4120","ລາຍຮັບ ເຄື່ອງດື່ມ","Revenue"],
    ["4300","ຄ່າບໍລິການ (Service charge)","Revenue"],
    ["5290","ຂອງເສຍ / ຂາດສາງ","Expense"],
    ["5295","ເງິນສົດເກີນ / ຂາດ","Expense"],
    ["1450","ເງິນສຳຮອງພະນັກງານ (Employee advance)","Asset"],
    ["2150","ຄ້າງຈ່າຍພະນັກງານ (ເບີກຄືນ)","Liability"],
    ["2160","ຄ່າໃຊ້ຈ່າຍຄ້າງຈ່າຍ (Accrued)","Liability"],
    ["2250","VAT ຕ້ອງຍື່ນ / ຄ້າງຮັບ (ສຸດທິ)","Liability"],
    ["5210","ຄ່າເຊົ່າ","Expense"],
    ["5220","ຄ່າໄຟຟ້າ & ນ້ຳປະປາ","Expense"],
    ["5230","ຄ່າໂທລະສັບ & ອິນເຕີເນັດ","Expense"],
    ["5240","ຄ່ານ້ຳມັນ & ເດີນທາງ","Expense"],
    ["5250","ຄ່າທຳນຽມທະນາຄານ","Expense"],
    ["5260","ເຄື່ອງໃຊ້ຫ້ອງການ","Expense"],
    ["5270","ຄ່າສ້ອມແປງ & ບຳລຸງຮັກສາ","Expense"],
    ["5280","ຄ່າຮັບຮອງ & ອາຫານ","Expense"]
  ];
  function ensureAccounts() {
    const have = new Set(DB.accounts.map(a => String(a.code)));
    EXTRA_ACCOUNTS.forEach(([code, name, type]) => {
      if (!have.has(code)) DB.accounts.push({ id: "acc_" + code, code, name, type, is_header: 0, is_active: 1 });
    });
  }

  function seedTax() {
    if (DB.taxcodes.length) return;
    DB.taxcodes.push({ id:"tax_out10", name:"VAT ຂາຍ 10%", rate:10, type:"Output" });
    DB.taxcodes.push({ id:"tax_in10",  name:"VAT ຊື້ 10%",  rate:10, type:"Input" });
    DB.taxcodes.push({ id:"tax_0",     name:"ບໍ່ມີ VAT",     rate:0,  type:"None" });
  }

  function seedSettings() {
    if (DB.settings.length) return;
    const c = ERP_CONFIG.COMPANY;
    DB.settings.push({ id:"company", name:c.name, tin:c.tin, currency:c.currency, vat_rate:c.vat_rate, fiscal_year_start:c.fiscal_year_start, lock_date:"", industry:"general" });
  }

  function seedBank() {
    if (DB.bank_accounts.length) return;
    DB.bank_accounts.push({ id:"bank_main", name:"ທະນາຄານ BCEL - ຫຼັກ", number:"010-12-00-123456", currency:"LAK", gl_account:"1100", opening_balance:0, created_at:new Date().toISOString() });
  }

  function seedDemo() {
    if (!ERP_CONFIG.SEED_DEMO_DATA || localStorage.getItem("laobooks_no_seed")) return; // "start empty" sets the flag
    if (DB.customers.length || DB.items.length) return;
    DB.customers.push({ id:uid("cust"), name:"ຮ້ານ ຄຳໃບ", tin:"2233445566", phone:"020 5555 1111", email:"khambai@example.la", address:"ນະຄອນຫຼວງວຽງຈັນ", currency:"LAK", terms:30, ar_account:"1200", credit_limit:50000000, status:"active", created_at:new Date().toISOString() });
    DB.customers.push({ id:uid("cust"), name:"ບໍລິສັດ ພູສີ ຈຳກັດ", tin:"9988776655", phone:"020 7777 2222", email:"phousi@example.la", address:"ຫຼວງພະບາງ", currency:"LAK", terms:15, ar_account:"1200", credit_limit:30000000, status:"active", created_at:new Date().toISOString() });
    DB.vendors.push({ id:uid("vend"), name:"ໂຮງງານ ນ້ຳດື່ມ ດາວ", tin:"1122334455", phone:"021 222 333", email:"dao@example.la", address:"ວຽງຈັນ", currency:"LAK", terms:30, ap_account:"2100", status:"active", created_at:new Date().toISOString() });
    const it1 = { id:uid("item"), sku:"WTR-500", name:"ນ້ຳດື່ມ 500ml (ແພັກ)", type:"stock", uom:"ແພັກ", sell_price:35000, buy_price:22000, income_account:"4100", inventory_account:"1300", cogs_account:"5100", tax_code:"tax_out10", reorder_point:20, qty:0, avg_cost:0, status:"active" };
    const it2 = { id:uid("item"), sku:"SRV-DEL", name:"ຄ່າບໍລິການຂົນສົ່ງ", type:"service", uom:"ຄັ້ງ", sell_price:50000, buy_price:0, income_account:"4100", inventory_account:"", cogs_account:"", tax_code:"tax_out10", reorder_point:0, qty:0, avg_cost:0, status:"active" };
    DB.items.push(it1, it2);
    // opening stock for it1 (100 packs @ 22,000)
    DB.stock_moves.push({ id:uid("mv"), date:new Date().toISOString().slice(0,10), item_id:it1.id, type:"in", qty:100, unit_cost:22000, ref_type:"OPENING", ref_id:"", seq:1 });
    it1.qty = 100; it1.avg_cost = 22000;
    // Opening inventory needs a balancing JE (Dr Inventory / Cr Opening Balance Equity)
    const openVal = 100 * 22000;
    const yr = new Date().getFullYear();
    DB.journal_entries.push({ id:"je_open", number:"JE-"+yr+"-0001", date:new Date().toISOString().slice(0,10), source_type:"OPENING", source_id:"", memo:"ຍອດສິນຄ້າຍົກມາ", total_debit:openVal, total_credit:openVal, status:"posted", created_at:new Date().toISOString() });
    DB.journal_lines.push({ id:"jl_open1", je_id:"je_open", account:"1300", account_name:"1300 ສິນຄ້າຄົງເຫຼືອ", debit:openVal, credit:0, memo:"ສິນຄ້າຍົກມາ" });
    DB.journal_lines.push({ id:"jl_open2", je_id:"je_open", account:"3900", account_name:"3900 Opening Balance Equity", debit:0, credit:openVal, memo:"ຍອດຍົກມາ" });
    DB.employees.push({ id:uid("emp"), name:"ນາງ ສົມໃຈ", dept:"ຂາຍ", position:"ພະນັກງານຂາຍ", phone:"020 9999 0000", start_date:"2024-01-15", base_salary:4500000, status:"active" });
  }

  let dry = false; // dryRun: work on a copy, persist nothing
  async function persistNew(coll, obj) {
    if (dry) return;
    try { await backend.append(coll, obj); }
    catch (e) { console.error(e); UI && UI.toast && UI.toast("ບັນທຶກຂຶ້ນ cloud ບໍ່ສຳເລັດ: " + e.message, "err"); }
  }

  const Store = {
    mode: "demo",
    async boot() {
      const url = (ERP_CONFIG.APPS_SCRIPT_URL || "").trim();
      if (url) { RemoteBackend.url = url; backend = RemoteBackend; this.mode = "cloud"; }
      else { backend = LocalBackend; this.mode = "demo"; }

      DB = await backend.loadAll();
      COLLECTIONS.forEach(c => { if (!Array.isArray(DB[c])) DB[c] = []; });

      // seed defaults if empty, add accounts newer versions need, then push ONLY the new rows
      // (pushing every row would duplicate the whole database in the Google Sheet)
      const known = {};
      COLLECTIONS.forEach(c => { known[c] = new Set(DB[c].map(r => r.id)); });
      seedAccounts(); seedTax(); seedSettings(); seedBank(); seedDemo(); ensureAccounts();
      const fresh = [];
      COLLECTIONS.forEach(c => DB[c].forEach(r => { if (!known[c].has(r.id)) fresh.push([c, r]); }));
      if (fresh.length) {
        if (backend === LocalBackend) LocalBackend.persist();
        else for (const [c, row] of fresh) { try { await backend.append(c, row); } catch (e) { console.warn(e); } }
      }
      return this.mode;
    },
    collections() { return COLLECTIONS.slice(); },
    isDry() { return dry; },
    // run fn against a COPY of the data (for "preview the journal"): the real data and the cloud are never touched
    dryRun(fn) { const real = DB; DB = JSON.parse(JSON.stringify(real)); dry = true; try { return fn(); } finally { DB = real; dry = false; } },
    all(coll) { return (DB[coll] || []).slice(); },
    raw(coll) { return DB[coll] || (DB[coll] = []); },
    get(coll, id) { return (DB[coll] || []).find(r => r.id === id) || null; },
    where(coll, fn) { return (DB[coll] || []).filter(fn); },

    insert(coll, obj) {
      if (!obj.id) obj.id = uid(coll.slice(0, 3));
      DB[coll].push(obj);
      persistNew(coll, obj);
      return obj;
    },
    update(coll, id, patch) {
      const row = this.get(coll, id);
      if (!row) return null;
      Object.assign(row, patch);
      if (dry) return row;
      if (backend === LocalBackend) LocalBackend.persist();
      else backend.update(coll, id, row).catch(e => console.error(e));
      return row;
    },
    remove(coll, id) {
      DB[coll] = (DB[coll] || []).filter(r => r.id !== id);
      if (dry) return;
      if (backend === LocalBackend) LocalBackend.persist();
      else backend.remove(coll, id).catch(e => console.error(e));
    },
    uid,
    // wipe demo data (only local)
    // empty = true → also skip the sample customers/items on the next start (a real, blank company)
    resetDemo(empty) { localStorage.removeItem(LS_KEY); if (empty) localStorage.setItem("laobooks_no_seed", "1"); else localStorage.removeItem("laobooks_no_seed"); }
  };

  window.Store = Store;
})();


