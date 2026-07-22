// detail.ts - 基金详情页面
import { getFundEstimate, FundInfo, getFundHoldings, getFundIndustry, getFundYearGrowth, getBatchStockQuotes, getFundBaseInfo, getFundPeriodIncrease, FundBaseInfo, PeriodPerf } from '../../utils/fundApi'
import { getHoldingFunds, removeHolding, getImportedHoldings, saveImportedHolding, removeImportedHolding, addOptionalFund } from '../../utils/storage'
import { normalizeHolding } from '../../utils/holdingCalc'
import { getTodayStr } from '../../utils/appDate'
import { enableFundAlert } from '../../utils/alert'

// 当前日期 YYYY-MM-DD（走统一开关，便于调试时整体覆盖）
function todayStr(): string {
  return getTodayStr();
}

Page({
  data: {
    code: '',
    fund: null as FundInfo | null,
    holding: null as any,
    holdings: null as any,
    industry: null as any,
    showTradeModal: false,
    tradeType: 'buy' as 'buy' | 'sell',
    tradeAmount: '', // 改为金额
    loading: false,
    from: '', // 来源页面：holding表示从持仓页进入
    // 扩展数据
    holdingAmount: 0, // 持有金额
    holdingRatio: 0, // 持仓占比
    holdingProfit: 0, // 持有收益
    holdingProfitRate: 0, // 持有收益率
    holdingDays: 0, // 持有天数
    yesterdayProfit: 0, // 昨日收益
    yesterdayProfitRate: 0, // 昨日收益率
    dayGrowth: 0, // 当日涨幅
    yearGrowth: 0, // 近一年涨幅
    fundHeat: 0, // 基金热度排名
    // 份额类别切换
    showShareClassModal: false,
    availableShareClasses: [] as Array<{code: string, name: string, shareClass: string}>,
    currentShareClass: '',
    chartTs: 0, // 估值分时图缓存刷新戳
    baseInfo: null as FundBaseInfo | null, // 基本信息补全
    periods: [] as PeriodPerf[] // 阶段业绩+排名
  },

  // 开启涨跌提醒：默认 ±3%，一键一次性订阅并记录到云端
  async openAlert() {
    const fund = this.data.fund;
    if (!fund) return;
    wx.showLoading({ title: '开启中', mask: true });
    const r = await enableFundAlert(fund.code, fund.name, 3, 3);
    wx.hideLoading();
    const msg = r === 'ok' ? '已按 ±3% 开启，命中后推送一次' : r === 'rejected' ? '未授权订阅' : '开启失败';
    wx.showToast({ title: msg, icon: r === 'ok' ? 'success' : 'none' });
  },

  onLoad(options: any) {
    console.log('Detail页面加载，参数:', options);
    const { code, from } = options;
    
    if (!code) {
      console.error('缺少基金代码参数');
      wx.showToast({ 
        title: '缺少基金代码', 
        icon: 'none',
        duration: 2000
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 2000);
      return;
    }
    
    console.log('基金代码:', code, '来源:', from);
    this.setData({ code, from: from || '' });
    this.loadFundDetail();
  },

  async loadFundDetail() {
    this.setData({ loading: true, chartTs: Date.now() }); // 每次加载/下拉刷新都刷新估值分时图
    try {
      const fund = await getFundEstimate(this.data.code);
      
      // 检查手动买入的持仓
      const holdingFunds = getHoldingFunds();
      let holding = holdingFunds.find(h => h.code === this.data.code);
      
      // 如果没有手动持仓，检查导入的持仓
      if (!holding) {
        const importedHoldings = getImportedHoldings();
        const importedHolding = importedHoldings.find(h => h.code === this.data.code);
        
        if (importedHolding) {
          // 将导入的持仓转换为标准格式
          // 优先用导入时锚定的份额/成本；缺失时（旧数据）再从快照金额反推
          const valuation = Number(fund.estimatedValue) || Number(fund.netValue) || 0;
          const snapshotAmount = Number(importedHolding.amount) || 0;
          const snapshotRate = Number(importedHolding.profitRate) || 0;
          const estimatedShares = (Number(importedHolding.shares) > 0)
            ? Number(importedHolding.shares)
            : (valuation > 0 ? snapshotAmount / valuation : 0);
          const estimatedCost = (Number(importedHolding.cost) > 0)
            ? Number(importedHolding.cost)
            : (estimatedShares > 0 ? (snapshotAmount / (1 + snapshotRate / 100)) / estimatedShares : 0);

          holding = {
            code: importedHolding.code,
            name: importedHolding.name,
            shares: estimatedShares,
            cost: estimatedCost,
            buyRecords: [{
              date: new Date(importedHolding.importTime).toLocaleDateString('zh-CN'),
              shares: estimatedShares,
              price: estimatedCost,
              type: 'buy' as const
            }]
          };
        }
      }
      
      console.log('=== 详细调试信息 ===');
      console.log('1. 基金信息:', fund);
      console.log('2. 手动持仓:', holdingFunds);
      console.log('3. 导入持仓:', getImportedHoldings());
      console.log('4. 当前持仓:', holding);
      console.log('5. 来源页面:', this.data.from);
      console.log('6. 条件判断:');
      console.log('   - from === "holding":', this.data.from === 'holding');
      console.log('   - holding存在:', !!holding);
      console.log('   - 两者都满足:', this.data.from === 'holding' && !!holding);
      
      if (holding) {
        console.log('7. 持仓详情:');
        console.log('   - code:', holding.code);
        console.log('   - name:', holding.name);
        console.log('   - shares:', holding.shares);
        console.log('   - cost:', holding.cost);
        console.log('   - buyRecords:', holding.buyRecords);
      }
      
      // 计算扩展数据
      const extendedData = this.calculateExtendedData(fund, holding, holdingFunds);
      console.log('8. 计算后的扩展数据:', extendedData);
      
      this.setData({ 
        fund, 
        holding,
        loading: false,
        ...extendedData
      });
      
      console.log('9. setData后的页面数据:');
      console.log('   - from:', this.data.from);
      console.log('   - holding:', this.data.holding);
      console.log('   - holdingAmount:', this.data.holdingAmount);
      
      // 异步加载持仓和行业数据（不阻塞页面显示）
      this.loadAdditionalData();
    } catch (e: any) {
      console.error('加载失败:', e);
      const errorMsg = e.message || '加载失败';
      wx.showToast({ 
        title: errorMsg.length > 20 ? '加载失败，请重试' : errorMsg, 
        icon: 'none',
        duration: 3000
      });
      this.setData({ loading: false });
    }
  },
  
  // 计算扩展数据
  calculateExtendedData(fund: FundInfo, holding: any, allHoldings: any[]) {
    const result: any = {
      dayGrowth: fund.estimatedGrowth || 0,
      yearGrowth: 0, // 异步加载
      fundHeat: 0 // 需要排名API
    };
    
    if (holding) {
      // 持有金额 = 持有份额 × 当前估值
      result.holdingAmount = holding.shares * fund.estimatedValue;
      
      // 持仓占比 = 当前持仓金额 / 总持仓金额
      // 注意：这里使用成本价作为近似值，实际应该获取所有基金的实时估值
      const totalAmount = allHoldings.reduce((sum, h) => {
        return sum + (h.shares * h.cost);
      }, 0);
      result.holdingRatio = totalAmount > 0 ? (result.holdingAmount / totalAmount) * 100 : 0;
      
      // 持有收益 = 持有金额 - 成本金额
      const costAmount = holding.shares * holding.cost;
      result.holdingProfit = result.holdingAmount - costAmount;
      
      // 持有收益率 = 持有收益 / 成本金额 × 100%
      result.holdingProfitRate = costAmount > 0 ? (result.holdingProfit / costAmount) * 100 : 0;
      
      // 持有天数 = 当前日期 - 最早买入日期
      if (holding.buyRecords && holding.buyRecords.length > 0) {
        const firstBuyDate = new Date(holding.buyRecords[0].date);
        const today = new Date();
        result.holdingDays = Math.floor((today.getTime() - firstBuyDate.getTime()) / (1000 * 60 * 60 * 24));
      }
      
      // 昨日收益 = 持有份额 × (今日净值 - 昨日净值)
      // 使用估值增长率来计算昨日净值
      const yesterdayValue = fund.netValue / (1 + fund.estimatedGrowth / 100);
      result.yesterdayProfit = holding.shares * (fund.netValue - yesterdayValue);
      
      // 昨日收益率 = 昨日收益 / 昨日持仓金额 × 100%
      const yesterdayAmount = holding.shares * yesterdayValue;
      result.yesterdayProfitRate = yesterdayAmount > 0 ? (result.yesterdayProfit / yesterdayAmount) * 100 : 0;
    }
    
    return result;
  },
  
  async loadAdditionalData() {
    try {
      const holdingsData = await getFundHoldings(this.data.code);
      console.log('=== 持仓数据详情 ===');
      console.log('完整持仓数据:', JSON.stringify(holdingsData));
      
      if (holdingsData.stocks && holdingsData.stocks.length > 0) {
        console.log('股票列表:', holdingsData.stocks);
        
        // 批量获取股票名称和行情
        const stockCodes = holdingsData.stocks.map((s: any) => s.code).filter((c: string) => c);
        
        if (stockCodes.length > 0) {
          console.log('=== 开始获取股票行情 ===');
          console.log('股票代码列表:', stockCodes);
          
          // 使用股票API批量获取名称和行情
          const stockQuotes = await getBatchStockQuotes(stockCodes);
          
          console.log('=== 股票行情返回结果 ===');
          console.log('返回数量:', stockQuotes.length);
          console.log('详细数据:', JSON.stringify(stockQuotes));
          
          // 更新股票名称和涨跌信息
          holdingsData.stocks.forEach((stock: any, index: number) => {
            const quote = stockQuotes.find((q: any) => q && q.code === stock.code);
            console.log(`股票 ${index + 1} [${stock.code}]:`, {
              原始比例: stock.ratio,
              找到行情: !!quote,
              行情数据: quote
            });
            
            if (quote) {
              stock.name = quote.name || stock.code;
              stock.price = quote.price;
              stock.change = quote.change;
              stock.changePercent = quote.changePercent ? parseFloat(quote.changePercent.toFixed(2)) : 0;
              
              console.log(`  更新后: 名称=${stock.name}, 涨跌幅=${stock.changePercent}%`);
            } else if (!stock.name || stock.name === stock.code) {
              stock.name = stock.code;
            }
          });
          
          console.log('=== 最终股票数据 ===');
          console.log(JSON.stringify(holdingsData.stocks));
        }
        
        this.setData({ 
          holdings: {
            stocks: holdingsData.stocks,
            date: holdingsData.date
          }
        });
        
        console.log('=== setData完成 ===');
        console.log('页面数据:', this.data.holdings);
      }
    } catch (e) {
      console.error('获取持仓数据失败:', e);
    }
    
    try {
      const industryData = await getFundIndustry(this.data.code);
      console.log('行业数据:', industryData);
      if (industryData.industries && industryData.industries.length > 0) {
        this.setData({ industry: industryData });
      }
    } catch (e) {
      console.error('获取行业数据失败:', e);
    }
    
    try {
      const yearGrowth = await getFundYearGrowth(this.data.code);
      console.log('近一年涨幅:', yearGrowth);
      this.setData({ yearGrowth });
    } catch (e) {
      console.error('获取近一年涨幅失败:', e);
    }

    // 基本信息 + 阶段业绩排名（详情补全）
    try {
      const [baseInfo, periods] = await Promise.all([
        getFundBaseInfo(this.data.code),
        getFundPeriodIncrease(this.data.code)
      ]);
      this.setData({ baseInfo, periods });
    } catch (e) {
      console.error('获取基金详情补全失败:', e);
    }
  },

  onPullDownRefresh() {
    this.loadFundDetail().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  showBuyModal() {
    this.setData({ 
      showTradeModal: true, 
      tradeType: 'buy',
      tradeAmount: ''
    });
  },

  showSellModal() {
    if (!this.data.holding) {
      wx.showToast({ title: '暂无持仓', icon: 'none' });
      return;
    }
    this.setData({ 
      showTradeModal: true, 
      tradeType: 'sell',
      tradeAmount: ''
    });
  },

  closeTradeModal() {
    this.setData({ showTradeModal: false });
  },

  stopPropagation() {
    // 阻止事件冒泡，防止点击内容区域时关闭弹窗
  },

  onAmountInput(e: any) {
    this.setData({ tradeAmount: e.detail.value });
  },

  confirmTrade() {
    const { code, tradeType, tradeAmount, fund } = this.data;

    if (!tradeAmount) {
      wx.showToast({ title: '请输入金额', icon: 'none' });
      return;
    }

    const amount = parseFloat(tradeAmount);

    if (isNaN(amount) || amount <= 0) {
      wx.showToast({ title: '金额必须大于0', icon: 'none' });
      return;
    }

    const importedHoldings = getImportedHoldings();
    const raw = importedHoldings.find((h) => h.code === code);
    const today = todayStr();

    try {
      if (tradeType === 'buy') {
        // 买入 = 新增一笔"当日待确认加仓"，确认前不计收益，确认后按当日净值并入
        if (raw) {
          const h = normalizeHolding(raw);
          const pendingAdds = [...(h.pendingAdds || []), { amount, date: today }];
          saveImportedHolding({ ...h, pendingAdds });
        } else {
          // 该基金尚无持仓：新建一只全仓待确认的持仓
          saveImportedHolding({
            code,
            name: fund ? fund.name : code,
            importTime: Date.now(),
            shares: 0,
            cost: 0,
            importNetValue: 0,
            pendingAdds: [{ amount, date: today }],
            amount,
            profit: 0,
            profitRate: 0
          });
          addOptionalFund(code, fund ? fund.name : code);
        }
        wx.showToast({ title: '买入成功（确认中）', icon: 'success' });
      } else {
        // 卖出 = 扣减已确认份额（确认中的部分尚未持有，不能卖）
        if (!raw) {
          wx.showToast({ title: '暂无持仓', icon: 'none' });
          return;
        }
        const h = normalizeHolding(raw);
        const netValue = Number(fund && fund.netValue) || Number(fund && fund.estimatedValue) || 0;
        const shares = Number(h.shares) || 0;
        const confirmedValue = shares * netValue;

        if (netValue <= 0 || shares <= 0) {
          wx.showToast({ title: '暂无可卖出的已确认份额', icon: 'none' });
          return;
        }
        if (amount > confirmedValue + 0.01) {
          wx.showToast({ title: '卖出金额不能超过已确认持有金额', icon: 'none' });
          return;
        }

        const sellShares = Math.min(shares, amount / netValue);
        const newShares = shares - sellShares;
        // 成本单价不变；清仓且无待确认加仓时直接移除
        if (newShares <= 0.000001 && (h.pendingAdds || []).length === 0) {
          removeImportedHolding(code);
        } else {
          saveImportedHolding({ ...h, shares: newShares });
        }
        wx.showToast({ title: '卖出成功', icon: 'success' });
      }

      this.setData({ showTradeModal: false });
      this.loadFundDetail();
    } catch (e) {
      console.error('交易失败:', e);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  deleteHolding() {
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个持仓吗？',
      confirmText: '删除',
      confirmColor: '#ff4444',
      success: (res) => {
        if (res.confirm) {
          // 导入存储函数
          const { getImportedHoldings } = require('../../utils/storage');
          
          // 查找当前持仓
          const importedHoldings = getImportedHoldings();
          const currentHolding = importedHoldings.find((h: any) => h.code === this.data.code);

          if (currentHolding) {
            // 删除导入的持仓
            const { removeImportedHolding } = require('../../utils/storage');
            const success = removeImportedHolding(this.data.code);
            if (success) {
              wx.showToast({ title: '删除成功', icon: 'success' });
              setTimeout(() => {
                wx.navigateBack();
              }, 1500);
            } else {
              wx.showToast({ title: '删除失败', icon: 'none' });
            }
          } else {
            // 删除手动输入的持仓
            const success = removeHolding(this.data.code);
            if (success) {
              wx.showToast({ title: '删除成功', icon: 'success' });
              setTimeout(() => {
                wx.navigateBack();
              }, 1500);
            } else {
              wx.showToast({ title: '删除失败', icon: 'none' });
            }
          }
        }
      }
    });
  },

  // 显示份额类别切换弹窗
  async showShareClassSelector() {
    const { fund } = this.data;
    if (!fund) return;

    wx.showLoading({ title: '搜索中...' });

    try {
      // 提取基金名称（去除份额类别）
      const baseName = fund.name.replace(/[ABC]$/, '');
      const currentShareClass = fund.name.match(/[ABC]$/)?.[0] || '';

      // 导入 searchFund
      const { searchFund } = require('../../utils/fundApi');
      
      // 搜索同名基金的所有份额类别
      const results = await searchFund(baseName);
      
      // 筛选出同一基金的不同份额类别
      const shareClasses = results
        .filter((r: any) => r.name.includes(baseName))
        .map((r: any) => ({
          code: r.code,
          name: r.name,
          shareClass: r.name.match(/[ABC]$/)?.[0] || '无'
        }))
        .filter((item: any, index: number, self: any[]) => 
          // 去重：同一份额类别只保留一个
          index === self.findIndex(t => t.shareClass === item.shareClass)
        );

      wx.hideLoading();

      if (shareClasses.length <= 1) {
        wx.showToast({ 
          title: '该基金无其他份额类别', 
          icon: 'none' 
        });
        return;
      }

      this.setData({
        showShareClassModal: true,
        availableShareClasses: shareClasses,
        currentShareClass: currentShareClass
      });
    } catch (e) {
      console.error('搜索份额类别失败:', e);
      wx.hideLoading();
      wx.showToast({ 
        title: '搜索失败，请重试', 
        icon: 'none' 
      });
    }
  },

  // 关闭份额类别选择弹窗
  closeShareClassModal() {
    this.setData({ showShareClassModal: false });
  },

  // 切换份额类别
  async switchShareClass(e: any) {
    const { code, name } = e.currentTarget.dataset;
    
    wx.showLoading({ title: '切换中...' });

    try {
      // 导入存储函数
      const { getImportedHoldings, saveImportedHoldings, removeImportedHolding } = require('../../utils/storage');
      
      // 查找当前持仓
      const importedHoldings = getImportedHoldings();
      const currentHolding = importedHoldings.find((h: any) => h.code === this.data.code);

      if (currentHolding) {
        // 删除旧的持仓
        removeImportedHolding(this.data.code);

        // 添加新的持仓（保持金额和收益不变）
        const newHolding = {
          code: code,
          name: name,
          amount: currentHolding.amount,
          profit: currentHolding.profit,
          profitRate: currentHolding.profitRate,
          importTime: currentHolding.importTime
        };

        const updatedHoldings = importedHoldings
          .filter((h: any) => h.code !== this.data.code)
          .concat(newHolding);
        
        saveImportedHoldings(updatedHoldings);

        wx.hideLoading();
        wx.showToast({ 
          title: '切换成功', 
          icon: 'success' 
        });

        // 更新当前页面
        this.setData({ 
          code: code,
          showShareClassModal: false 
        });
        this.loadFundDetail();
      } else {
        wx.hideLoading();
        wx.showToast({ 
          title: '仅支持导入的持仓切换', 
          icon: 'none' 
        });
      }
    } catch (e) {
      console.error('切换份额类别失败:', e);
      wx.hideLoading();
      wx.showToast({ 
        title: '切换失败', 
        icon: 'none' 
      });
    }
  }
})
