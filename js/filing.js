/* ST ERP – auto filing: every document made from the hub is also filed in ເອກະສານ (folder per type, no extra click).
   The filed record is a link to the system document (ref_type/ref_id); files people upload stay as they are. */
(function () {
  const WHERE = {
    purchase_requisitions: ["ໃບຂໍຊື້", "#/procure"], purchase_orders: ["ໃບສັ່ງຊື້ (PO)", "#/procure"], grns: ["ໃບຮັບສິນຄ້າ", "#/procure"],
    bills: ["ໃບບິນຊື້", "#/bills"], invoices: ["ໃບບິນຂາຍ", "#/invoices"], payments: ["ໃບຮັບ/ຈ່າຍເງິນ", "#/banking"],
    stock_docs: ["ເອກະສານສາງ", "#/inventory"], requests: ["ໃບລາຍຈ່າຍ / ຂໍເບີກ", "#/requests"], payroll: ["ໃບເງິນເດືອນ", "#/payroll"]
  };
  const label = (coll, row) => coll === "payments" ? (row.type === "receive" ? "ໃບຮັບເງິນ" : "ໃບຈ່າຍເງິນ")
    : coll === "stock_docs" ? ({ ISS: "ໃບຈ່າຍສິນຄ້າ", ADJ: "ໃບປັບປຸງສາງ", CNT: "ໃບກວດນັບສາງ" }[row.type] || WHERE[coll][0]) : WHERE[coll][0];
  const role = () => { try { return (window.AppCtx && AppCtx.currentRole && AppCtx.currentRole()) || localStorage.getItem("laobooks_role") || "Admin"; } catch (e) { return "Admin"; } };

  function folderFor(name) {
    const f = Store.all("doc_folders").find(x => x.name === name) || Store.insert("doc_folders", { name, auto: true, created_at: new Date().toISOString() });
    return f.id;
  }
  function file(coll, row) {
    if (!WHERE[coll] || !row || Store.all("documents").some(d => d.ref_type === coll && d.ref_id === row.id)) return;
    const lb = label(coll, row);
    Store.insert("documents", { name: lb + " " + (row.number || ""), description: "ເກັບອັດຕະໂນມັດຈາກລະບົບ", ref_type: coll, ref_id: row.id, auto: true,
      folder_id: folderFor(lb), tags: "auto", status: "approved", size: 0, created_role: role(), created_at: new Date().toISOString() });
  }
  const orig = Store.insert;
  Store.insert = function (coll, obj) { const r = orig.call(this, coll, obj); try { file(coll, r); } catch (e) { console.error(e); } return r; };

  // staff see their own files + published ones; ledger roles (finance / admin) see everything
  const visible = d => { try { if (Review.sees(role())) return true; } catch (e) { return true; }
    return d.created_role === role() || d.status === "published" || (d.approvers || []).indexOf(role()) >= 0; };
  // a filed link whose document was rolled back / deleted is not shown
  const alive = d => !d.auto || !!Store.get(d.ref_type, d.ref_id);
  window.Filing = { file, visible, alive, where: coll => (WHERE[coll] || [])[1] };
})();
