// miniprogram/pages/report/report.ts
// AI 复盘:列表(fund_reports 元信息) + 详情(markdown渲染) + 立即生成 + 订阅每日推送。
import { parseMarkdown, MdNode } from '../../utils/mdRender'
import { collectUnifiedHoldings } from '../../utils/reportSync'
import { grantReportQuota } from '../../utils/alert'

Page({
  data: {
    list: [] as any[], loading: false, generating: false,
    detail: null as any, nodes: [] as MdNode[]
  },
  onLoad() { this.loadList(); },
  onPullDownRefresh() { this.loadList().then(() => wx.stopPullDownRefresh()); },

  async loadList() {
    this.setData({ loading: true });
    try {
      const r: any = await wx.cloud.callFunction({ name: 'aiReport', data: { action: 'list' } });
      this.setData({ list: (r.result && r.result.list) || [] });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  async openDetail(e: any) {
    const id = e.currentTarget.dataset.id;
    wx.showLoading({ title: '加载中' });
    try {
      const r: any = await wx.cloud.callFunction({ name: 'aiReport', data: { action: 'get', id } });
      const report = r.result && r.result.report;
      if (report) this.setData({ detail: report, nodes: parseMarkdown(report.content) });
      else wx.showToast({ title: '报告不存在', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    wx.hideLoading();
  },
  closeDetail() { this.setData({ detail: null, nodes: [] }); },

  async onGenerate() {
    const holdings = collectUnifiedHoldings();
    if (!holdings.length) { wx.showToast({ title: '请先在持仓页添加持仓', icon: 'none' }); return; }
    this.setData({ generating: true });
    wx.showLoading({ title: '生成中，约需30秒', mask: true });
    try {
      const r: any = await wx.cloud.callFunction({ name: 'aiReport', data: { holdings } });
      wx.hideLoading();
      if (r.result && r.result.success) {
        await this.loadList();
        if (this.data.list.length) this.openDetail({ currentTarget: { dataset: { id: this.data.list[0]._id } } });
      } else {
        wx.showToast({ title: (r.result && r.result.error) || '生成失败，稍后再试', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '生成超时或失败', icon: 'none' });
    }
    this.setData({ generating: false });
  },

  async onSubscribe() {
    const ok = await grantReportQuota();
    wx.showToast({ title: ok ? '已订阅，今晚21点推送' : '未授权', icon: 'none' });
  }
});
