// holding.ts - 持仓页面
import { getFundEstimate, isMarketActive, getMarketStatus, MarketStatus } from '../../utils/fundApi'
import { getHoldingFunds, HoldingFund, removeHolding, getImportedHoldings, ImportedHolding, removeImportedHolding, saveImportedHolding } from '../../utils/storage'

interface HoldingDisplay extends HoldingFund {
  currentValue: number;
  estimatedValue: number;
  profit: number;
  profitRate: number;
  estimatedProfit: number;
  estimatedProfitRate: number;
  dayGrowth: number; // 今日涨幅
  todayProfit: number; // 今日收益
}

// 导入的持仓显示（包含实时数据）
interface ImportedHoldingDisplay extends ImportedHolding {
  type: 'imported'; // 标记为导入类型
  currentAmount?: number; // 实时金额（根据估值计算）
  estimatedValue?: number; // 当前估值
  dayGrowth?: number; // 今日涨幅
  todayProfit?: number; // 今日收益
  estimatedShares?: number; // 估算份额
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

  onLoad() {
    this.loadHoldings();
  },

  onShow() {
    // 只在持仓列表变化时才重新加载
    const currentCodes = this.data.holdings.map(h => h.code).sort().join(',');
    const manualHoldings = getHoldingFunds();
    const importedHoldings = getImportedHoldings();
    const storedCodes = [...manualHoldings, ...importedHoldings].map(h => h.code).sort().join(',');

    if (currentCodes !== storedCodes) {
      console.log('持仓列表已变化，重新加载');
      this.loadHoldings();
    }

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
    this.setData({ loading: true });
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

      // ===== 手动持仓 =====
      // 持有金额 = 份额 × 当日已确认净值（dwjz），盘中估值跳动不反映在金额里，只在每日净值更新后才变。
      // 今日收益 = 份额 × (估值 − 已确认净值)，盘中实时显示。
      // 估算累计收益 = 份额 × 估值 − 成本（额外字段，UI 默认不展示）。
      const manualResults = await Promise.all(
        holdingFunds.map(async (h) => {
          const fund = await getFundEstimate(h.code);
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
            todayProfit
          };
        })
      );

      // ===== 导入持仓 =====
      // 优先用导入时锚定的 shares/cost；旧数据无锚定时一次性补锚定并写回 storage
      const importedResults = await Promise.all(
        importedHoldings.map(async (h) => {
          const fallback = (): ImportedHoldingDisplay => ({
            type: 'imported' as const,
            ...h,
            currentAmount: h.amount,
            estimatedValue: 0,
            dayGrowth: 0,
            todayProfit: 0,
            estimatedShares: 0
          });

          if (!/^\d{6}$/.test(h.code)) {
            return fallback();
          }

          try {
            const fund = await getFundEstimate(h.code);
            recordSource(fund);
            const netValue = Number(fund.netValue) || 0;
            const estimatedValue = Number(fund.estimatedValue) || netValue;
            const dayGrowth = Number(fund.estimatedGrowth) || 0;

            // 1) 优先使用导入时锚定的 shares；旧数据没有时一次性补锚定
            let shares = Number(h.shares) || 0;
            let cost = Number(h.cost) || 0;
            if (!shares && netValue > 0 && h.amount > 0) {
              shares = h.amount / netValue;
              cost = shares > 0 ? (h.amount - (h.profit || 0)) / shares : 0;
              try {
                saveImportedHolding({
                  ...h,
                  shares,
                  importNetValue: netValue,
                  cost
                });
                console.log('旧导入持仓一次性锚定份额:', h.code, { shares, cost, netValue });
              } catch (e) {
                console.warn('回写锚定信息失败:', e);
              }
            }

            // 2) 实时计算
            // 持有金额按"已确认净值"算 —— 盘中估值跳动不反映在金额里，每日净值更新后才变。
            const valuationPrice = netValue || estimatedValue;
            const totalCost = shares > 0 && cost > 0 ? shares * cost : 0;
            const marketValue = shares > 0 ? shares * valuationPrice : (h.amount || 0);
            const profit = totalCost > 0 ? (marketValue - totalCost) : (h.profit || 0);
            const profitRate = totalCost > 0 ? (profit / totalCost) * 100 : (h.profitRate || 0);
            // 今日盈亏仍按估值口径，盘中实时跳动
            const todayProfit = shares > 0 ? shares * (estimatedValue - netValue) : 0;

            return {
              type: 'imported' as const,
              ...h,
              shares,
              cost,
              currentAmount: marketValue, // 用实时市值替代静态 amount
              estimatedValue,
              dayGrowth,
              todayProfit,
              estimatedShares: shares,
              profit,
              profitRate,
              totalCost
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
