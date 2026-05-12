// API配置文件
export const API_CONFIG = {
  // 天天基金实时估值接口
  FUND_ESTIMATE: 'https://fundgz.1234567.com.cn/js/',
  
  // 天天基金搜索接口
  FUND_SEARCH: 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx',
  
  // 东方财富基金详情接口
  FUND_DETAIL: 'https://api.fund.eastmoney.com/f10/lsjz',
  
  // 基金排行榜接口
  FUND_RANK: 'https://fund.eastmoney.com/data/rankhandler.aspx'
};

// 请求域名白名单（需要在小程序后台配置）
export const REQUEST_DOMAINS = [
  'https://fundgz.1234567.com.cn',
  'https://fundsuggest.eastmoney.com',
  'https://api.fund.eastmoney.com',
  'https://fund.eastmoney.com'
];
