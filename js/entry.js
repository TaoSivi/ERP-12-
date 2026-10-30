/* ============================================================
   ST ERP – Who you are and which company you open
   · ViewAs  – a dropdown in the top bar of every page ("ເບິ່ງໃນຖານະ"): switch to any role or any user of this company to see exactly
               which menus that person gets. Same switch as the user button, just always in sight.
   · Entry   – when this browser holds more than one company: pick who you are; a person who belongs to ONE company goes straight in,
               a person in several chooses; the owner (Admin) sees all. People are matched across companies by e-mail (or name).
   The identity lives in the browser (not a real login), like the role switch it extends.
   ============================================================ */
(function () {
  const E = s => UI.esc(s == null ? "" : String(s));
  const ctx = () => window.AppCtx || {};
  const ROLE_LAO = { Admin: "Admin (ເຈົ້າຂອງ)", Manager: "ຜູ້ຈັດການ", Accountant: "ບັນຊີ / ການເງິນ", Sales: "ຝ່າຍຂາຍ", Purchasing: "ຝ່າຍຈັດຊື້", Warehouse: "ສາງ", HR: "HR / ບຸກຄະລາກອນ", Cashier: "ແຄັດເຊຍ", Auditor: "ກວດສອບ", Viewer: "ເບິ່ງຢ່າງດຽວ", Custom: "ກຳນົດເອງ" };
  const dbKey = s => "laobooks_db_v1" + (s ? "__" + s : "");
  const SS = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} } };

  /* ---------- who is in which company (reads every company's saved database) ---------- */
  function scan() {
    const cos = ctx().slots ? ctx().slots() : [], people = {};
    cos.forEach(c => {
      let db = {}; try { db = JSON.parse(localStorage.getItem(dbKey(c.slot)) || "{}"); } catch (e) {}
      (db.users || []).filter(u => (u.status || "active") === "active").forEach(u => {
        const k = String(u.email || u.name || "").trim().toLowerCase(); if (!k) return;
        (people[k] = people[k] || { name: u.name, cos: {} }).cos[c.slot] = { uid: u.id, role: u.role };
      });
    });
    return { cos, people: Object.keys(people).map(k => people[k]).sort((a, b) => String(a.name).localeCompare(String(b.name))) };
  }

  function enter(slot, uid, role) {
    SS.set("laobooks_entered", "1");
    try { if (uid) localStorage.setItem("laobooks_user", uid); else localStorage.removeItem("laobooks_user"); localStorage.setItem("laobooks_role", role || "Admin"); } catch (e) {}
    if (slot !== Store.slot) { try { if (slot) localStorage.setItem("laobooks_db_slot", slot); else localStorage.removeItem("laobooks_db_slot"); } catch (e) {} location.hash = "#/dashboard"; location.reload(); return; }
    close(); ctx().refreshAll && ctx().refreshAll();
  }

  /* ---------- the full-screen chooser ---------- */
  let layer = null;
  function close() { if (layer) { layer.remove(); layer = null; } }
  function screen(title, sub, body, back) {
    close(); layer = document.createElement("div"); layer.className = "entry-layer";
    layer.innerHTML = `<div class="entry-box"><div class="entry-logo">ST</div><h1>${E(title)}</h1><p>${E(sub)}</p><div class="entry-list">${body}</div>${back ? '<button class="btn btn-ghost entry-back" id="en-back">← ກັບຄືນ</button>' : ""}</div>`;
    document.body.appendChild(layer); return layer;
  }
  const item = (id, t, s, ic) => `<button class="entry-item" data-id="${E(id)}"><span class="entry-ic">${ic || "👤"}</span><span><b>${E(t)}</b><small>${E(s || "")}</small></span></button>`;

  function pickCompany(who, back) {
    const { cos } = scan(), mine = who ? cos.filter(c => who.cos[c.slot]) : cos;
    if (who && mine.length === 1) { const c = mine[0], m = who.cos[c.slot]; return enter(c.slot, m.uid, m.role); }
    const el = screen("ເລືອກບໍລິສັດ", who ? who.name + " ມີສິດໃນ " + mine.length + " ບໍລິສັດ" : "ທ່ານເປັນເຈົ້າຂອງ — ເຂົ້າໄດ້ທຸກບໍລິສັດ",
      mine.map(c => item(c.slot, c.name, who ? ROLE_LAO[who.cos[c.slot].role] || who.cos[c.slot].role : c.tin ? "TIN " + c.tin : "", "🏢")).join("") + (!who ? item("__new", "+ ບໍລິສັດໃໝ່ / ຈັດການບໍລິສັດ", "", "⚙️") : ""), true);
    el.querySelectorAll("[data-id]").forEach(b => b.onclick = () => {
      if (b.dataset.id === "__new") { enter(Store.slot, "", "Admin"); setTimeout(() => ctx().companyModal && ctx().companyModal(), 100); return; }
      const m = who ? who.cos[b.dataset.id] : { uid: "", role: "Admin" }; enter(b.dataset.id, m.uid, m.role);
    });
    el.querySelector("#en-back").onclick = back;
  }

  function gate(force) {
    const { cos, people } = scan();
    if (cos.length < 2 && !force) return;
    if (!force && SS.get("laobooks_entered")) return;
    const start = () => {
      const el = screen("ທ່ານແມ່ນໃຜ?", "ເລືອກຊື່ຂອງທ່ານ — ລະບົບຈະພາໄປບໍລິສັດທີ່ທ່ານມີສິດ", item("__admin", ROLE_LAO.Admin, "ເຂົ້າໄດ້ທຸກບໍລິສັດ", "👑") + people.map((p, i) => item("p" + i, p.name, Object.keys(p.cos).length + " ບໍລິສັດ", "👤")).join(""));
      el.querySelectorAll("[data-id]").forEach(b => b.onclick = () => pickCompany(b.dataset.id === "__admin" ? null : people[Number(b.dataset.id.slice(1))], start));
    };
    start();
  }

  /* ---------- "view as" dropdown in the top bar ---------- */
  function viewAsRefresh() {
    const sel = document.getElementById("viewAs"); if (!sel) return;
    const c = ctx(), roles = (c.roles ? c.roles() : []).filter(r => r !== "Admin"), users = Store.where("users", u => (u.status || "active") === "active");
    const cur = c.currentUserId && c.currentUserId() ? "u:" + c.currentUserId() : "r:" + c.currentRole();
    sel.innerHTML = `<option value="r:Admin">${E(ROLE_LAO.Admin)}</option><optgroup label="ບົດບາດ">${roles.map(r => `<option value="r:${E(r)}">${E(ROLE_LAO[r] || r)}</option>`).join("")}</optgroup>` +
      (users.length ? `<optgroup label="ຜູ້ໃຊ້ຂອງບໍລິສັດນີ້">${users.map(u => `<option value="u:${E(u.id)}">${E(u.name)} (${E(ROLE_LAO[u.role] || u.role)})</option>`).join("")}</optgroup>` : "");
    sel.value = cur; if (sel.value !== cur) sel.value = "r:" + c.currentRole();
    const names = c.menuFor ? c.menuFor() : [];
    sel.title = "ເບິ່ງໃນຖານະ — ເມນູທີ່ເຂົ້າໄດ້ (" + names.length + "): " + names.join(", ");
    sel.classList.toggle("viewas-on", c.currentRole() !== "Admin" || !!(c.currentUserId && c.currentUserId()));
  }
  function mountViewAs() {
    if (document.getElementById("viewAs")) return viewAsRefresh();
    const host = document.getElementById("companyName"); if (!host) return;
    const sel = document.createElement("select"); sel.id = "viewAs"; sel.className = "input viewas"; sel.setAttribute("aria-label", "ເບິ່ງໃນຖານະ");
    host.parentNode.insertBefore(sel, host);
    sel.onchange = () => {
      const [k, v] = sel.value.split(":");
      try { if (k === "u") { localStorage.setItem("laobooks_user", v); } else { localStorage.removeItem("laobooks_user"); localStorage.setItem("laobooks_role", v); } } catch (e) {}
      ctx().refreshAll && ctx().refreshAll();
      UI.toast("ກຳລັງເບິ່ງໃນຖານະ " + sel.options[sel.selectedIndex].text, "info");
    };
    viewAsRefresh();
  }

  window.Entry = { gate, mountViewAs, viewAsRefresh, scan, ROLE_LAO };
})();
