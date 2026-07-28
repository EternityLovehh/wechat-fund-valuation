// 纯计算:由持仓+行情数据算出报告事实(facts)。不 require 任何云 SDK,便于本地单测。
// 当日涨跌口径(优先级):
//   ① navDate===today → 已确认净值涨跌(nav,最准,盘后可用)
//   ② 官方估值 estChg(GetFundGZList,已下架,现恒空)
//   ③ 前十大重仓×实时涨跌自算(computed,盘中/净值未出时的兜底,消除"数据缺失")
//   都没有 → 计入 navMissing
// 前十大加权平均涨跌:Σ(占净比×涨跌)/Σ(占净比);剔除 |涨跌|>30% 的脏报价(停牌残值)
function estimateFromTopStocks(topStocks) {
  if (!Array.isArray(topStocks) || !topStocks.length) return null;
  let sw = 0, swc = 0;
  for (const s of topStocks) {
    const chg = Number(s.chg);
    const w = Number(s.weight);
    if (!Number.isFinite(chg) || Math.abs(chg) > 30 || !Number.isFinite(w) || w <= 0) continue;
    sw += w; swc += w * chg;
  }
  return sw > 0 ? round2(swc / sw) : null;
}

function computeFacts(holdings, fundData, indexes, today) {
  if (!Array.isArray(holdings) || !holdings.length) return null;

  const funds = [];
  const navMissing = [];
  let totalValue = 0, totalCost = 0, dayProfit = 0, dayBase = 0;

  for (const h of holdings) {
    const d = (fundData && fundData[h.code]) || {};
    const nav = Number(d.nav);
    if (!Number.isFinite(nav) || nav <= 0) continue; // 连净值都没有:跳过该基金
    const marketValue = h.shares * nav;
    const cost = h.shares * h.cost;

    let dayChg = null, chgSource = null;
    if (d.navDate === today && d.navChg != null && Number.isFinite(Number(d.navChg))) {
      dayChg = Number(d.navChg); chgSource = 'nav';
    } else if (d.estChg != null && Number.isFinite(Number(d.estChg))) {
      dayChg = Number(d.estChg); chgSource = 'est';
    } else {
      const est = estimateFromTopStocks(d.topStocks);
      if (est != null) { dayChg = est; chgSource = 'computed'; }
      else navMissing.push(h.code);
    }

    let dayProfitAmt = 0;
    if (dayChg != null) {
      const yesterday = marketValue / (1 + dayChg / 100);
      dayProfitAmt = marketValue - yesterday;
      dayProfit += dayProfitAmt;
      dayBase += yesterday;
    }
    totalValue += marketValue;
    totalCost += cost;
    funds.push({
      code: h.code, name: h.name || d.name || h.code,
      marketValue: round2(marketValue), dayChg, chgSource,
      dayProfitAmt: round2(dayProfitAmt),
      totalProfitAmt: round2(marketValue - cost),
      totalProfitRate: cost > 0 ? round2(((marketValue - cost) / cost) * 100) : 0,
      periods: Array.isArray(d.periods) ? d.periods : []
    });
  }
  if (!funds.length) return null;
  funds.sort((a, b) => b.dayProfitAmt - a.dayProfitAmt);

  // 重仓股/行业按市值加权穿透
  const stockMap = new Map(), sectorMap = new Map();
  for (const h of holdings) {
    const d = (fundData && fundData[h.code]) || {};
    const nav = Number(d.nav);
    if (!Number.isFinite(nav) || nav <= 0) continue;
    const mv = h.shares * nav;
    for (const s of d.topStocks || []) {
      const cur = stockMap.get(s.code) || { code: s.code, name: s.name, amount: 0, chg: s.chg ?? null };
      cur.amount += (mv * s.weight) / 100;
      stockMap.set(s.code, cur);
    }
    for (const s of d.sectors || []) {
      sectorMap.set(s.name, (sectorMap.get(s.name) || 0) + (mv * s.ratio) / 100);
    }
  }
  const stockExposure = [...stockMap.values()]
    .map((s) => ({ code: s.code, name: s.name, pct: round2((s.amount / totalValue) * 100), chg: s.chg }))
    .sort((a, b) => b.pct - a.pct).slice(0, 10);
  const sectorExposure = [...sectorMap.entries()]
    .map(([name, amt]) => ({ name, pct: round2((amt / totalValue) * 100) }))
    .sort((a, b) => b.pct - a.pct).slice(0, 8);

  return {
    date: today,
    portfolio: {
      totalValue: round2(totalValue), totalCost: round2(totalCost),
      totalProfit: round2(totalValue - totalCost),
      totalProfitRate: totalCost > 0 ? round2(((totalValue - totalCost) / totalCost) * 100) : 0,
      dayProfit: dayProfit,
      dayProfitRate: dayBase > 0 ? round2((dayProfit / dayBase) * 100) : 0,
      navMissing
    },
    funds, stockExposure, sectorExposure,
    indexes: Array.isArray(indexes) ? indexes : []
  };
}
function round2(n) { return Math.round(n * 100) / 100; }
module.exports = { computeFacts };
