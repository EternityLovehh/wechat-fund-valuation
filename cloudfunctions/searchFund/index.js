// 云函数：搜索基金
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const { keyword } = event;
  
  try {
    // 搜索基金
    const searchResult = await cloud.openapi.httpclient.request({
      url: `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(keyword)}`,
      method: 'GET'
    });
    
    const searchData = JSON.parse(searchResult.data);
    if (!searchData.Datas || searchData.Datas.length === 0) {
      return { success: true, data: [] };
    }
    
    // 解析基金列表
    const funds = searchData.Datas.slice(0, 10).map(item => {
      const parts = item.split(',');
      return { code: parts[0], name: parts[1] };
    });
    
    // 获取每个基金的实时估值
    const fundDetails = await Promise.all(
      funds.map(async (fund) => {
        try {
          const result = await cloud.openapi.httpclient.request({
            url: `https://fundgz.1234567.com.cn/js/${fund.code}.js`,
            method: 'GET'
          });
          
          const jsonStr = result.data.match(/jsonpgz\((.*)\)/)?.[1];
          if (!jsonStr) return null;
          
          const data = JSON.parse(jsonStr);
          return {
            code: data.fundcode,
            name: data.name,
            netValue: parseFloat(data.dwjz) || 0,
            estimatedValue: parseFloat(data.gsz) || 0,
            estimatedGrowth: parseFloat(data.gszzl) || 0,
            updateTime: data.gztime
          };
        } catch (e) {
          return null;
        }
      })
    );
    
    return {
      success: true,
      data: fundDetails.filter(f => f !== null)
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};
