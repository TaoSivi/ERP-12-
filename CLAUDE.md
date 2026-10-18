# LaoBooks ERP — ຄູ່ມືໂປຣເຈັກ (ສຳລັບ Claude Code)

ERP ສຳລັບ SME ລາວ. Static SPA (vanilla JS) + Tailwind CDN + SheetJS + Noto Sans Lao.
ໃຊ້ງານໄດ້ 2 ແບບ: **Demo Mode** (localStorage) ແລະ **Cloud Mode** (Google Apps Script → Google Sheet).

## ໂຄງສ້າງໄຟລ໌
- `index_src.html` — template ຕົ້ນສະບັບ (ມີ <link> CSS + 5 <script> tags).
- `assets/css/styles.css` — ສະໄตล์ (ທີມ Tiffany Blue).
- `assets/js/config.js` — ຄ່າຕັ້ງ (APPS_SCRIPT_URL ສຳລັບ Cloud Mode).
- `assets/js/store.js` — ຊັ້ນຂໍ້ມູນ: COLLECTIONS (~50), Store.insert/update/get/where/all, seed*, boot().
- `assets/js/accounting.js` — engine ບັນຊີຄູ່: postJournal (ກວດ Dr=Cr), FIFO, VAT, PIT, auto-JE. window.Acc.
- `assets/js/ui.js` — ຕົວຊ່ວຍ UI: money, toast, modal, table, pageHead. window.UI.
- `assets/js/app.js` — ໜ້າຈໍຫຼັກ: NAV 12 ໂມດູນ, RBAC, screens, modals, posting rules.
- `index.html` — **ໄຟລ໌ສຳເລັດ (generated)** — ຢ່າແກ້ໂດຍກົງ. ສ້າງຈາກ build.py.
- `apps-script/Code.gs` — backend Google Apps Script (COLLECTIONS ຕ້ອງຕົງກັບ store.js).

## Build (ສຳຄັນ)
ຫຼັງແກ້ assets/* ໃດໆ ຕ້ອງ rebuild ໄຟລ໌ດຽວ:
```
python build.py
```
ຜົນ = `index.html` (ອັບໂຫລດໄຟລ໌ນີ້ດຽວຂຶ້ນ GitHub Pages). ຜູ້ໃຊ້ອັບໄດ້ແຕ່ 1 ໄຟລ໌ເທົ່ານັ້ນ.

## ກົດການແກ້ໄຂ (ສຳຄັນ — ເຄີຍເກີດ bug)
1. ແກ້ແລ້ວ **ຕ້ອງ** `node --check assets/js/<file>.js` ທຸກຄັ້ງ.
2. ແກ້ CSS ແລ້ວ ກວດວົງປີກກາ `{` = `}` (styles.css ຖືກຕັດກາງເຄີຍເຮັດປຸ່ມຫາຍໝົດ).
3. ໄຟລ໌ມີຕົວໜັງສືລາວ — ຖ້າໃຊ້ replace ໃຫ້ແນ່ໃຈ match ຄັ້ງດຽວ (assert count==1).
4. ຫຼັງ build → `node --check` ສ່ວນ inline JS ຂອງ index.html ອີກຄັ້ງ.

## ທົດສອບ engine (Dr=Cr ສົມດຸນ)
Node harness ງ່າຍໆ:
```
node -e "const fs=require('fs'),vm=require('vm');const c={console,localStorage:{_d:{},getItem(k){return this._d[k]||null},setItem(k,v){this._d[k]=v},removeItem(k){delete this._d[k]}},setTimeout};c.window=c;vm.createContext(c);['config.js','store.js','accounting.js'].forEach(f=>vm.runInContext(fs.readFileSync('assets/js/'+f,'utf8'),c));(async()=>{await c.Store.boot();console.log('OK booted, accounts=',c.Store.all('accounts').length);})();"
```

## ແນວຄິດບັນຊີ
- ທຸກ JE ຜ່ານ `Acc.postJournal({date,source_type,memo,lines})` ແລະ validate Dr=Cr.
- Posting rules ຕັ້ງຄ່າໄດ້: `settings.posting` (role→account) ແລະ `settings.posting_split` (ແບ່ງເທົ່າກັນ). engine ອ່ານຜ່ານ `PA(role)` ແລະ expand split ໃນ postJournal.
- POSTING_DEFAULTS ຢູ່ accounting.js; POSTING_META/POSTING_TX2 ຢູ່ app.js.

## Cloud Mode
ຖ້າເພີ່ມ collection ໃໝ່ໃນ store.js → ຕ້ອງອັບເດດ `apps-script/Code.gs` (COLLECTIONS) ແລ້ວ re-deploy Web App ("Anyone").
