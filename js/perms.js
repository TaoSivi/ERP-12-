/* ============================================================
   LaoBooks ERP – Permissions (role × module × function)
   ------------------------------------------------------------
   Every role has, per module, a list of allowed functions:
     view · create · edit · post · delete · export
   • Defaults come from ROLE_PERMS (which modules a role opens) → full functions,
     except Viewer/Auditor = view+export only. Admin is always full and cannot be edited.
   • Admin overrides are saved in settings.company.role_perms = { Role: { module: [fn,...] } }.
   • classify(el) maps a button (by id / data-attr) to a function so the UI can hide it and
     a capture-phase click guard can refuse it. Buttons not in the map are not gated.
   NOTE: this is a UI-level control (the role lives in the browser). It prevents mistakes and
   enforces policy for honest users; it is not a security boundary until the backend checks roles.
   Pure logic (no DOM except classify) so it can be unit-tested in Node.
   ============================================================ */
(function () {
  const FUNCS = [["view", "ເບິ່ງ"], ["create", "ສ້າງ"], ["edit", "ແກ້ໄຂ"], ["post", "Post/ອະນຸມັດ"], ["delete", "ລຶບ/Void"], ["export", "Export/ພິມ"]];
  const ALL = FUNCS.map(f => f[0]);
  const READONLY = { Viewer: 1, Auditor: 1 };
  let base = {}, modules = [];

  function configure(o) { if (o.base) base = o.base; if (o.modules) modules = o.modules; }
  function overrides() { const c = (window.Store && Store.get("settings", "company")) || {}; return c.role_perms || {}; }

  function defaults(role, mod) {
    if (role === "Admin") return ALL.slice();
    const p = base[role];
    if (p === undefined || (p !== null && p.indexOf(mod) === -1)) return [];
    return READONLY[role] ? ["view", "export"] : ALL.slice();
  }
  function get(role, mod) {
    if (role === "Admin") return ALL.slice();
    const o = (overrides()[role] || {})[mod];
    return Array.isArray(o) ? o : defaults(role, mod);
  }
  // the dashboard is every role's landing page, so it can never be switched off
  function can(role, mod, fn) {
    fn = fn || "view";
    if (mod === "dashboard" && fn === "view") return true;
    return get(role, mod).indexOf(fn) !== -1;
  }
  function save(next) {
    const c = Store.get("settings", "company");
    if (c) Store.update("settings", "company", { role_perms: next });
  }
  // set one module's functions for a role; any function implies "view"
  function set(role, mod, funcs) {
    if (role === "Admin") return;
    const rp = JSON.parse(JSON.stringify(overrides()));
    const list = ALL.filter(f => funcs.indexOf(f) !== -1);
    if (list.length && list.indexOf("view") === -1) list.unshift("view");
    (rp[role] = rp[role] || {})[mod] = list;
    save(rp);
  }
  function reset(role) {
    const rp = JSON.parse(JSON.stringify(overrides()));
    delete rp[role];
    save(rp);
  }
  function isCustom(role) { return !!overrides()[role]; }

  /* ---------- button → function ---------- */
  const RX = {
    export: /^(i?print|b?print|pslip|pz-print|nx-print|paycsv|r-csv|r-tbcsv|ap-csv|csv-go|coaexp|i-imp|i-exp|e-imp|e-exp|c-imp|c-exp|v-imp|v-exp|b-imp|b-exp|pr-imp|pr-exp|br-imp|bom-imp|iimport|bimport|aimport|obimport|coaimport|icopy|bcopy|ic-copy)$/,
    delete: /^(del|voidinv|voidbill|dc-bdel|pos-refund|nx-return|nx-refund)$/,
    post: /^(post|pp|cn-post|ecl-post|approve|reject|nx-reject|receive|pay|nx-pay|pos-pay|batchpay|run|ap-run|yearend|catchdep|dispose|impair|fxadj|je-save|bankfile|rt-recv)$/,
    create: /^(add\w*|new\w*|\w+-add|\w+-new|add-\w+|quote|so|deliv|cn|dn|je|quickrec|qexp|transfer|advance|openstock|recinv|recur|baddebt|rq-submit|nc-submit)$/,
    edit: /^(edit|salrev)$/
  };
  const DATA = { "data-ue": "edit", "data-ut": "edit", "data-edit": "edit", "data-ud": "delete", "data-del": "delete", "data-delp": "delete" };
  function classify(el) {
    if (!el || !el.getAttribute) return null;
    for (const a in DATA) if (el.hasAttribute(a)) return DATA[a];
    const id = el.getAttribute("id") || "";
    if (!id) return null;
    if (/^r-/.test(id)) return RX.export.test(id) ? "export" : null; // report launchers are "view"
    for (const fn of ["export", "delete", "post", "create", "edit"]) if (RX[fn].test(id)) return fn;
    return null;
  }

  window.Perms = { FUNCS, ALL, configure, get, can, set, reset, isCustom, classify, defaults, modules: () => modules };
})();
