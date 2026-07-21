// holding.ts - 持仓页面
import { getBatchFundEstimate, FundInfo, getNetValueByDate, isMarketActive, getMarketStatus, MarketStatus } from '../../utils/fundApi'
import { getHoldingFunds, HoldingFund, removeHolding, getImportedHoldings, ImportedHolding, removeImportedHolding, saveImportedHolding } from '../../utils/storage'
import { normalizeHolding, settlePendingAdds, computeImportedDisplay } from '../../utils/holdingCalc'
import { getTodayStr } from '../../utils/appDate'

interface HoldingDisplay extends HoldingFund {
  currentValue: number;
  estimatedValue: number;
  profit: number;
  profitRate: number;
  estimatedProfit: number;
  estimatedProfitRate: number;
  dayGrowth: number; // 今日涨幅
  todayProfit: number; // 今日收益
  estimateSource?: FundInfo['estimateSource']; // 估值来源(official/navchg/computed/none)
}

// 导入的持仓显示（包含实时数据）
interface ImportedHoldingDisplay extends ImportedHolding {
  type: 'imported'; // 标记为导入类型
  currentAmount?: number; // 实时金额（已确认市值 + 待确认加仓）
  estimatedValue?: number; // 当前估值
  dayGrowth?: number; // 今日涨幅
  todayProfit?: number; // 今日收益
  estimatedShares?: number; // 估算份额
  pendingAmount?: number; // 待确认加仓金额合计（>0 时 UI 显示"加仓确认中"）
  estimateSource?: FundInfo['estimateSource']; // 估值来源(official/navchg/computed/none)
}

// 统一的持仓显示类型
type UnifiedHoldingDisplay = (HoldingDisplay & { type: 'manual' }) | ImportedHoldingDisplay;

