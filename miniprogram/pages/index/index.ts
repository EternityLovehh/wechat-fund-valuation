// index.ts - 自选基金页面
import { getBatchFundEstimate, FundInfo, getFundPeriodIncrease, getFundBoards, isMarketActive, getMarketStatus, MarketStatus } from '../../utils/fundApi'
import { getOptionalFunds, removeOptionalFund, getHoldingFunds, getImportedHoldings } from '../../utils/storage'

interface FundDisplay extends FundInfo {
  yearGrowth?: number; // 近一年涨幅
  m1?: number; // 近1月
  m3?: number; // 近3月
  y1?: number; // 近1年
  board?: string; // 主板块
  boardChange?: number | null; // 主板块今日涨跌
  holdingAmount?: number; // 持有金额
  holdingProfit?: number; // 持有收益
  todayProfit?: number; // 今日收益
}

Page({
  data: {
    funds: [] as FundDisplay[],
    loading: false,
    enriched: false, // 阶段涨幅/关联板块是否已补齐(第二段渲染)
    refreshing: false, // 下拉刷新状态
    scrollLeft: 0,
    scrollTop: 0,
    marketIndices: [] as Array<{ name: string; current: number; changePercent: number }>, // 大盘指数
    // 数据时效/市场状态
    marketStatus: '' as MarketStatus | '',
    statusLabel: '',
    valuationTime: '',
    valuationDate: ''
  },

  autoRefreshTimer: null as number | null,
  loadSeq: 0, // loadFunds 并发守卫序号

  onLoad() {
    this.loadFunds();
    this.loadMarketIndex();
  },

  onShow() {
    // 加载最新的基金列表和持仓信息
    this.loadFunds();
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  // 交易时段每 30s 自动刷新基金估值和大盘指数；非交易时段不刷新
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
      this.loadFunds();
      this.loadMarketIndex();
    }, 30000) as unknown as number;
    console.log('自选页：已启动 30s 自动刷新');
  },

  stopAutoRefresh() {
    if (this.autoRefreshTimer != null) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  },

  // 加载自选基金
  async loadFunds() {
    // 并发守卫：onShow / 30s 自动刷新 / 下拉刷新可能重叠，只让最新一次结果落地
    const seq = ++this.loadSeq;
    // 仅首次（列表为空）显示骨架屏，避免每次自动刷新都闪一下
    this.setData({ loading: this.data.funds.length === 0 });
    const optionalFunds = getOptionalFunds();
    const manualHoldings = getHoldingFunds();
    const importedHoldings = getImportedHoldings();
    
    if (optionalFunds.length === 0) {
      this.setData({ funds: [], loading: false });
      return;
    }

    try {
      // 只取标准 6 位数字代码（自动排除 NAME_ 临时码/非标准码），一次批量拉取全部估值
      const codes = optionalFunds.map(f => f.code).filter(code => /^\d{6}$/.test(code));
      const estimates = await getBatchFundEstimate(codes, { recordAccuracy: true });
      const estMap = new Map(estimates.map(e => [e.code, e]));

      // 组装函数：period/board 可后补(先渲染核心列，再补阶段涨幅/关联板块)
      type Per = { m1: number; m3: number; y1: number };
      const assemble = (
        periodMap: Map<string, Per>,
        boardMap: Map<string, { board: string; change: number | null }>
      ): FundDisplay[] => {
        const funds: FundDisplay[] = [];
        for (const f of optionalFunds) {
          const fundInfo = estMap.get(f.code);
          if (!fundInfo) continue;
          const per = periodMap.get(f.code);

          let holdingAmount = 0, holdingProfit = 0, todayProfit = 0;
          const manual = manualHoldings.find(h => h.code === f.code);
          if (manual) {
            const shares = manual.shares || 0;
            const cost = manual.cost || 0;
            const netValue = fundInfo.netValue || fundInfo.estimatedValue;
            holdingAmount = shares * netValue;
            holdingProfit = shares * netValue - shares * cost;
            todayProfit = shares * (fundInfo.estimatedValue - fundInfo.netValue);
          }
          const imported = importedHoldings.find(h => h.code === f.code);
          if (imported) {
            const shares = imported.shares || 0;
            const cost = imported.cost || 0;
            const netValue = fundInfo.netValue || fundInfo.estimatedValue;
            if (shares > 0) {
              holdingAmount = shares * netValue;
              holdingProfit = cost > 0 ? (shares * netValue - shares * cost) : (imported.profit || 0);
              todayProfit = shares * (fundInfo.estimatedValue - fundInfo.netValue);
            } else {
              holdingAmount = imported.amount || 0;
              holdingProfit = imported.profit || 0;
            }
          }

          const bd = boardMap.get(f.code);
          funds.push({
            ...fundInfo,
            yearGrowth: per ? per.y1 : undefined,
            m1: per ? per.m1 : undefined,
            m3: per ? per.m3 : undefined,
            y1: per ? per.y1 : undefined,
            board: bd ? bd.board : '',
            boardChange: bd ? bd.change : null,
            holdingAmount,
            holdingProfit,
            todayProfit
          } as FundDisplay);
        }
        return funds;
      };

      // 数据时效/市场状态(估值已含 updateTime/valuationDate)
      const status = getMarketStatus();
      const STATUS_LABELS: Record<MarketStatus, string> = {
        'trading': '交易中', 'lunch': '午间休市', 'pre-open': '盘前',
        'post-close': '盘后', 'holiday': '休市', 'weekend': '休市'
      };
      let latestUpdateTime = '', latestValuationDate = '';
      estMap.forEach((f) => {
        if (f.updateTime && f.updateTime > latestUpdateTime) latestUpdateTime = f.updateTime;
        if (f.valuationDate && f.valuationDate > latestValuationDate) latestValuationDate = f.valuationDate;
      });

      const statusFields = {
        marketStatus: status,
        statusLabel: STATUS_LABELS[status],
        valuationTime: latestUpdateTime ? latestUpdateTime.slice(-5) : '',
        valuationDate: latestValuationDate ? latestValuationDate.slice(5) : ''
      };

      // ===== 第一段(仅首次加载):估值就绪即渲染核心列 + 关骨架屏;周期/板块占位 =====
      // 30s 自动刷新时已有数据,跳过本段,避免占位符 `··` 每次闪一下。
      const firstLoad = this.data.funds.length === 0;
      if (firstLoad) {
        if (seq !== this.loadSeq) return;
        this.setData({ funds: assemble(new Map(), new Map()), enriched: false, loading: false, ...statusFields });
      }

      // ===== 第二段:阶段涨幅 + 关联板块(较慢),后台并发拉取后补齐 =====
      const nameMap: Record<string, string> = {};
      estMap.forEach((v, k) => { nameMap[k] = v.name; });
      const [periodEntries, boardMap] = await Promise.all([
        Promise.all(
          Array.from(estMap.keys()).map(async (code): Promise<[string, Per]> => {
            try {
              const p = await getFundPeriodIncrease(code);
              const g = (label: string) => { const x = p.find((pp) => pp.label === label); return x ? x.syl : 0; };
              return [code, { m1: g('近1月'), m3: g('近3月'), y1: g('近1年') }];
            } catch (e) {
              return [code, { m1: 0, m3: 0, y1: 0 }];
            }
          })
        ),
        getFundBoards(Array.from(estMap.keys()), nameMap).catch(() => new Map<string, { board: string; change: number | null }>())
      ]);
      const periodMap = new Map<string, Per>(periodEntries);

      if (seq !== this.loadSeq) return;
      this.setData({ funds: assemble(periodMap, boardMap), enriched: true, loading: false, ...statusFields });
    } catch (e) {
      console.error('加载自选失败:', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // 加载大盘指数（上证/深证/创业板/科创50/沪深300/北证50）
  async loadMarketIndex() {
    try {
      const defs = [
        { code: 's_sh000001', name: '上证指数' },
        { code: 's_sz399001', name: '深证成指' },
        { code: 's_sz399006', name: '创业板指' },
        { code: 's_sh000688', name: '科创50' },
        { code: 's_sh000300', name: '沪深300' },
        { code: 's_bj899050', name: '北证50' }
      ];
      wx.request({
        url: `https://qt.gtimg.cn/q=${defs.map((d) => d.code).join(',')}`,
        method: 'GET',
        success: (res: any) => {
          try {
            const data = res.data;
            if (typeof data !== 'string') return;
            const indices = defs
              .map((d) => {
                const m = data.match(new RegExp('v_' + d.code + '="([^"]*)"'));
                if (!m || !m[1]) return null;
                const f = m[1].split('~');
                if (f.length < 6) return null;
                return { name: d.name, current: parseFloat(f[3]), changePercent: parseFloat(f[5]) };
              })
              .filter((x) => x !== null);
            if (indices.length) this.setData({ marketIndices: indices });
          } catch (e) {
            console.error('解析大盘指数失败:', e);
          }
        },
        fail: (err) => {
          console.error('获取大盘指数失败:', err);
        }
      });
    } catch (e) {
      console.error('加载大盘指数失败:', e);
    }
  },

  // 下拉刷新
  async onPullDownRefresh() {
    await this.loadFunds();
    wx.stopPullDownRefresh();
  },

  // 跳转到搜索页
  goToSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  // 跳转到详情页
  goToDetail(e: any) {
    const { code } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/detail/detail?code=${code}` });
  },

  // 删除自选
  deleteFund(e: any) {
    const { code, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: `确定要删除 ${name} 吗？`,
      confirmText: '删除',
      confirmColor: '#ff4444',
      success: (res) => {
        if (res.confirm) {
          removeOptionalFund(code);
          this.loadFunds();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  },

  // 一键清空所有自选
  clearAllFunds() {
    const { funds } = this.data;
    if (funds.length === 0) {
      wx.showToast({ title: '暂无自选', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认清空',
      content: `确定要清空所有 ${funds.length} 个自选基金吗？`,
      confirmText: '清空',
      confirmColor: '#ff4444',
      success: (res) => {
        if (res.confirm) {
          funds.forEach(f => removeOptionalFund(f.code));
          this.loadFunds();
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
      await Promise.all([
        this.loadFunds(),
        this.loadMarketIndex()
      ]);
    } catch (e) {
      console.error('刷新失败:', e);
    } finally {
      this.setData({ refreshing: false });
    }
  }
})
