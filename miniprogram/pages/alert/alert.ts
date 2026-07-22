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