Page({
  data: {
    holdings: [] as UnifiedHoldingDisplay[],
    refreshing: false, // 下拉刷新状态
    totalCost: 0,
    totalValue: 0,
    totalProfit: 0,
    totalProfitRate: 0,
    totalDayProfit: 0,
    totalDayProfitRate: 0,
    loading: false,
    scrollLeft: 0,
    scrollTop: 0,
    // 数据来源/时效说明
    marketStatus: '' as MarketStatus | '',
    statusLabel: '',
    valuationTime: '', // 估值时间 gztime，如 "2026-05-09 14:32"
    valuationDate: ''  // 净值日期 jzrq，如 "2026-05-09"
  } as {
    holdings: UnifiedHoldingDisplay[];
    totalCost: number;
    totalValue: number;
    totalProfit: number;
    totalProfitRate: number;
    totalDayProfit: number;
    totalDayProfitRate: number;
    loading: boolean;
    scrollLeft: number;
    scrollTop: number;
    marketStatus: MarketStatus | '';
    statusLabel: string;
    valuationTime: string;
    valuationDate: string;
  },

  autoRefreshTimer: null as number | null,
  loadSeq: 0, // loadHoldings 并发守卫序号

  onLoad() {
    this.loadHoldings();
  },

  onShow() {
    // 每次进入都重新加载：持仓金额/加仓待确认等会在不改变基金代码集合的情况下变化
    // （如加仓、重新导入同一批基金），只比代码集合会漏掉这些更新，导致显示旧金额。
    this.loadHoldings();
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  // 交易时段每 30s 自动刷新一次估值；非交易时段不刷新（数据本身也不会变）
  startAutoRefresh() {
    this.stopAutoRefresh();
    if (!isMarketActive()) {
      console.log('当前非交易时段，不启动自动刷新');
      return;
    }
    this.autoRefreshTimer = setInterval(() => {
      if (!isMarketActive()) {
        this.stopAutoRefresh();
        return;
      }
      this.loadHoldings();
    }, 30000) as unknown as number;
    console.log('已启动 30s 自动刷新');
  },

  stopAutoRefresh() {
    if (this.autoRefreshTimer != null) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  },

  async loadHoldings() {
    // 并发守卫：onShow / 30s 自动刷新 / 下拉刷新可能重叠，只让最新一次的结果落地，
    // 避免慢的那次（数据可能不全）最后 setData 覆盖掉好的结果导致估值闪烁/消失
    const seq = ++this.loadSeq;
    // 仅首次（列表为空）显示"加载中"，后续刷新/onShow 原地更新，避免每次闪烁
    this.setData({ loading: this.data.holdings.length === 0 });
    const holdingFunds = getHoldingFunds(); // 手动输入的持仓
    const importedHoldings = getImportedHoldings(); // 从截图导入的持仓

    if (holdingFunds.length === 0 && importedHoldings.length === 0) {
      this.setData({
        holdings: [],
        totalCost: 0,
        totalValue: 0,
        totalProfit: 0,
        totalProfitRate: 0,
        totalDayProfit: 0,
        totalDayProfitRate: 0,
        loading: false
      });
      return;
    }

    try {
      // 记录数据来源时效，用于页面顶部状态栏
      let latestUpdateTime = '';
      let latestValuationDate = '';
      const recordSource = (fund: { updateTime?: string; valuationDate?: string }) => {
        if (fund.updateTime && fund.updateTime > latestUpdateTime) {
          latestUpdateTime = fund.updateTime;
        }
        if (fund.valuationDate && fund.valuationDate > latestValuationDate) {
          latestValuationDate = fund.valuationDate;
        }
      };

      // 手动 + 导入持仓的全部基金代码，一次批量拉取估值，后续按代码查表
      const allCodes = [
        ...holdingFunds.map(h => h.code),
        ...importedHoldings.map(h => h.code)
      ];
      const estimates = await getBatchFundEstimate(allCodes);
      const estMap = new Map<string, FundInfo>(estimates.map(e => [e.code, e]));

      // ===== 手动持仓 =====
      // 持有金额 = 份额 × 当日已确认净值（dwjz），盘中估值跳动不反映在金额里，只在每日净值更新后才变。
      // 今日收益 = 份额 × (估值 − 已确认净值)，盘中实时显示。
      // 估算累计收益 = 份额 × 估值 − 成本（额外字段，UI 默认不展示）。
      const manualResults = holdingFunds.map((h) => {
          // 缺失估值（代码非标准/接口未返回）时用 0 值兜底，仍显示该行而非整页失败
          const fund = estMap.get(h.code) || {
            code: h.code, name: h.name, type: '',
            netValue: 0, estimatedValue: 0, estimatedGrowth: 0, dayGrowth: 0,
            updateTime: '', valuationDate: ''
          } as FundInfo;
          recordSource(fund);
          const netValue = Number(fund.netValue) || 0;
          const estimatedValue = Number(fund.estimatedValue) || netValue;
          const dayGrowth = Number(fund.estimatedGrowth) || 0;
          const shares = Number(h.shares) || 0;
          const cost = Number(h.cost) || 0;

          // 计算金额用的净值：优先已确认 dwjz，缺失时退回估值（极少发生）
          const valuationPrice = netValue || estimatedValue;
          const totalCost = shares * cost;
          const marketValue = shares * valuationPrice;             // 显示用市值（净值口径）
          const profit = marketValue - totalCost;                  // 已确认累计收益
          const profitRate = totalCost > 0 ? (profit / totalCost) * 100 : 0;
          const estimatedMarketValue = shares * estimatedValue;    // 估算市值（用于今日盈亏率分母）
          const estimatedProfit = estimatedMarketValue - totalCost;
          const estimatedProfitRate = totalCost > 0 ? (estimatedProfit / totalCost) * 100 : 0;
          // 严格今日收益 = 份额 × (估值 − 当日已确认净值)
          const todayProfit = shares * (estimatedValue - netValue);

          return {
            type: 'manual' as const,
            code: h.code,
            name: fund.name,
            shares,
            cost,
            buyRecords: h.buyRecords || [],
            currentValue: netValue,
            estimatedValue,
            currentAmount: marketValue, // WXML 用这个统一显示金额（按净值算）
            profit,
            profitRate,
            estimatedProfit,
            estimatedProfitRate,
            dayGrowth,
            todayProfit,
            estimateSource: fund.estimateSource
          };
        });

      // ===== 导入持仓 =====
      // 数据结构：已确认份额/成本 + 待确认加仓 lot。每次加载时把已发布净值的加仓 lot 结算并入。
      const importedResults = await Promise.all(
        importedHoldings.map(async (raw) => {
          const h = normalizeHolding(raw); // 旧数据迁移成新结构
          const fallback = (): ImportedHoldingDisplay => ({
            type: 'imported' as const,
            ...h,
            currentAmount: h.amount,
            estimatedValue: 0,
            dayGrowth: 0,
            todayProfit: 0,
            estimatedShares: 0,
            pendingAmount: (h.pendingAdds || []).reduce((s, a) => s + a.amount, 0)
          });

          if (!/^\d{6}$/.test(h.code)) {
            return fallback();
          }

          try {
            const fund = estMap.get(h.code);
            if (!fund) return fallback();
            recordSource(fund);
            const netValue = Number(fund.netValue) || 0;
            const estimatedValue = Number(fund.estimatedValue) || netValue;
            const dayGrowth = Number(fund.estimatedGrowth) || 0;
            const valuationDate = fund.valuationDate || '';

            let shares = Number(h.shares) || 0;
            let cost = Number(h.cost) || 0;
            let pendingAdds = h.pendingAdds || [];

            // 1) 旧数据无锚定份额、又没有待确认加仓：用 amount/净值一次性补锚定
            if (!shares && pendingAdds.length === 0 && netValue > 0 && (h.amount || 0) > 0) {
              shares = (h.amount as number) / netValue;
              cost = shares > 0 ? ((h.amount as number) - (h.profit || 0)) / shares : 0;
            }

            // 2) 结算待确认加仓：查每笔加仓申请日的已确认净值，已发布的折成份额并入已确认部分
            if (pendingAdds.length > 0) {
              const today = getTodayStr();
              const navByDate: Record<string, number> = {};
              await Promise.all(pendingAdds.map(async (add) => {
                if (!add.date || navByDate[add.date] !== undefined) return;
                // 申请日 ≥ 今天：当日净值尚未最终确认，保持"确认中"，不结算
                if (add.date >= today) return;
                // 申请日就是最新净值日期时直接用当前净值，省一次请求
                if (valuationDate && add.date === valuationDate && netValue > 0) {
                  navByDate[add.date] = netValue;
                } else {
                  navByDate[add.date] = await getNetValueByDate(h.code, add.date);
                }
              }));
              const settled = settlePendingAdds(shares, cost, pendingAdds, navByDate);
              shares = settled.shares;
              cost = settled.cost;
              pendingAdds = settled.pendingAdds;
            }

            // 3) 若份额/成本或待确认列表有变化，写回 storage
            const changed = shares !== (Number(h.shares) || 0)
              || cost !== (Number(h.cost) || 0)
              || pendingAdds.length !== (h.pendingAdds || []).length;
            if (changed) {
              try {
                saveImportedHolding({ ...h, shares, cost, pendingAdds });
              } catch (e) {
                console.warn('回写持仓锚定/结算失败:', e);
              }
            }

            // 4) 实时显示计算
            const calc = computeImportedDisplay(shares, cost, pendingAdds, netValue, estimatedValue);

            return {
              type: 'imported' as const,
              ...h,
              shares,
              cost,
              pendingAdds,
              currentAmount: calc.holdingAmount,
              pendingAmount: calc.pendingAmount,
              estimatedValue,
              dayGrowth: shares > 0 ? dayGrowth : 0,
              todayProfit: calc.todayProfit,
              estimatedShares: shares,
              profit: calc.profit,
              profitRate: calc.profitRate,
              totalCost: calc.totalCost,
              estimateSource: fund.estimateSource
            } as ImportedHoldingDisplay;
          } catch (e) {
            console.error('获取导入持仓估值失败:', h.code, e);
            return fallback();
          }
        })
      );

      const allHoldings: UnifiedHoldingDisplay[] = [
        ...manualResults,
        ...importedResults
      ];

      // ===== 统一汇总 =====
      let totalValue = 0;
      let totalCost = 0;
      let totalProfit = 0;
      let totalDayProfit = 0;

      for (const h of manualResults) {
        const mv = Number((h as any).currentAmount) || 0;
        totalValue += mv;
        totalCost += h.shares * h.cost;
        totalProfit += h.profit; // 已经是 mv − totalCost
        totalDayProfit += h.todayProfit;
      }

      for (const h of importedResults) {
        const anyH = h as any;
        const mv = Number(anyH.currentAmount) || 0;
        totalValue += mv;
        if (anyH.totalCost && anyH.totalCost > 0) {
          totalCost += anyH.totalCost;
          totalProfit += anyH.profit || 0;
        } else {
          // 旧数据/锚定失败：用截图快照的 profit 近似累计收益（不计入 totalCost，避免污染收益率）
          totalProfit += anyH.profit || 0;
        }
        totalDayProfit += anyH.todayProfit || 0;
      }

      const totalProfitRate = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
      const yesterdayMarketValue = totalValue - totalDayProfit;
      const totalDayProfitRate = yesterdayMarketValue > 0
        ? (totalDayProfit / yesterdayMarketValue) * 100
        : 0;

      // 持仓占比按"持有金额"（已确认净值口径）
      allHoldings.forEach(h => {
        const mv = Number((h as any).currentAmount) || 0;
        (h as any).holdingRatio = totalValue > 0 ? (mv / totalValue) * 100 : 0;
      });

      // 数据时效/市场状态
      const status = getMarketStatus();
      const STATUS_LABELS: Record<MarketStatus, string> = {
        'trading': '交易中',
        'lunch': '午间休市',
        'pre-open': '盘前',
        'post-close': '盘后',
        'weekend': '休市'
      };
      // 估值时间只显示 HH:mm；净值日期截 MM-DD
      const valuationTime = latestUpdateTime
        ? latestUpdateTime.slice(-5)
        : '';
      const valuationDate = latestValuationDate
        ? latestValuationDate.slice(5) // YYYY-MM-DD → MM-DD
        : '';

      // 已有更新的一次加载在跑：丢弃本次（较旧）结果，避免覆盖闪烁
      if (seq !== this.loadSeq) return;

      this.setData({
        holdings: allHoldings,
        totalCost: Number(totalCost) || 0,
        totalValue: Number(totalValue) || 0,
        totalProfit: Number(totalProfit) || 0,
        totalProfitRate: Number(totalProfitRate) || 0,
        totalDayProfit: Number(totalDayProfit) || 0,
        totalDayProfitRate: Number(totalDayProfitRate) || 0,
        marketStatus: status,
        statusLabel: STATUS_LABELS[status],
        valuationTime,
        valuationDate,
        loading: false
      });
    } catch (e) {
      console.error('加载持仓失败:', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

    onPullDownRefresh() {
    this.loadHoldings().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  goToDetail(e: any) {
    const { code } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/detail/detail?code=${code}&from=holding` });
  },

  goToImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  // 删除单个持仓
  deleteHolding(e: any) {
    const { code, name, type } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: `确定要删除 ${name} 的持仓吗？`,
      confirmText: '删除',
      confirmColor: '#ff4444',
      success: (res) => {
        if (res.confirm) {
          if (type === 'imported') {
            removeImportedHolding(code);
          } else {
            removeHolding(code);
          }
          this.loadHoldings();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  },

  // 一键清空所有持仓
  clearAllHoldings() {
    const { holdings } = this.data;
    if (holdings.length === 0) {
      wx.showToast({ title: '暂无持仓', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认清空',
      content: `确定要清空所有 ${holdings.length} 个持仓吗？此操作不可恢复！`,
      confirmText: '清空',
      confirmColor: '#ff4444',
      success: (res) => {
        if (res.confirm) {
          holdings.forEach(h => {
            if (h.type === 'imported') {
              removeImportedHolding(h.code);
            } else {
              removeHolding(h.code);
            }
          });
          this.loadHoldings();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  },

  // 左侧滚动事件 - 同步纵向滚动到右侧
  onLeftScroll(e: any) {
    this.setData({
      scrollTop: e.detail.scrollTop
    });
  },

  // 右侧滚动事件 - 同步纵向滚动到左侧
  onRightScroll(e: any) {
    this.setData({
      scrollTop: e.detail.scrollTop
    });
  },

  // 下拉刷新
  async onRefresh() {
    this.setData({ refreshing: true });
    try {
      await this.loadHoldings();
    } catch (e) {
      console.error('刷新失败:', e);
    } finally {
      this.setData({ refreshing: false });
    }
  }
})
