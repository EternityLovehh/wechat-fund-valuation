// mine.ts - 「我的」聚合页：分析/工具/数据入口
import { clearHistoryData } from '../../utils/history'

Page({
  data: {
    version: '1.0.0'
  },

  goCalendar() {
    wx.navigateTo({ url: '/pages/calendar/calendar' });
  },
  goPenetration() {
    wx.navigateTo({ url: '/pages/penetration/penetration' });
  },
  goCompare() {
    wx.showToast({ title: '开发中', icon: 'none' });
  },
  goRank() {
    wx.showToast({ title: '开发中', icon: 'none' });
  },
  goCalc() {
    wx.showToast({ title: '开发中', icon: 'none' });
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
