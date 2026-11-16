/* LaoBooks ↔ ST Platform: ເປີດດ້ວຍ ?erp=https://<server>/t/<ລະຫັດບໍລິສັດ>/erp (ມາຈາກໜ້າ Launcher).
   - ຂໍ້ມູນເກັບທີ່ server ຂອງບໍລິສັດນັ້ນ (ບໍ່ແມ່ນ localStorage) — ໃຊ້ໂປຣໂຕຄໍ Apps Script ເດີມ
   - ຕ້ອງເຂົ້າລະບົບດ້ວຍ PIN ຂອງຜູ້ໃຊ້ຂອງບໍລິສັດ (ບົດບາດ ເຈົ້າຂອງ/admin/ບັນຊີ) → token ເກັບໃນ sessionStorage ຂອງແທັບ
   ບໍ່ມີ ?erp= → ໂຫມດເດີມ (demo / APPS_SCRIPT_URL) ບໍ່ປ່ຽນ */
(function () {
  const OK = /^https:\/\/[^\/?#]+(\/api)?\/t\/[a-z0-9][a-z0-9_-]{1,31}\/erp$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/api)?\/t\/[a-z0-9][a-z0-9_-]{1,31}\/erp$/i;
  const ss = { get: k => { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } }, del: k => { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  let url = "";
  try { const m = /[?&]erp=([^&#]+)/.exec((window.location && window.location.search) || ""); if (m) { const u = decodeURIComponent(m[1]); if (OK.test(u)) { url = u; if (ss.get("erp_url") !== u) ss.del("erp_tk"); ss.set("erp_url", u); } } } catch (e) { /* no location (tests) */ }
  if (!url) url = ss.get("erp_url");
  if (url && !OK.test(url)) url = "";
  const api = () => (/\/api\/t\//.test(url) ? url.replace(/\/erp$/, "") : url.replace(/\/erp$/, "/api")) + "/";
  function jsonp(q, cb) {
    const n = "_erp" + Date.now() + Math.floor(Math.random() * 1e4), sc = document.createElement("script"); let done = false;
    const fin = r => { if (done) return; done = true; clearTimeout(t); delete window[n]; sc.remove(); cb(r); };
    const t = setTimeout(() => fin(null), 15000); window[n] = fin; sc.onerror = () => fin(null);
    sc.src = api() + "?" + q + "&callback=" + n; document.head.appendChild(sc);
  }
  const esc = x => String(x == null ? "" : x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function gate() {
    return new Promise(resolve => {
      const box = document.createElement("div");
      box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#f4f6fb;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,'Noto Sans Lao',sans-serif";
      box.innerHTML = '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:22px;width:100%;max-width:380px"><div style="font-size:20px;font-weight:700;margin-bottom:4px">LaoBooks</div><div id="er-shop" style="color:#64748b;margin-bottom:14px">ກຳລັງໂຫຼດ…</div>' +
        '<label style="font-weight:600">ຜູ້ໃຊ້</label><select id="er-u" style="width:100%;padding:12px;border-radius:10px;border:1px solid #e2e8f0;margin:6px 0 12px;font-size:16px"></select>' +
        '<label style="font-weight:600">PIN</label><input id="er-p" type="password" inputmode="numeric" autocomplete="off" style="width:100%;padding:12px;border-radius:10px;border:1px solid #e2e8f0;margin-top:6px;font-size:18px">' +
        '<button id="er-go" style="margin-top:14px;width:100%;padding:13px;border:0;border-radius:10px;background:#1d4ed8;color:#fff;font-weight:700;font-size:16px;cursor:pointer">ເຂົ້າລະບົບ</button><div id="er-e" role="alert" style="color:#b91c1c;margin-top:10px;min-height:1.3em"></div></div>';
      document.body.appendChild(box);
      const $ = i => box.querySelector("#" + i);
      jsonp("login=info", r => {
        if (!r || !r.ok) { $("er-shop").textContent = "ເຊື່ອມຕໍ່ server ບໍ່ໄດ້"; return; }
        $("er-shop").textContent = r.shop || ""; $("er-u").innerHTML = (r.users || []).map(u => '<option value="' + esc(u.id) + '">' + esc(u.name || u.id) + "</option>").join("");
      });
      const go = () => {
        $("er-e").textContent = ""; $("er-go").disabled = true;
        jsonp("login=pin&uid=" + encodeURIComponent($("er-u").value) + "&pin=" + encodeURIComponent($("er-p").value), r => {
          $("er-go").disabled = false;
          if (r && r.ok && r.tk) { ss.set("erp_tk", r.tk); box.remove(); resolve(); }
          else $("er-e").textContent = !r ? "ເຊື່ອມຕໍ່ບໍ່ໄດ້" : r.err === "locked" ? (r.msg || "ລັອກຊົ່ວຄາວ") : "PIN ບໍ່ຖືກ";
          $("er-p").value = "";
        });
      };
      $("er-go").onclick = go; $("er-p").onkeydown = e => { if (e.key === "Enter") go(); };
    });
  }
  window.ERPRemote = {
    url, validUrl: u => OK.test(String(u || "")),
    token: () => ss.get("erp_tk"),
    ready: () => (url && !ss.get("erp_tk") ? gate() : Promise.resolve()),
    // the server said our session is no good (expired / PIN changed) → ask again
    expired: () => { ss.del("erp_tk"); try { location.reload(); } catch (e) { /* tests */ } }
  };
})();
