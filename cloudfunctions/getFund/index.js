// 云函数：获取基金实时估值
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const { code } = event;
  
  try {
    // 使用云函数的HTTP能力请求外部API
    const result = await cloud.openapi.httpclient.request({
      url: `https://fundgz.1234567.com.cn/js/${code}.js`,
      method: 'GET'
    });
    
    // 解析JSONP数据
    const jsonStr = result.data.match(/jsonpgz\((.*)\)/)?.[1];
    if (!jsonStr) {
      return { success: false, error: '数据格式错误' };
    }
    
    const data = JSON.parse(jsonStr);
    return {
      success: true,
      data: {
        code: data.fundcode,
        name: data.name,
        netValue: parseFloat(data.dwjz) || 0,
        estimatedValue: parseFloat(data.gsz) || 0,
        estimatedGrowth: parseFloat(data.gszzl) || 0,
        updateTime: data.gztime
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};
