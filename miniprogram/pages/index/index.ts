// index.ts - 自选基金页面
import { getFundEstimate, FundInfo, getFundYearGrowth, isMarketActive, getMarketStatus, MarketStatus } from '../../utils/fundApi'
import { getOptionalFunds, removeOptionalFund, getHoldingFunds, getImportedHoldings } from '../../utils/storage'

interface FundDisplay extends FundInfo {
  yearGrowth?: number; // 近一年涨幅
  holdingAmount?: number; // 持有金额
  holdingProfit?: number; // 持有收益
  todayProfit?: number; // 今日收益
}

Page({
  data: {
    funds: [] as FundDisplay[],
    loading: false,
    refreshing: false, // 下拉刷新状态
    scrollLeft: 0,
    scrollTop: 0,
    marketIndex: null as any, // 大盘指数
    // 数据时效/市场状态
    marketStatus: '' as MarketStatus | '',
    statusLabel: '',
    valuationTime: '',
    valuationDate: ''
  },

  autoRefreshTimer: null as number | null,

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
    this.setData({ loading: true });
    const optionalFunds = getOptionalFunds();
    const manualHoldings = getHoldingFunds();
    const importedHoldings = getImportedHoldings();
    
    if (optionalFunds.length === 0) {
      this.setData({ funds: [], loading: false });
      return;
    }

    try {
      // 使用 Promise.allSettled 而不是 Promise.all，避免单个失败导致全部失败
      const results = await Promise.allSettled(
        optionalFunds.map(async (f) => {
          // 跳过 NAME_ 开头的临时代码
          if (f.code.startsWith('NAME_')) {
            console.log('跳过临时代码:', f.code);
            throw new Error('临时代码');
          }
          // 只获取标准6位数字代码的基金
          if (!/^\d{6}$/.test(f.code)) {
            console.log('跳过非标准代码:', f.code);
            throw new Error('非标准代码');
          }
          
          // 获取基金估值
          const fundInfo = await getFundEstimate(f.code);
          
          // 获取近一年涨幅（不阻塞主流程）
          let yearGrowth = 0;
          try {
            yearGrowth = await getFundYearGrowth(f.code);
          } catch (e) {
            console.log('获取近一年涨幅失败:', f.code);
          }

          // 关联持仓信息
          let holdingAmount = 0;
          let holdingProfit = 0;
          let todayProfit = 0;

          // 1. 检查手动持仓
          const manual = manualHoldings.find(h => h.code === f.code);
          if (manual) {
            const shares = manual.shares || 0;
            const cost = manual.cost || 0;
            const netValue = fundInfo.netValue || fundInfo.estimatedValue;
            holdingAmount = shares * netValue;
            holdingProfit = shares * netValue - shares * cost;
            todayProfit = shares * (fundInfo.estimatedValue - fundInfo.netValue);
          }

          // 2. 检查导入持仓 (累加，虽然通常代码唯一)
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
              // 兜底使用快照
              holdingAmount = imported.amount || 0;
              holdingProfit = imported.profit || 0;
            }
          }
          
          return {
            ...fundInfo,
            yearGrowth,
            holdingAmount,
            holdingProfit,
            todayProfit
          } as FundDisplay;
        })
      );
      
      // 只保留成功的结果
      const funds = results
        .filter((r): r is PromiseFulfilledResult<FundDisplay> => r.status === 'fulfilled')
        .map(r => r.value);


      console.log('成功加载基金数量:', funds.length, '/', optionalFunds.length);

      // 数据时效/市场状态
      const status = getMarketStatus();
      const STATUS_LABELS: Record<MarketStatus, string> = {
        'trading': '交易中',
        'lunch': '午间休市',
        'pre-open': '盘前',
        'post-close': '盘后',
        'weekend': '休市'
      };
      let latestUpdateTime = '';
      let latestValuationDate = '';
      for (const f of funds) {
        if (f.updateTime && f.updateTime > latestUpdateTime) latestUpdateTime = f.updateTime;
        if (f.valuationDate && f.valuationDate > latestValuationDate) latestValuationDate = f.valuationDate;
      }

      this.setData({
        funds,
        marketStatus: status,
        statusLabel: STATUS_LABELS[status],
        valuationTime: latestUpdateTime ? latestUpdateTime.slice(-5) : '',
        valuationDate: latestValuationDate ? latestValuationDate.slice(5) : '',
        loading: false
      });
      
      // 如果有失败的，提示用户
      const failedCount = results.filter(r => r.status === 'rejected').length;
      if (failedCount > 0) {
        console.log('加载失败数量:', failedCount);
      }
    } catch (e) {
      console.error('加载自选失败:', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // 加载大盘指数
  async loadMarketIndex() {
    try {
      wx.request({
        url: 'https://qt.gtimg.cn/q=s_sh000001,s_sz399001,s_sz399006',
        method: 'GET',
        success: (res: any) => {
          try {
            const data = res.data;
            console.log('大盘指数原始数据:', data);
            
            if (typeof data !== 'string') {
              return;
            }
            
            // 解析上证指数
            const shMatch = data.match(/v_s_sh000001="([^"]*)"/);
            // 解析深证成指
            const szMatch = data.match(/v_s_sz399001="([^"]*)"/);
            // 解析创业板指
            const cybMatch = data.match(/v_s_sz399006="([^"]*)"/);
            
            const parseIndex = (match: RegExpMatchArray | null, indexName: string) => {
              if (!match || !match[1]) return null;
              const fields = match[1].split('~');
              if (fields.length < 6) return null;
              
              // 使用传入的名称，避免编码问题
              const name = indexName;
              const current = parseFloat(fields[3]);
              const change = parseFloat(fields[4]);
              const changePercent = parseFloat(fields[5]);
              
              return { name, current, change, changePercent };
            };
            
            const sh = parseIndex(shMatch, '上证指数');
            const sz = parseIndex(szMatch, '深证成指');
            const cyb = parseIndex(cybMatch, '创业板指');
            
            if (sh || sz || cyb) {
              this.setData({
                marketIndex: {
                  sh: sh,
                  sz: sz,
                  cyb: cyb
                }
              });
            }
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
