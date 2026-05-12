// search.ts - 搜索基金页面
import { searchFund, FundInfo } from '../../utils/fundApi'
import { addOptionalFund, getOptionalFunds } from '../../utils/storage'

Page({
  data: {
    keyword: '',
    results: [] as FundInfo[],
    searching: false,
    optionalCodes: [] as string[]
  },

  searchTimer: null as any,

  onLoad() {
    const optionalFunds = getOptionalFunds();
    this.setData({
      optionalCodes: optionalFunds ? optionalFunds.map(f => f.code).filter(code => code) : []
    });
  },

  onInput(e: any) {
    const keyword = e.detail.value;
    this.setData({ keyword });

    // 清除之前的定时器
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }

    // 如果输入为空，清空结果
    if (!keyword.trim()) {
      this.setData({ results: [], searching: false });
      return;
    }

    // 防抖：500ms后执行搜索
    this.searchTimer = setTimeout(() => {
      this.performSearch(keyword);
    }, 500);
  },

  async performSearch(keyword: string) {
    if (!keyword.trim()) return;

    this.setData({ searching: true });
    try {
      console.log('开始搜索:', keyword);
      const results = await searchFund(keyword);
      console.log('搜索结果:', results);
      
      // 过滤掉没有 code 的结果
      const validResults = results.filter(item => item && item.code);
      console.log('有效结果数量:', validResults.length);
      
      this.setData({ results: validResults, searching: false });
    } catch (e: any) {
      console.error('搜索失败:', e);
      this.setData({ searching: false, results: [] });
    }
  },

  async onSearch() {
    const { keyword } = this.data;
    if (!keyword.trim()) {
      wx.showToast({ title: '请输入关键词', icon: 'none' });
      return;
    }

    // 清除定时器，立即搜索
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }

    await this.performSearch(keyword);
  },

  clearKeyword() {
    this.setData({ keyword: '', results: [] });
  },

  addToOptional(e: any) {
    const { code, name } = e.currentTarget.dataset;
    
    if (!code) {
      wx.showToast({ title: '基金代码无效', icon: 'none' });
      return;
    }
    
    const success = addOptionalFund(code, name);
    
    if (success) {
      wx.showToast({ title: '已添加', icon: 'success' });
      const optionalFunds = getOptionalFunds();
      this.setData({
        optionalCodes: optionalFunds ? optionalFunds.map(f => f.code).filter(c => c) : []
      });
    } else {
      wx.showToast({ title: '已在自选中', icon: 'none' });
    }
  },

  goToDetail(e: any) {
    const { code } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/detail/detail?code=${code}` });
  },

  // 快速搜索
  quickSearch(e: any) {
    const keyword = e.currentTarget.dataset.keyword;
    this.setData({ keyword });
    this.performSearch(keyword);
  }
})
