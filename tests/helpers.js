// Shared test sandbox: loads the real browser files into a vm context with an in-memory localStorage.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function freshApp(opts = {}) {
  const mem = opts.mem || {};
  const ctx = {
    console,
    localStorage: {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["config", "store", "accounting", "guard", "autopost", "flows", "checks", "procure", "perms", "posin", "fs", "extin", "postmon", "gate", "gate-types", "review", "filing", "stockdoc", "coa-lt", "jvimport"]) {
    const code = fs.readFileSync(path.join(__dirname, "..", "js", f + ".js"), "utf8");
    vm.runInContext(code, ctx, { filename: f + ".js" });
  }
  if (opts.beforeBoot) opts.beforeBoot(ctx, mem);
  await ctx.Store.boot(); // demo mode: seeds CoA, tax codes, bank, 100 x water @22,000
  return ctx;
}

module.exports = { freshApp };
