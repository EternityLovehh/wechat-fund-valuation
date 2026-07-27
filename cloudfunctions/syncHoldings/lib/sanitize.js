// 持仓入参清洗:6位代码/正数份额与成本/上限100条。与 aiReport/index.js 内同名函数同规则。
function sanitizeHoldings(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const h of input.slice(0, 100)) {
    if (!h || !/^\d{6}$/.test(String(h.code))) continue;
    const shares = Number(h.shares), cost = Number(h.cost);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(cost) || cost <= 0) continue;
    out.push({ code: String(h.code), name: String(h.name || '').slice(0, 40), shares, cost });
  }
  return out.length ? out : null;
}
module.exports = { sanitizeHoldings };
