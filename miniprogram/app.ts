// app.ts
App<IAppOption>({
  globalData: {},
  onLaunch() {
    // 初始化云开发（OCR功能需要）
    if (wx.cloud) {
      try {
        wx.cloud.init({
          env: 'cloud1-9g4p2wbp92515484', // 云环境ID
          traceUser: true
        });
        console.log('云开发初始化成功');
      } catch (e) {
        console.error('云开发初始化失败，OCR功能将不可用:', e);
      }
    } else {
      console.warn('当前基础库不支持云开发');
    }
    
    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)
  },
})