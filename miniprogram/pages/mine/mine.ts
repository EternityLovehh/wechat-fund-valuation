// mine.ts - 「我的」聚合页：分析/工具/数据入口
import { clearHistoryData } from '../../utils/history'

// 随机好听的默认昵称（首次进入生成并保存，保持稳定）
const NICK_ADJ = ['稳健', '从容', '长期', '价值', '理性', '佛系', '淡定', '乐观', '聪明', '勤劳', '复利', '元气', '招财', '常胜', '踏实'];
const NICK_NOUN = ['养基人', '投资家', '定投君', '理财师', '持有人', '小基民', '布局家', '收益官', '行者', '船长'];
function randomNickname(): string {
  const a = NICK_ADJ[Math.floor(Math.random() * NICK_ADJ.length)];
  const n = NICK_NOUN[Math.floor(Math.random() * NICK_NOUN.length)];
  return a + '的' + n;
}

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
    // 首次无昵称：生成一个随机好听的名字并保存，保持稳定
    if (!name) {
      name = randomNickname();
      try { wx.setStorageSync('mine_nickname', name); } catch (e) { /* ignore */ }
    }
    this.setData({ nickname: name, avatarUrl: avatar || '' });
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
          const name = String(r.content || '').trim() || randomNickname();
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
