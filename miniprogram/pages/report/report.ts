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
      if (!report) {
        wx.showToast({ title: '报告不存在', icon: 'none' });
      } else if (report.status !== 'ok' || !report.content) {
        // 失败报告无正文,拦截进入详情,避免渲染空白/无意义内容
        wx.showToast({ title: '该报告生成失败，请重新生成', icon: 'none' });
      } else {
        const nodes = parseMarkdown(report.content).map((n, i) => ({
          ...n, idx: i, spans: n.spans.map((sp, j) => ({ ...sp, idx: j }))
        }));
        this.setData({ detail: report, nodes });
      }
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
      wx.showToast({ title: '生成较慢，正在后台完成…', icon: 'none' });
      // 端侧超时不代表服务端失败:云函数常在后台跑完(约30-45s)并已落库成功。
      // 多次轮询捞取当日已生成好的报告(而非只捞一次3s),捞到 ok 就自动打开。
      this.pollForTodayReport(6);
    }
    this.setData({ generating: false });
  },

  // 生成后端侧超时的兜底:每 8s 轮询一次列表,发现当日 ok 报告即自动打开;最多 tries 次
  pollForTodayReport(tries: number) {
    if (tries <= 0) return;
    setTimeout(async () => {
      await this.loadList();
      const top = this.data.list[0];
      if (top && top.status === 'ok') {
        this.openDetail({ currentTarget: { dataset: { id: top._id } } });
      } else {
        this.pollForTodayReport(tries - 1);
      }
    }, 8000);
  },

  async onSubscribe() {
    const ok = await grantReportQuota();
    wx.showToast({ title: ok ? '已订阅，今晚21点推送' : '未授权', icon: 'none' });
  }
});
