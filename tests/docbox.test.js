// Document box: folder tree, trash, auto filing, smart views (js/docbox.js). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { freshApp } = require("./helpers");

const ago = days => new Date(Date.now() - days * 86400000).toISOString();
const mkDoc = (S, o = {}) => S.insert("documents", Object.assign({ name: "ສັນຍາ.pdf", folder_id: "", status: "draft", created_role: "Sales", created_at: new Date().toISOString(), size: 10 }, o));

/* ---------------- folder tree ---------------- */
test("folders: subfolders, path, descendants and counts include everything below", async () => {
  const { DocBox: B, Store } = await freshApp();
  const a = B.create("ໃບບິນຂາຍ"), y = B.create("2026", a.id), m = B.create("ເດືອນ 11", y.id);
  assert.equal(B.path(m.id), "ໃບບິນຂາຍ / 2026 / ເດືອນ 11");
  assert.deepEqual([...B.descendants(a.id)].sort(), [a.id, y.id, m.id].sort());
  mkDoc(Store, { folder_id: m.id }); mkDoc(Store, { folder_id: y.id });
  assert.equal(B.docsIn(a.id).length, 2, "parent counts documents in subfolders");
  assert.equal(B.docsIn(y.id, true).length, 1, "direct only");
  assert.deepEqual(Array.from(B.flat(), f => f.depth), [0, 1, 2]);
});

test("folders: duplicate name in the same place and too-deep nesting are refused; same name elsewhere is fine", async () => {
  const { DocBox: B } = await freshApp();
  const a = B.create("A"), b = B.create("B");
  B.create("2026", a.id); B.create("2026", b.id);                               // same name, different parents → ok
  assert.throws(() => B.create("2026", a.id), /ມີໂຟນເດີຊື່ນີ້ແລ້ວ/);
  assert.throws(() => B.create("  ", a.id), /ໃສ່ຊື່/);
  let p = a.id; for (let i = 0; i < B.MAX_DEPTH - 1; i++) p = B.create("L" + i, p).id;
  assert.throws(() => B.create("too deep", p), /ຊັ້ນ/);
});

test("folders: cannot delete one that has documents or subfolders; empty one can go; rename keeps rules", async () => {
  const { DocBox: B, Store } = await freshApp();
  const a = B.create("A"), s = B.create("S", a.id);
  assert.throws(() => B.remove(a.id), /ໂຟນເດີຍ່ອຍ/);
  mkDoc(Store, { folder_id: s.id });
  assert.throws(() => B.remove(s.id), /ມີເອກະສານ 1/);
  B.move(Store.all("documents").map(d => d.id), "");
  B.remove(s.id); B.remove(a.id);
  assert.equal(B.folders().length, 0);
  const x = B.create("X"), y = B.create("Y");
  assert.throws(() => B.rename(y.id, "X"), /ມີໂຟນເດີຊື່ນີ້ແລ້ວ/);
  B.rename(y.id, "Z"); assert.equal(B.folder(y.id).name, "Z"); assert.ok(x);
});

/* ---------------- trash ---------------- */
test("trash: deleting hides the document everywhere (it is no longer in documents) but keeps it", async () => {
  const { DocBox: B, Store } = await freshApp();
  const d = mkDoc(Store, { status: "pending" });
  assert.equal(B.trash(d.id, "Manager"), true);
  assert.equal(Store.get("documents", d.id), null);
  assert.equal(Store.where("documents", x => x.status === "pending").length, 0, "no longer counted as waiting for approval");
  const t = Store.get("doc_trash", d.id);
  assert.equal(t.name, d.name); assert.equal(t.deleted_by, "Manager"); assert.ok(t.deleted_at);
  assert.equal(B.trash("nope"), false);
});

test("trash: restore brings back the same document id with its folder; deleted_* fields are dropped", async () => {
  const { DocBox: B, Store } = await freshApp();
  const f = B.create("ໃບຈ່າຍ"), d = mkDoc(Store, { folder_id: f.id, tags: "a,b" });
  B.trash(d.id, "Sales"); B.restore(d.id);
  const r = Store.get("documents", d.id);
  assert.equal(r.folder_id, f.id); assert.equal(r.tags, "a,b");
  assert.equal(r.deleted_at, undefined); assert.equal(Store.get("doc_trash", d.id), null);
});

test("trash: restoring when its folder was deleted meanwhile puts it in 'no folder' instead of a dead folder", async () => {
  const { DocBox: B, Store } = await freshApp();
  const f = B.create("Temp"), d = mkDoc(Store, { folder_id: f.id });
  B.trash(d.id); B.remove(f.id);                                     // folder is empty now (the document is in the trash)
  B.restore(d.id);
  assert.equal(Store.get("documents", d.id).folder_id, "");
});

test("trash: delete by hand erases the record AND the stored file", async () => {
  const { DocBox: B, Store } = await freshApp();
  const erased = []; B.hooks.fileDel = id => erased.push(id);
  const d = mkDoc(Store); B.trash(d.id);
  assert.deepEqual(erased, [], "moving to trash keeps the file");
  assert.equal(B.purge(d.id), true);
  assert.deepEqual(erased, [d.id]);
  assert.equal(Store.get("doc_trash", d.id), null);
  assert.equal(B.purge(d.id), false, "second time: nothing to do");
});

