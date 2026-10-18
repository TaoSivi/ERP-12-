/* ============================================================
   LaoBooks ERP – Financial statements (layout of a PwC-reviewed set: financial position,
   income, changes in equity, cash flows), for one year or two years side by side.
   Pure logic (reads Store/Acc only) so it can be unit-tested in Node.
   • Every ledger account is classified into one statement line: built-in table → LT chart prefix
     rules → account type. The accountant can override any account (settings.fs.map).
   • Balance sheet: cumulative balance to the end date; ALL profit not yet closed to equity is added
     to retained earnings, so it balances whether or not the year-end close was posted.
   • Cash flow: indirect method derived from the balance-sheet movements, so the result always
     ties to the cash line (FX on cash is not split out — it stays inside the movements).
   ============================================================ */
(function () {
  const BS_LINES = [
    ["h", "ASSETS"], ["h2", "Current assets"],
    ["cash", "Cash and cash equivalents"], ["receivables", "Trade and other receivables, net"], ["inventories", "Inventories, net"], ["otherCA", "Other current assets"], ["t:ca", "Total current assets"],
    ["h2", "Non-current assets"],
    ["ppe", "Property, plant and equipment, net"], ["otherNCA", "Other non-current assets"], ["t:nca", "Total non-current assets"], ["t:assets", "Total assets"],
    ["h", "LIABILITIES AND EQUITY"], ["h2", "Current liabilities"],
    ["payables", "Trade and other payables"], ["otherCL", "Other current liabilities"], ["stBorrow", "Short-term borrowings"], ["t:cl", "Total current liabilities"],
    ["h2", "Non-current liabilities"], ["ncl", "Other non-current liabilities"], ["t:ncl", "Total non-current liabilities"], ["t:liab", "Total liabilities"],
    ["h", "Equity"], ["capital", "Share capital"], ["premium", "Share premium"], ["legal", "Legal reserve"], ["retained", "Retained earnings (deficits) – unappropriated"], ["t:equity", "Total equity"], ["t:le", "Total liabilities and equity"]
  ];
  const IS_LINES = [
    ["revenue", "Revenue from sales"], ["cogs", "Cost of sales"], ["t:gp", "Gross profit"],
    ["admin", "Selling and administrative expenses"], ["otherInc", "Other income"], ["fx", "Gain/(loss) on exchange rate"], ["t:op", "Operating profit/(loss)"],
    ["finance", "Finance costs"], ["t:pbt", "Profit/(loss) before income tax"], ["tax", "Income tax expenses"], ["t:np", "Profit/(loss) for the period"]
  ];
  const LABEL = {}; BS_LINES.concat(IS_LINES).forEach(l => { LABEL[l[0]] = l[1]; });
  const MAPPABLE = ["cash", "receivables", "inventories", "otherCA", "ppe", "otherNCA", "payables", "otherCL", "stBorrow", "ncl", "capital", "premium", "legal", "retained", "revenue", "cogs", "admin", "otherInc", "fx", "finance", "tax"];

  const BUILTIN = { 1100: "cash", 1110: "cash", 1120: "cash", 1200: "receivables", 1250: "receivables", 1300: "inventories", 1350: "otherCA", 1400: "otherCA", 1450: "otherCA", 1500: "otherCA", 1600: "otherCA", 1700: "ppe", 1750: "ppe",
    2100: "payables", 2150: "otherCL", 2160: "otherCL", 2170: "otherCL", 2200: "otherCL", 2250: "otherCL", 2300: "otherCL", 2350: "otherCL", 2400: "otherCL", 2500: "otherCL", 2550: "otherCL", 2600: "otherCL",
    3100: "capital", 3150: "retained", 3200: "retained", 3900: "retained",
    4100: "revenue", 4110: "revenue", 4120: "revenue", 4300: "revenue", 4200: "otherInc", 4900: "fx", 5100: "cogs", 5600: "tax" };

  function settings() { return (window.Store && Store.get("settings", "fs")) || {}; }
  function classify(a, auto) { // auto = ignore the accountant's override
    const code = String(a.code), ov = auto ? null : (settings().map || {})[code];
    if (ov && LABEL[ov]) return ov;
    if (BUILTIN[code]) return BUILTIN[code];
    const t = a.type;
    if (t === "Asset") return /^10|^58/.test(code) ? "cash" : /^11/.test(code) ? "otherCA" : /^12/.test(code) ? "receivables" : /^2/.test(code) ? "ppe" : "otherCA";
    if (t === "Liability") return /^40/.test(code) ? "payables" : "otherCL";
    if (t === "Equity") return /^30/.test(code) ? "capital" : "retained";
    if (t === "Revenue") return /^763/.test(code) ? "fx" : /^76/.test(code) ? "otherInc" : /^4[29]/.test(code) && code.length === 4 ? "otherInc" : "revenue";
    if (t === "Expense") return /^67|^663/.test(code) ? "fx" : /^66/.test(code) ? "finance" : "admin";
    return "otherCA";
  }

  // net (debit − credit) per account up to a date, and within a period
  function nets(to, from) {
    const dates = {}; Store.all("journal_entries").forEach(j => { if (j.status === "posted" || j.status === "reversed") dates[j.id] = j.date || ""; });
    const m = {};
    Store.all("journal_lines").forEach(l => { const d = dates[l.je_id]; if (d === undefined || d > to || (from && d < from)) return; m[l.account] = (m[l.account] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0); });
    return m;
  }
  function byLine(m) {
    const out = {}; Store.all("accounts").forEach(a => { if (a.is_header || !m[a.code]) return; const k = classify(a); out[k] = (out[k] || 0) + m[a.code]; });
    return out;
  }
  const r = x => Math.round((x || 0) * 100) / 100;

  function bs(asOf) {
    const m = nets(asOf), L = byLine(m), g = k => L[k] || 0, v = {};
    ["cash", "receivables", "inventories", "otherCA", "ppe", "otherNCA"].forEach(k => { v[k] = r(g(k)); });
    ["payables", "otherCL", "stBorrow", "ncl", "capital", "premium", "legal"].forEach(k => { v[k] = r(-g(k)); });
    // retained = booked equity + every P&L account not yet closed (profit of all periods to date)
    const pl = ["revenue", "cogs", "admin", "otherInc", "fx", "finance", "tax"].reduce((s, k) => s + g(k), 0);
    v.retained = r(-g("retained") - pl);
    v["t:ca"] = r(v.cash + v.receivables + v.inventories + v.otherCA); v["t:nca"] = r(v.ppe + v.otherNCA); v["t:assets"] = r(v["t:ca"] + v["t:nca"]);
    v["t:cl"] = r(v.payables + v.otherCL + v.stBorrow); v["t:ncl"] = v.ncl; v["t:liab"] = r(v["t:cl"] + v["t:ncl"]);
    v["t:equity"] = r(v.capital + v.premium + v.legal + v.retained); v["t:le"] = r(v["t:liab"] + v["t:equity"]);
    v.balanced = Math.abs(v["t:assets"] - v["t:le"]) < 1;
    return v;
  }
  function is(from, to) {
    const L = byLine(nets(to, from)), g = k => -(L[k] || 0), v = {}; // income positive, costs negative
    ["revenue", "cogs", "admin", "otherInc", "fx", "finance", "tax"].forEach(k => { v[k] = r(g(k)); });
    v["t:gp"] = r(v.revenue + v.cogs); v["t:op"] = r(v["t:gp"] + v.admin + v.otherInc + v.fx); v["t:pbt"] = r(v["t:op"] + v.finance); v["t:np"] = r(v["t:pbt"] + v.tax);
    return v;
  }
  // changes in equity for [from,to]: opening / profit / other movements / closing
  function eq(from, to, dayBefore) {
    const o = bs(dayBefore), c = bs(to), p = is(from, to)["t:np"], cols = ["capital", "premium", "legal", "retained"], rows = {};
    rows.opening = cols.reduce((a, k) => (a[k] = o[k], a), {}); rows.opening.total = o["t:equity"];
    rows.profit = { capital: 0, premium: 0, legal: 0, retained: p, total: p };
    rows.closing = cols.reduce((a, k) => (a[k] = c[k], a), {}); rows.closing.total = c["t:equity"];
    rows.other = cols.reduce((a, k) => (a[k] = r(c[k] - o[k] - rows.profit[k]), a), {}); rows.other.total = r(c["t:equity"] - o["t:equity"] - p);
    return rows;
  }
  function depreciation(from, to) {
    const m = nets(to, from); let s = 0;
    Store.all("accounts").forEach(a => { if (a.type === "Expense" && m[a.code] && (String(a.code) === "5400" || /ເສື່ອມ|ຄ່າຫຼຸ້ຍຫ້ຽນ|depreci|amorti/i.test(a.name || ""))) s += m[a.code]; });
    return r(s);
  }
  function cf(from, to, dayBefore) {
    const o = bs(dayBefore), c = bs(to), i = is(from, to), d = depreciation(from, to), fin = -i.finance, v = {};
    const dl = k => r(c[k] - o[k]);
    v.pbt = i["t:pbt"]; v.dep = d; v.interest = fin;
    v.recv = r(-dl("receivables")); v.inv = r(-dl("inventories")); v.oca = r(-dl("otherCA")); v.pay = dl("payables"); v.ocl = dl("otherCL");
    v["t:cashops"] = r(v.pbt + v.dep + v.interest + v.recv + v.inv + v.oca + v.pay + v.ocl);
    v.intPaid = r(-fin); v.taxPaid = i.tax; v["t:ops"] = r(v["t:cashops"] + v.intPaid + v.taxPaid);
    v.capex = r(-(dl("ppe") + d)); v.onca = r(-dl("otherNCA")); v["t:inv"] = r(v.capex + v.onca);
    v.borrow = r(dl("stBorrow") + dl("ncl")); v.shareCap = r(dl("capital") + dl("premium")); v.otherEq = r(c["t:equity"] - o["t:equity"] - i["t:np"] - v.shareCap);
    v["t:fin"] = r(v.borrow + v.shareCap + v.otherEq);
    v.net = r(v["t:ops"] + v["t:inv"] + v["t:fin"]); v.open = o.cash; v.close = c.cash; v.ties = Math.abs(v.open + v.net - v.close) < 1;
    return v;
  }

  // period for fiscal year `year` ending after `months` months (fiscal_year_start "MM-DD", default 01-01)
  function period(year, months) {
    const fs = ((window.Store && (Store.get("settings", "company") || {}).fiscal_year_start) || "01-01").split("-"), sm = Math.max(1, Number(fs[0]) || 1), sd = Number(fs[1]) || 1;
    const start = new Date(Date.UTC(year, sm - 1, sd)), end = new Date(Date.UTC(year, sm - 1 + (months || 12), sd) - 86400000), before = new Date(start - 86400000);
    const iso = x => x.toISOString().slice(0, 10);
    return { from: iso(start), to: iso(end), before: iso(before) };
  }
  function years() {
    const ys = new Set([new Date().getFullYear()]); Store.all("journal_entries").forEach(j => { if (j.date) ys.add(Number(j.date.slice(0, 4))); });
    return Array.from(ys).sort((a, b) => b - a);
  }
  function setMap(code, line) {
    const cur = Store.get("settings", "fs"), map = Object.assign({}, cur && cur.map);
    if (line) map[code] = line; else delete map[code];
    if (cur) Store.update("settings", "fs", { map }); else Store.insert("settings", { id: "fs", map });
  }

  window.FS = { BS_LINES, IS_LINES, LABEL, MAPPABLE, classify, bs, is, eq, cf, period, years, setMap, depreciation };
})();
