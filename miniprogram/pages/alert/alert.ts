// 涨跌提醒设置页:一个全局开关 + 涨/跌阈值,对所有持仓生效。
import { getAlertSettings, enableAlert, disableAlert, updateThreshold, isRenewedToday, renewQuota } from '../../utils/alert'

const OPTS = [1, 2, 3, 5, 8, 10];

Page({
  data: {
    enabled: false,
    upPct: 3,
    downPct: 3,
    opts: OPTS,
    upIdx: 2,
    downIdx: 2,
    renewedToday: false,
    busy: false
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    this.setData({ renewedToday: isRenewedToday() });
  },

  refresh() {
    const s = getAlertSettings();
    this.setData({
      enabled: s.enabled,
      upPct: s.upPct,
      downPct: s.downPct,
      upIdx: Math.max(0, OPTS.indexOf(s.upPct)),
      downIdx: Math.max(0, OPTS.indexOf(s.downPct)),
      renewedToday: isRenewedToday()
    });
  },

  // 总开关
  async onToggle(e: any) {
    const on = e.detail.value;
    if (on) {
      this.setData({ busy: true });
      wx.showLoading({ title: '开启中', mask: true });
      const r = await enableAlert(this.data.upPct, this.data.downPct);
      wx.hideLoading();
      this.setData({ busy: false, renewedToday: isRenewedToday() });
      if (r === 'ok') {
        this.setData({ enabled: true });
        wx.showToast({ title: '已开启', icon: 'success' });
      } else if (r === 'rejected') {
        this.setData({ enabled: true });
        wx.showModal({
          title: '设置已保存',
          content: '你本次未授权(或额度已满)。为持续收到提醒,请在授权弹窗勾选「总是保持以上选择」,之后每天进入小程序会自动续订。',
          showCancel: false
        });
      } else {
        this.setData({ enabled: false });
        wx.showToast({ title: '开启失败', icon: 'none' });
      }
    } else {
      this.setData({ enabled: false });
      await disableAlert();
      wx.showToast({ title: '已关闭', icon: 'none' });
    }
  },

  onPickUp(e: any) {
    const i = Number(e.detail.value);
    const v = OPTS[i];
    this.setData({ upIdx: i, upPct: v });
    updateThreshold(v, this.data.downPct);
  },

  onPickDown(e: any) {
    const i = Number(e.detail.value);
    const v = OPTS[i];
    this.setData({ downIdx: i, downPct: v });
    updateThreshold(this.data.upPct, v);
  },

  // 发送测试提醒:从小程序端触发 checkAlerts(有有效 access_token,可真正发送)
  // 「云端测试」控制台无法调用 openapi(-501001),需从小程序或定时触发器触发。
  async onTest() {
    wx.showLoading({ title: '检查中', mask: true });
    try {
      const r: any = await wx.cloud.callFunction({ name: 'checkAlerts', data: { state: 'trial' } });
      wx.hideLoading();
      const res = (r && r.result) || {};
      const d = (res.debug && res.debug[0]) || {};
      let msg = '';
      if (res.sent > 0) msg = '已发送,请查看微信服务通知';
      else if (d.result) msg = `未发送:${d.errMsg || d.skip || d.result}`;
      else if (res.reason) msg = `未发送:${res.reason}`;
      else msg = `sent=${res.sent}`;
      wx.showModal({ title: res.sent > 0 ? '发送成功' : '未发送', content: msg, showCancel: false });
    } catch (e: any) {
      wx.hideLoading();
      wx.showModal({ title: '调用失败', content: (e && e.errMsg) || String(e), showCancel: false });
    }
  },

  // 手动续订今日额度
  async onRenew() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '续订中', mask: true });
    const ok = await renewQuota();
    wx.hideLoading();
    this.setData({ busy: false, renewedToday: isRenewedToday() });
    wx.showToast({ title: ok ? '今日已续订' : '未授权', icon: ok ? 'success' : 'none' });
  }
})
