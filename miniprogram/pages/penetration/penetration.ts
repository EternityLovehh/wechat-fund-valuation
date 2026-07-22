// penetration.ts - 持仓穿透：把所有持仓基金的重仓股/行业按市值合并，看真实暴露 + 诊断
import { getBatchFundEstimate, getTopHoldingsWeighted, getFundSectorAllocation, getBatchStockChangeMap, getFundType } from '../../utils/fundApi'
import { getHoldingFunds, getImportedHoldings } from '../../utils/storage'
import { normalizeHolding, computePortfolioDiagnosis, PortfolioDiagnosis } from '../../utils/holdingCalc'

interface StockExposure { code: string; name: string; amount: number; pct: number; change: number | null }
interface SectorExposure { name: string; amount: number; pct: number }

Page({
  data: {
    loading: true,
    hasData: false,
    totalValue: 0,
    stockCoverage: 0, // 穿透覆盖度（前十大合计占组合%）
    diagnosis: null as PortfolioDiagnosis | null,
    stocks: [] as StockExposure[],
    sectors: [] as SectorExposure[]
  },

  onLoad() {
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const manual = getHoldingFunds();
      const imported = getImportedHoldings().map(normalizeHolding);
      const raw = [
        ...manual.map((h) => ({ code: h.code, shares: Number(h.shares) || 0, amount: 0 })),
        ...imported.map((h) => ({ code: h.code, shares: Number(h.shares) || 0, amount: Number(h.amount) || 0 }))
      ].filter((h) => /^\d{6}$/.test(h.code));

      if (!raw.length) {
        this.setData({ loading: false, hasData: false });
        return;
      }

      const codes = Array.from(new Set(raw.map((h) => h.code)));
      const estimates = await getBatchFundEstimate(codes);
      const navMap = new Map(estimates.map((e) => [e.code, e.netValue]));

      // 每只持仓的市值：份额×净值，缺份额退回快照金额
      const holdings: Array<{ code: string; marketValue: number; fundType: string }> = [];
      for (const h of raw) {
        const nav = Number(navMap.get(h.code)) || 0;
        const mv = h.shares > 0 && nav > 0 ? h.shares * nav : h.amount || 0;
        if (mv > 0) holdings.push({ code: h.code, marketValue: mv, fundType: getFundType(h.code) });
      }
      const totalValue = holdings.reduce((s, h) => s + h.marketValue, 0);
      if (totalValue <= 0) {
        this.setData({ loading: false, hasData: false });
        return;
      }

      // 各基金重仓股 + 行业（带缓存）
      const uniq = Array.from(new Set(holdings.map((h) => h.code)));
      const [stocksArr, sectorsArr] = await Promise.all([
        Promise.all(uniq.map((c) => getTopHoldingsWeighted(c))),
        Promise.all(uniq.map((c) => getFundSectorAllocation(c)))
      ]);
      const stocksByCode = new Map(uniq.map((c, i) => [c, stocksArr[i]]));
      const sectorsByCode = new Map(uniq.map((c, i) => [c, sectorsArr[i]]));

      // 按市值加权合并：个股暴露 = Σ 基金市值 ×(占净值比/100)
      const stockAgg = new Map<string, { name: string; amount: number }>();
      const sectorAgg = new Map<string, number>();
      for (const h of holdings) {
        for (const s of stocksByCode.get(h.code) || []) {
          const ex = stockAgg.get(s.code) || { name: s.name, amount: 0 };
          ex.amount += h.marketValue * (s.weight / 100);
          if (!ex.name && s.name) ex.name = s.name;
          stockAgg.set(s.code, ex);
        }
        for (const sec of sectorsByCode.get(h.code) || []) {
          sectorAgg.set(sec.name, (sectorAgg.get(sec.name) || 0) + h.marketValue * (sec.ratio / 100));
        }
      }

      const changeMap = await getBatchStockChangeMap(Array.from(stockAgg.keys()));
      const stocks: StockExposure[] = Array.from(stockAgg.entries())
        .map(([code, v]) => ({
          code,
          name: v.name || code,
          amount: v.amount,
          pct: (v.amount / totalValue) * 100,
          change: changeMap.has(code) ? (changeMap.get(code) as number) : null
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 15);
      const coveredAmount = Array.from(stockAgg.values()).reduce((s, v) => s + v.amount, 0);
      const sectors: SectorExposure[] = Array.from(sectorAgg.entries())
        .map(([name, amount]) => ({ name, amount, pct: (amount / totalValue) * 100 }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10);
      const diagnosis = computePortfolioDiagnosis(holdings.map((h) => ({ fundType: h.fundType, amount: h.marketValue })));

      this.setData({
        loading: false,
        hasData: true,
        totalValue,
        stockCoverage: (coveredAmount / totalValue) * 100,
        diagnosis,
        stocks,
        sectors
      });
    } catch (e) {
      console.error('持仓穿透加载失败:', e);
      this.setData({ loading: false, hasData: false });
    }
  }
})
