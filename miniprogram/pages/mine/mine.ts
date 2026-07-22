// mine.ts - 「我的」聚合页：分析/工具/数据入口
import { clearHistoryData } from '../../utils/history'

Page({
  data: {
    version: '1.0.0',
    nickname: '基金投资者',
    avatarUrl: ''
  },

  onShow() {
    let name = '';
    let avatar = '';
    try { name = wx.getStorageSync('mine_nickname'); } catch (e) { /* ignore */ }
    try { avatar = wx.getStorageSync('mine_avatar'); } catch (e) { /* ignore */ }
    this.setData({ nickname: name || '基金投资者', avatarUrl: avatar || '' });
  },

  // 微信头像选择（open-type=chooseAvatar）；存到本地持久路径
  onChooseAvatar(e: any) {
    const tmp = e && e.detail && e.detail.avatarUrl;
    if (!tmp) return;
    let saved = tmp;
    try {
      saved = wx.getFileSystemManager().saveFileSync(tmp);
    } catch (err) {
      saved = tmp; // 持久化失败则退回临时路径
    }
    this.setData({ avatarUrl: saved });
    try { wx.setStorageSync('mine_avatar', saved); } catch (err) { /* ignore */ }
  },

  // 头像加载失败(缓存被清)时回退默认
  onAvatarError() {
    this.setData({ avatarUrl: '' });
    try { wx.removeStorageSync('mine_avatar'); } catch (e) { /* ignore */ }
  },

  editName() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      content: this.data.nickname,
      placeholderText: '输入昵称',
      success: (r: any) => {
        if (r.confirm) {
          const name = String(r.content || '').trim() || '基金投资者';
          this.setData({ nickname: name });
          try { wx.setStorageSync('mine_nickname', name); } catch (e) { /* ignore */ }
        }
      }
    });
  },

  goCalendar() {
    wx.navigateTo({ url: '/pages/calendar/calendar' });
  },
  goPenetration() {
    wx.navigateTo({ url: '/pages/penetration/penetration' });
  },
  goCompare() {
    wx.navigateTo({ url: '/pages/compare/compare' });
  },
  goRank() {
    wx.navigateTo({ url: '/pages/rank/rank' });
  },
  goCalc() {
    wx.navigateTo({ url: '/pages/calc/calc' });
  },
  goNews() {
    wx.navigateTo({ url: '/pages/news/news' });
  },

  clearData() {
    wx.showModal({
      title: '清空统计数据',
      content: '将清空总资产走势、收益日历、估值准确度的历史记录（不影响自选与持仓）。确定？',
      confirmText: '清空',
      confirmColor: '#ff4444',
      success: (res) => {
        if (res.confirm) {
          clearHistoryData();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
})
