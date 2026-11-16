/* ST ERP – document box logic (folder tree, trash, auto-filing path, smart views).
   Pure logic, no DOM, so it is unit-tested in Node. The screen is in app.js (docs()).

   FOLDERS   doc_folders rows { id, name, parent_id }. Up to MAX_DEPTH levels. Old flat folders have no parent_id = top level.
   TRASH     deleting a document MOVES it to the doc_trash collection (same id) instead of erasing it:
             - every other screen (search, counts, approvals, announcements) stops seeing it at once
             - the stored file is kept; it can be restored, deleted for good by hand, or is erased after TRASH_DAYS days
   AUTO PATH new files go to  <type> / <year> / <month>  so nobody has to pick a folder.            */
(function () {
  const TRASH_DAYS = 30, MAX_DEPTH = 4, DAY = 86400000;
  const hooks = { fileDel: null };                      // app.js sets this to the function that erases the stored file
  const now = () => new Date().toISOString();
  const nameKey = s => String(s || "").trim();
  const audit = (a, id, d) => { try { Acc.audit(a, "documents", id, d); } catch (e) { /* audit must never block a document action */ } };

  /* ---------------- folder tree ---------------- */
  const folders = () => Store.all("doc_folders");
  const folder = id => Store.get("doc_folders", id);
  const children = pid => folders().filter(f => (f.parent_id || "") === (pid || "")).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  // the folder itself + everything below it (guarded against a corrupted parent loop)
  function descendants(id) {
    const out = new Set([id]); let frontier = [id], guard = 0;
    while (frontier.length && guard++ < 50) {
      frontier = folders().filter(f => f.parent_id && frontier.indexOf(f.parent_id) >= 0 && !out.has(f.id)).map(f => { out.add(f.id); return f.id; });
    }
    return out;
  }
  function depth(id) { let d = 0, f = folder(id), guard = 0; while (f && guard++ < 50) { d++; f = f.parent_id ? folder(f.parent_id) : null; } return d; }
  function path(id) { const names = []; let f = folder(id), guard = 0; while (f && guard++ < 50) { names.unshift(f.name); f = f.parent_id ? folder(f.parent_id) : null; } return names.join(" / "); }
  // [{ id, label, depth }] in tree order — for <select> options and breadcrumbs
  function flat() {
    const out = [];
    (function walk(pid, d) { children(pid).forEach(f => { out.push({ id: f.id, name: f.name, label: path(f.id), depth: d }); walk(f.id, d + 1); }); })("", 0);
    return out;
  }
  function create(name, parentId, extra) {
    name = nameKey(name); parentId = parentId || "";
    if (!name) throw new Error("ໃສ່ຊື່ໂຟນເດີ");
    if (parentId && !folder(parentId)) throw new Error("ບໍ່ພົບໂຟນເດີແມ່");
    if (parentId && depth(parentId) >= MAX_DEPTH) throw new Error("ໂຟນເດີຍ່ອຍໄດ້ສູງສຸດ " + MAX_DEPTH + " ຊັ້ນ");
    if (children(parentId).some(f => f.name === name)) throw new Error("ມີໂຟນເດີຊື່ນີ້ແລ້ວໃນບ່ອນນີ້");
    return Store.insert("doc_folders", Object.assign({ name, parent_id: parentId, created_at: now() }, extra || {}));
  }
  function rename(id, name) {
    const f = folder(id); name = nameKey(name);
    if (!f) throw new Error("ບໍ່ພົບໂຟນເດີ");
    if (!name) throw new Error("ໃສ່ຊື່ໂຟນເດີ");
    if (children(f.parent_id || "").some(x => x.id !== id && x.name === name)) throw new Error("ມີໂຟນເດີຊື່ນີ້ແລ້ວໃນບ່ອນນີ້");
    Store.update("doc_folders", id, { name });
  }
  const docsIn = (id, direct) => { const set = direct ? new Set([id]) : descendants(id); return Store.all("documents").filter(d => set.has(d.folder_id)); };
  function remove(id) {
    if (!folder(id)) return;
    if (children(id).length) throw new Error("ໂຟນເດີນີ້ມີໂຟນເດີຍ່ອຍ — ລຶບ ຫຼືຍ້າຍອອກກ່ອນ");
    const n = docsIn(id, true).length;
    if (n) throw new Error("ໂຟນເດີຍັງມີເອກະສານ " + n + " ໄຟລ໌ — ຍ້າຍອອກກ່ອນ");
    Store.remove("doc_folders", id);
  }
  // follow / create  names[0] / names[1] / ...  and return the last folder id
  function ensurePath(names) {
    let parent = "";
    names.forEach(n => {
      n = nameKey(n);
      const hit = children(parent).find(f => f.name === n);
      parent = hit ? hit.id : Store.insert("doc_folders", { name: n, parent_id: parent, auto: true, created_at: now() }).id;
    });
    return parent;
  }

  /* ---------------- auto filing ---------------- */
  const TYPE_LABEL = { invoices: "ໃບບິນຂາຍ", bills: "ໃບບິນຊື້", purchase_orders: "ໃບສັ່ງຊື້ (PO)", customers: "ລູກຄ້າ", vendors: "ຜູ້ສະໜອງ", employees: "ພະນັກງານ", journal_entries: "ໃບບັນທຶກບັນຊີ (JE)" };
  const GENERAL = "ເອກະສານທົ່ວໄປ";
  // typeLabel: folder name for the document type; date: 'YYYY-MM-DD…' (falls back to today)
  function autoNames(typeLabel, date) {
    const d = /^\d{4}-\d{2}/.test(String(date || "")) ? String(date) : now();
    return [typeLabel || GENERAL, d.slice(0, 4), "ເດືອນ " + d.slice(5, 7)];
  }
  const autoFolder = (typeLabel, date) => ensurePath(autoNames(typeLabel, date));
  const typeLabelOf = refType => TYPE_LABEL[refType] || GENERAL;

  /* ---------------- move ---------------- */
  // returns how many documents were moved
  function move(ids, folderId) {
    folderId = folderId || "";
    if (folderId && !folder(folderId)) throw new Error("ບໍ່ພົບໂຟນເດີປາຍທາງ");
    let n = 0;
    ids.forEach(id => {
      const d = Store.get("documents", id);
      if (!d || (d.folder_id || "") === folderId) return;
      Store.update("documents", id, { folder_id: folderId, updated_at: now() });
      audit("doc_move", id, d.name + " → " + (folderId ? path(folderId) : "ບໍ່ມີໂຟນເດີ")); n++;
    });
    return n;
  }
  // system documents that were filed one-per-type (flat) or not at all → type / year / month
  function organizePlan() {
    return Store.all("documents").filter(d => {
      if (!(d.auto || d.ref_type)) return false;
      const f = d.folder_id ? folder(d.folder_id) : null;
      return !f || (!f.parent_id && f.auto);              // no folder, or sitting directly in a top-level auto folder
    });
  }
  function organize() {
    let n = 0;
    organizePlan().forEach(d => {
      const target = autoFolder(d.auto ? (folder(d.folder_id) || {}).name || typeLabelOf(d.ref_type) : typeLabelOf(d.ref_type), (d.created_at || "").slice(0, 10));
      n += move([d.id], target);
    });
    return n;
  }

  /* ---------------- trash ---------------- */
  const trashRows = () => Store.all("doc_trash");
  function trash(id, by) {
    const d = Store.get("documents", id);
    if (!d) return false;
    // insert FIRST, remove second: a failure in between leaves a duplicate, never a lost document
    Store.insert("doc_trash", Object.assign({}, d, { deleted_at: now(), deleted_by: by || "", deleted_folder: d.folder_id || "" }));
    Store.remove("documents", id);
    audit("doc_trash", id, d.name);
    return true;
  }
  function restore(id) {
    const t = Store.get("doc_trash", id);
    if (!t) throw new Error("ບໍ່ພົບໃນຖັງຂີ້ເຫຍື້ອ");
    if (Store.get("documents", id)) { Store.remove("doc_trash", id); return t; }   // already back (e.g. a retry)
    const row = Object.assign({}, t);
    delete row.deleted_at; delete row.deleted_by; delete row.deleted_folder;
    if (row.folder_id && !folder(row.folder_id)) row.folder_id = "";                // its folder was deleted meanwhile
    Store.insert("documents", row);
    Store.remove("doc_trash", id);
    audit("doc_restore", id, t.name);
    return row;
  }
  function purge(id) {
    const t = Store.get("doc_trash", id);
    if (!t) return false;
    if (hooks.fileDel) { try { hooks.fileDel(id); } catch (e) { /* file already gone */ } }
    Store.remove("doc_trash", id);
    audit("doc_purge", id, t.name);
    return true;
  }
  const daysLeft = (t, at) => Math.max(0, Math.ceil(TRASH_DAYS - ((at || Date.now()) - Date.parse(t.deleted_at || now())) / DAY));
  // erase what has been in the trash longer than TRASH_DAYS; returns how many
  function purgeExpired(at) {
    let n = 0;
    trashRows().filter(t => t.deleted_at && daysLeft(t, at) <= 0).forEach(t => { if (purge(t.id)) n++; });
    return n;
  }
  function emptyTrash() { let n = 0; trashRows().forEach(t => { if (purge(t.id)) n++; }); return n; }

  /* ---------------- smart views ---------------- */
  // ctx: { role, canApprove(d) }   views: "" all · me · toapprove · recent · nofolder
  function inView(view, d, ctx, at) {
    if (!view) return true;
    if (view === "me") return d.created_role === ctx.role;
    if (view === "toapprove") return (d.status || "draft") === "pending" && !!ctx.canApprove(d);
    if (view === "recent") return (at || Date.now()) - Date.parse(d.created_at || 0) <= 7 * DAY;
    if (view === "nofolder") return !d.folder_id;
    return true;
  }

  window.DocBox = { TRASH_DAYS, MAX_DEPTH, hooks, folders, folder, children, descendants, depth, path, flat, create, rename, remove, docsIn, ensurePath,
    TYPE_LABEL, GENERAL, autoNames, autoFolder, typeLabelOf, move, organizePlan, organize,
    trash, restore, purge, trashRows, daysLeft, purgeExpired, emptyTrash, inView };
})();
