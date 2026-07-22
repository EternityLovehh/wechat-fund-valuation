// news.ts - 市场要闻（财经快讯，内联展示）
import { getMarketNews, NewsItem } from '../../utils/fundApi'

Page({
  data: {
    list: [] as NewsItem[],
    loading: true,
    refreshing: false
  },

  onLoad() { this.load(); },

  async load() {
    this.setData({ loading: this.data.list.length === 0 });
    const list = await getMarketNews(30);
    this.setData({ list, loading: false });
  },

  async onRefresh() {
    this.setData({ refreshing: true });
    await this.load();
    this.setData({ refreshing: false });
  }
})
