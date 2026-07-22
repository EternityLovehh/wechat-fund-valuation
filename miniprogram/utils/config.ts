// API配置文件
export const API_CONFIG = {
  // 基金实时估值/净值接口（原 fundgz.1234567.com.cn JSONP 接口已下线，改用东方财富手机端 JSON 接口）
  FUND_ESTIMATE: 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo',

  // 天天基金搜索接口
  FUND_SEARCH: 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx',
  
  // 东方财富基金详情接口
  FUND_DETAIL: 'https://api.fund.eastmoney.com/f10/lsjz',
  
  // 基金排行榜接口
  FUND_RANK: 'https://fund.eastmoney.com/data/rankhandler.aspx'
};

// 请求域名白名单（需要在小程序后台「开发管理 → 服务器域名 → request 合法域名」中配置）
export const REQUEST_DOMAINS = [
  'https://fundmobapi.eastmoney.com', // 实时估值/净值（替代已下线的 fundgz.1234567.com.cn）
  'https://api.fund.eastmoney.com',   // 历史净值 lsjz
  'https://fund.eastmoney.com',       // 搜索列表 / 持仓明细 pingzhongdata
  'https://push2.eastmoney.com',      // 持仓股票实时行情
  'https://qt.gtimg.cn',              // 大盘指数 / 个股行情
  'https://newsapi.eastmoney.com'    // 市场要闻(财经快讯)
];
