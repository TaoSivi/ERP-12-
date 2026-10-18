/* ============================================================
   LaoBooks ERP – UI helpers
   ============================================================ */
(function () {
  const money = (n, cur) => {
    const v = Number(n) || 0;
    return v.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " " + (cur || "₭");
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (d) => d ? String(d).slice(0, 10) : "";

  // line icons (Lucide-style, 24px grid, stroke follows currentColor)
  const ICONS = {"home": "<path d=\"M3 10.5 12 3l9 7.5\"/><path d=\"M5 9.5V21h14V9.5\"/><path d=\"M10 21v-6h4v6\"/>", "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.9\"/><path d=\"M16 3.1a4 4 0 0 1 0 7.8\"/>", "file": "<path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><path d=\"M14 2v6h6\"/><path d=\"M8 13h8M8 17h5\"/>", "truck": "<path d=\"M1 3h15v13H1z\"/><path d=\"M16 8h4l3 3v5h-7z\"/><circle cx=\"5.5\" cy=\"18.5\" r=\"2.5\"/><circle cx=\"18.5\" cy=\"18.5\" r=\"2.5\"/>", "receipt": "<path d=\"M4 2v20l3-2 2 2 3-2 3 2 2-2 3 2V2l-3 2-2-2-3 2-3-2-2 2z\"/><path d=\"M8 8h8M8 12h8M8 16h5\"/>", "package": "<path d=\"M21 8 12 3 3 8v8l9 5 9-5z\"/><path d=\"m3 8 9 5 9-5M12 13v8\"/>", "landmark": "<path d=\"M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M2 10l10-7 10 7z\"/>", "book": "<path d=\"M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z\"/><path d=\"M4 19.5V22h16\"/>", "building": "<rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"1\"/><path d=\"M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3\"/>", "wallet": "<path d=\"M3 7a2 2 0 0 1 2-2h14v4\"/><path d=\"M3 7v11a2 2 0 0 0 2 2h16V9H5a2 2 0 0 1-2-2z\"/><circle cx=\"16.5\" cy=\"14.5\" r=\"1\"/>", "pie": "<path d=\"M21 12A9 9 0 1 1 12 3v9z\"/><path d=\"M15 3.5A9 9 0 0 1 20.5 9H15z\"/>", "chart": "<path d=\"M3 3v18h18\"/><path d=\"M8 17v-6M13 17V7M18 17v-9\"/>", "settings": "<path d=\"M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0\"/><circle cx=\"16\" cy=\"6\" r=\"2\"/><circle cx=\"10\" cy=\"12\" r=\"2\"/><circle cx=\"18\" cy=\"18\" r=\"2\"/>", "menu": "<path d=\"M4 6h16M4 12h16M4 18h16\"/>", "search": "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m21 21-4.3-4.3\"/>", "x": "<path d=\"M18 6 6 18M6 6l12 12\"/>", "check": "<path d=\"M20 6 9 17l-5-5\"/>", "alert": "<path d=\"M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z\"/><path d=\"M12 9v4M12 17h.01\"/>", "alertcircle": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 8v4M12 16h.01\"/>", "printer": "<path d=\"M6 9V2h12v7\"/><path d=\"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\"/><rect x=\"6\" y=\"14\" width=\"12\" height=\"8\"/>", "play": "<path d=\"M6 4v16l14-8z\"/>", "edit": "<path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z\"/>", "cloud": "<path d=\"M18 10a6 6 0 0 0-11.7-1.5A4.5 4.5 0 0 0 7 18h11a4 4 0 0 0 0-8z\"/>", "database": "<ellipse cx=\"12\" cy=\"5\" rx=\"8\" ry=\"3\"/><path d=\"M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5\"/><path d=\"M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3\"/>", "zap": "<path d=\"M13 2 3 14h9l-1 8 10-12h-9z\"/>", "banknote": "<rect x=\"2\" y=\"6\" width=\"20\" height=\"12\" rx=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"2.5\"/>", "send": "<path d=\"m22 2-7 20-4-9-9-4z\"/><path d=\"M22 2 11 13\"/>", "shield": "<path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\"/>", "inbox": "<path d=\"M22 12h-6l-2 3h-4l-2-3H2\"/><path d=\"M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z\"/>"};
  const icon = (n, size) => `<svg class="ic" viewBox="0 0 24 24" width="${size || 18}" height="${size || 18}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ""}</svg>`;

  function toast(msg, kind) {
    const ic = { ok: "\u2713", err: "\u2715", warn: "!", info: "i" };
    const el = document.createElement("div");
    el.className = "toast toast-" + (kind || "info");
    el.innerHTML = '<span class="toast-ic">' + (ic[kind] || "i") + '</span><span class="toast-tx">' + esc(msg) + '</span>';
    document.getElementById("toastRoot").appendChild(el);
    setTimeout(() => { el.classList.add("toast-out"); setTimeout(() => el.remove(), 380); }, 2800);
  }

  const STATUS = {
    draft: ["gray", "ຮ່າງ"], posted: ["blue", "ບັນທຶກແລ້ວ"], paid: ["green", "ຈ່າຍແລ້ວ"],
    partial: ["amber", "ຈ່າຍບາງສ່ວນ"], overdue: ["red", "ເກີນກຳນົດ"], void: ["gray", "ຍົກເລີກ"],
    reversed: ["gray", "ກັບລາຍການ"], active: ["green", "ໃຊ້ງານ"], inactive: ["gray", "ປິດ"],
    accepted: ["green", "ຕົກລົງ"], sent: ["blue", "ສົ່ງແລ້ວ"], lost: ["red", "ບໍ່ເອົາ"], open: ["amber", "ເປີດ"]
  };
  function statusBadge(s) {
    const [c, t] = STATUS[s] || ["gray", s || "-"];
    return `<span class="badge ${c}">${esc(t)}</span>`;
  }

  // Generic modal. content = html string, opts.onMount(root), opts.title, opts.wide
  function modal(title, contentHTML, opts) {
    opts = opts || {};
    const root = document.getElementById("modalRoot");
    root.innerHTML = `
      <div class="modal-bg">
        <div class="modal" style="max-width:${opts.wide ? "920px" : "640px"}">
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200">
            <h3 class="font-semibold text-lg">${esc(title)}</h3>
            <button data-close class="text-slate-400 hover:text-slate-700 text-xl leading-none">${icon("x", 20)}</button>
          </div>
          <div class="px-5 py-4" data-body>${contentHTML}</div>
        </div>
      </div>`;
    const bg = root.querySelector(".modal-bg");
    const close = () => { root.innerHTML = ""; };
    bg.addEventListener("mousedown", e => { if (e.target === bg) close(); });
    root.querySelector("[data-close]").addEventListener("click", close);
    if (opts.onMount) opts.onMount(root.querySelector("[data-body]"), close);
    return { root, close };
  }

  function confirmDialog(msg, onYes) {
    modal("ຢືນຢັນ", `<div class="flex items-start gap-3"><div class="confirm-ic">!</div><p class="text-slate-600" style="padding-top:6px">${esc(msg)}</p></div>
      <div class="flex justify-end gap-2 mt-5">
        <button class="btn btn-ghost" data-no>ຍົກເລີກ</button>
        <button class="btn btn-primary" data-yes>ຕົກລົງ</button>
      </div>`, { onMount: (body, close) => {
        body.querySelector("[data-no]").onclick = close;
        body.querySelector("[data-yes]").onclick = () => { close(); onYes(); };
      }});
  }

  // page header: primary actions stay visible; everything else folds into one "ເພີ່ມເຕີມ" menu
  function pageHead(title, subtitle, actionsHTML) {
    const parts = String(actionsHTML || "").match(/<(button|a)\b[^>]*>[\s\S]*?<\/\1>/g) || [];
    const primary = parts.filter(x => /btn-primary/.test(x));
    const rest = parts.filter(x => !/btn-primary/.test(x));
    const more = rest.length ? `<details class="more"><summary class="btn btn-ghost">ເພີ່ມເຕີມ <span aria-hidden="true">▾</span></summary><div class="more-menu">${rest.join("")}</div></details>` : "";
    return `<div class="page-head">
      <div><h1 class="page-title">${esc(title)}</h1>
      ${subtitle ? `<p class="page-sub">${esc(subtitle)}</p>` : ""}</div>
      <div class="page-actions">${more}${primary.join("")}</div></div>`;
  }
  document.addEventListener("click", e => {
    document.querySelectorAll("details.more[open]").forEach(d => { if (!d.contains(e.target) || e.target.closest(".more-menu button, .more-menu a")) d.removeAttribute("open"); });
  });

  function kpi(label, value, sub, color) {
    return `<div class="kpi">
      <div class="label">${esc(label)}</div>
      <div class="value" style="color:${color || "#0f172a"}">${value}</div>
      ${sub ? `<div class="hint mt-1">${sub}</div>` : ""}</div>`;
  }

  // Build a simple table. cols=[{h, key|render, cls}], rows=array
  function table(cols, rows, opts) {
    opts = opts || {};
    const head = cols.map(c => `<th class="${c.cls || ""}">${esc(c.h)}</th>`).join("");
    const body = rows.length ? rows.map(r => {
      const tds = cols.map(c => {
        const val = c.render ? c.render(r) : esc(r[c.key]);
        return `<td class="${c.cls || ""}" data-label="${esc(c.h)}">${val}</td>`;
      }).join("");
      return `<tr ${opts.rowClick ? 'style="cursor:pointer"' : ""} data-id="${esc(r.id)}">${tds}</tr>`;
    }).join("") : `<tr><td colspan="${cols.length}" class="text-center py-10"><p class="text-slate-400 mb-3">ຍັງບໍ່ມີຂໍ້ມູນ</p><button class="btn btn-primary" data-empty-act hidden></button></td></tr>`;
    return `<div class="card overflow-hidden"><div class="tbl-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  }
  // empty-state button mirrors the page's primary action (label + click); hidden if the page has none
  const fillEmpty = () => document.querySelectorAll("[data-empty-act]").forEach(b => {
    const p = document.querySelector(".page-actions .btn-primary");
    if (p && b.textContent !== p.textContent) { b.textContent = p.textContent; b.hidden = false; }
  });
  new MutationObserver(fillEmpty).observe(document.getElementById("view") || document.body, { childList: true, subtree: true });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-empty-act]");
    if (b) document.querySelector(".page-actions .btn-primary").click();
  });
  window.UI = { icon, money, esc, today, fmtDate, toast, statusBadge, modal, confirmDialog, pageHead, kpi, table };
})();
