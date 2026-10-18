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
    accepted: ["green", "ຕົກລົງ"], sent: ["blue", "ສົ່ງແລ້ວ"], lost: ["red", "ບໍ່ເອົາ"], open: ["amber", "ເປີດ"],
    pending: ["amber", "⏳ ລໍອະນຸມັດ"], rejected: ["red", "ປະຕິເສດ"]
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
            <button data-close class="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
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

  // page header with title + actions.
  // Action-first: primary buttons (and status pills) stay visible; when there are more than
  // 3 other buttons they move into one "ເພີ່ມເຕີມ ▾" menu, so the main action is obvious.
  // Buttons keep their ids, so existing handlers still bind.
  function splitActions(html) {
    const items = String(html || "").match(/<(button|a|span)\b[^>]*>[\s\S]*?<\/\1>/g) || [];
    const isPill = h => /^<span/.test(h), isPrimary = h => /class="[^"]*\bbtn-(primary|ok)\b/.test(h);
    const buttons = items.filter(h => !isPill(h));
    if (buttons.length <= 3) return { visible: items, more: [] };
    let main = buttons.filter(isPrimary);
    if (!main.length) main = [buttons[buttons.length - 1]];
    return { visible: items.filter(h => isPill(h) || main.indexOf(h) !== -1), more: buttons.filter(h => main.indexOf(h) === -1) };
  }
  function pageHead(title, subtitle, actionsHTML) {
    const a = splitActions(actionsHTML);
    const more = a.more.length ? `<details class="more-menu"><summary class="btn btn-ghost">ເພີ່ມເຕີມ ▾</summary><div class="more-pop">${a.more.join("")}</div></details>` : "";
    return `<div class="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div><h1 class="page-title">${esc(title)}</h1>
      ${subtitle ? `<p class="page-sub">${esc(subtitle)}</p>` : ""}</div>
      <div class="flex flex-wrap gap-2 justify-start sm:justify-end items-center page-actions">${more}${a.visible.join("")}</div></div>`;
  }

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
  // empty-state button mirrors the page's primary action (label + click); stays hidden if the page has none
  if (typeof document !== "undefined") {
    const fillEmpty = () => document.querySelectorAll("[data-empty-act][hidden]").forEach(b => {
      const p = document.querySelector(".page-actions .btn-primary");
      if (p && p.textContent.trim()) { b.textContent = p.textContent.trim(); b.hidden = false; }
    });
    const v = document.getElementById("view");
    if (v && typeof MutationObserver !== "undefined") new MutationObserver(fillEmpty).observe(v, { childList: true, subtree: true });
    document.addEventListener("click", e => {
      const b = e.target.closest && e.target.closest("[data-empty-act]");
      const p = document.querySelector(".page-actions .btn-primary");
      if (b && p) p.click();
    });
  }
  window.UI = { money, esc, today, fmtDate, toast, statusBadge, modal, confirmDialog, pageHead, splitActions, kpi, table };
})();