test("trash: 30 days — older items are erased automatically, newer ones stay; days left is shown", async () => {
  const { DocBox: B, Store } = await freshApp();
  const erased = []; B.hooks.fileDel = id => erased.push(id);
  const old = mkDoc(Store), fresh = mkDoc(Store), edge = mkDoc(Store);
  [old, fresh, edge].forEach(d => B.trash(d.id));
  Store.update("doc_trash", old.id, { deleted_at: ago(31) });
  Store.update("doc_trash", edge.id, { deleted_at: ago(29) });
  assert.equal(B.daysLeft(Store.get("doc_trash", fresh.id)), 30);
  assert.equal(B.daysLeft(Store.get("doc_trash", edge.id)), 1);
  assert.equal(B.purgeExpired(), 1);
  assert.deepEqual(erased, [old.id]);
  assert.ok(Store.get("doc_trash", fresh.id) && Store.get("doc_trash", edge.id));
});

test("trash: empty trash erases everything in it, nothing else", async () => {
  const { DocBox: B, Store } = await freshApp();
  const keep = mkDoc(Store), a = mkDoc(Store), b = mkDoc(Store);
  B.trash(a.id); B.trash(b.id);
  assert.equal(B.emptyTrash(), 2);
  assert.equal(Store.all("doc_trash").length, 0);
  assert.ok(Store.get("documents", keep.id));
});

/* ---------------- auto filing ---------------- */
test("auto path: type / year / month, created once and reused", async () => {
  const { DocBox: B } = await freshApp();
  const id1 = B.autoFolder("ໃບບິນຂາຍ", "2026-11-14"), id2 = B.autoFolder("ໃບບິນຂາຍ", "2026-11-30"), id3 = B.autoFolder("ໃບບິນຂາຍ", "2026-12-01");
  assert.equal(id1, id2, "same month → same folder");
  assert.notEqual(id1, id3);
  assert.equal(B.path(id1), "ໃບບິນຂາຍ / 2026 / ເດືອນ 11");
  assert.equal(B.path(id3), "ໃບບິນຂາຍ / 2026 / ເດືອນ 12");
  assert.equal(B.folders().filter(f => f.name === "2026").length, 1, "the year folder is shared");
  assert.equal(B.path(B.autoFolder(B.typeLabelOf(""), "2026-01-05")), "ເອກະສານທົ່ວໄປ / 2026 / ເດືອນ 01");
});

test("system documents are filed into type / year / month automatically (Filing)", async () => {
  const { Store, DocBox: B } = await freshApp();
  const inv = Store.insert("invoices", { number: "INV-1", date: "2026-03-09", customer_id: Store.all("customers")[0].id, status: "draft" });
  const filed = Store.all("documents").find(d => d.ref_id === inv.id);
  assert.equal(B.path(filed.folder_id), "ໃບບິນຂາຍ / 2026 / ເດືອນ 03");
});

test("organize: old flat-filed system documents move into type / year / month; uploaded files are left alone", async () => {
  const { DocBox: B, Store } = await freshApp();
  const flat = Store.insert("doc_folders", { name: "ໃບບິນຂາຍ", auto: true });                  // the old one-folder-per-type layout
  const old = mkDoc(Store, { auto: true, ref_type: "invoices", ref_id: "x", folder_id: flat.id, created_at: "2026-02-10T08:00:00.000Z" });
  const noFolder = mkDoc(Store, { ref_type: "bills", ref_id: "y", folder_id: "", created_at: "2026-02-11T08:00:00.000Z" });
  const mine = B.create("ໂຟນເດີຂອງຂ້ອຍ"), upload = mkDoc(Store, { folder_id: mine.id });
  assert.equal(B.organizePlan().length, 2);
  assert.equal(B.organize(), 2);
  assert.equal(B.path(Store.get("documents", old.id).folder_id), "ໃບບິນຂາຍ / 2026 / ເດືອນ 02");
  assert.equal(B.path(Store.get("documents", noFolder.id).folder_id), "ໃບບິນຊື້ / 2026 / ເດືອນ 02");
  assert.equal(Store.get("documents", upload.id).folder_id, mine.id);
  assert.equal(B.organize(), 0, "idempotent");
});

/* ---------------- move + smart views ---------------- */
test("move: counts only real changes, refuses a folder that does not exist", async () => {
  const { DocBox: B, Store } = await freshApp();
  const f = B.create("F"), a = mkDoc(Store), b = mkDoc(Store, { folder_id: f.id });
  assert.equal(B.move([a.id, b.id, "ghost"], f.id), 1);
  assert.equal(Store.get("documents", a.id).folder_id, f.id);
  assert.throws(() => B.move([a.id], "nope"), /ບໍ່ພົບໂຟນເດີ/);
  assert.equal(B.move([a.id], ""), 1, "to 'no folder'");
});

test("smart views: mine · waiting for me · last 7 days · no folder", async () => {
  const { DocBox: B, Store } = await freshApp();
  const f = B.create("F");
  const mine = mkDoc(Store, { created_role: "Sales" }), other = mkDoc(Store, { created_role: "HR", folder_id: f.id });
  const waiting = mkDoc(Store, { status: "pending", created_role: "HR", folder_id: f.id });
  const oldDoc = mkDoc(Store, { created_at: ago(20), folder_id: f.id });
  const ctx = { role: "Sales", canApprove: d => d.id === waiting.id };
  const ids = v => Array.from(Store.all("documents").filter(d => B.inView(v, d, ctx)), d => d.id).sort(); // Array.from: results come from the vm realm
  assert.deepEqual(ids("me"), [mine.id, oldDoc.id, waiting.id].filter(i => Store.get("documents", i).created_role === "Sales").sort());
  assert.deepEqual(ids("toapprove"), [waiting.id]);
  assert.ok(!ids("recent").includes(oldDoc.id) && ids("recent").includes(mine.id));
  assert.deepEqual(ids("nofolder"), [mine.id]);
  assert.equal(ids("").length, 4);
  assert.ok(other);
});
