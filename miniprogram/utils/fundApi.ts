// 基金API工具类 - 接入真实数据
export interface FundInfo {
  code: string;
  name: string;
  type: string;
  netValue: number; // 当日已确认单位净值（dwjz）
  estimatedValue: number; // 估算净值（gsz）
  estimatedGrowth: number; // 估值涨跌（gszzl，%）
  dayGrowth: number; // 与 estimatedGrowth 同源，保留兼容
  updateTime: string; // 估值时间（gztime，例如 "2026-05-09 15:00"），无数据时为空
  valuationDate?: string; // 净值日期（jzrq，例如 "2026-05-09"），无数据时为空
  // 估值来源：official=官方实时估值 gsz；navchg=收盘后按已确认净值涨跌；
  //          computed=前十大重仓自算（近似）；none=无估值（仅净值）
  estimateSource?: 'official' | 'navchg' | 'computed' | 'none';
}

// 市场交易时段状态
export type MarketStatus =
  | 'trading'     // 交易中（09:30-11:30、13:00-15:00）
  | 'lunch'       // 午休（11:30-13:00）
  | 'pre-open'    // 盘前（工作日 00:00-09:30）
  | 'post-close'  // 盘后（工作日 15:00-23:59）
  | 'weekend';    // 周末

// 当前 A 股市场状态（不含节假日，节假日按工作日处理；fundgz 自身在节假日会停止更新）
export function getMarketStatus(now: Date = new Date()): MarketStatus {
  const day = now.getDay(); // 0=周日, 6=周六
  if (day === 0 || day === 6) return 'weekend';
  const minutes = now.getHours() * 60 + now.getMinutes();
  const OPEN_AM = 9 * 60 + 30;   // 09:30
  const CLOSE_AM = 11 * 60 + 30; // 11:30
  const OPEN_PM = 13 * 60;       // 13:00
  const CLOSE_PM = 15 * 60;      // 15:00
  if (minutes < OPEN_AM) return 'pre-open';
  if (minutes < CLOSE_AM) return 'trading';
  if (minutes < OPEN_PM) return 'lunch';
  if (minutes < CLOSE_PM) return 'trading';
  return 'post-close';
}

// 是否处于会持续刷新估值的时段（用于决定是否启动定时刷新）
export function isMarketActive(now: Date = new Date()): boolean {
  return getMarketStatus(now) === 'trading';
}

export interface HoldingInfo {
  code: string;
  name: string;
  shares: number; // 持有份额
  cost: number; // 成本价
  currentValue: number; // 当前净值
  estimatedValue: number; // 估值
  profit: number; // 收益
  profitRate: number; // 收益率
}

// 基金持仓股票信息
export interface StockHolding {
  code: string;        // 股票代码
  name: string;        // 股票名称
  ratio: string;       // 持仓占比（如 "10.23%"）
  shares?: string;     // 持股数量（万股）
  value?: string;      // 持仓市值（万元）
}

// 基金持仓明细
export interface FundHoldingsDetail {
  fundCode: string;
  fundName: string;
  reportDate: string;  // 报告期
  stocks: StockHolding[];
  totalStockRatio?: string; // 股票总占比
}

// 基金实时估值/净值接口
// 原天天基金 JSONP 接口 https://fundgz.1234567.com.cn/js/{code}.js 已下线（永久 301 跳转到东方财富 notfound 页），
// 改用东方财富手机端接口，返回标准 JSON：NAV(净值)/GSZ(实时估值)/GSZZL(估值涨跌)/GZTIME(估值时间)/PDATE(净值日期)。
const FUND_ESTIMATE_API = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo';

// 热门基金列表（备用）
const POPULAR_FUNDS = [
  { code: '110022', name: '易方达消费行业', keywords: ['消费', '易方达', '行业'] },
  { code: '161725', name: '招商中证白酒', keywords: ['白酒', '招商', '酒', '中证'] },
  { code: '320007', name: '诺安成长混合', keywords: ['诺安', '成长', '混合'] },
  { code: '001632', name: '天弘中证电子', keywords: ['电子', '天弘', '科技', '中证'] },
  { code: '110011', name: '易方达中小盘', keywords: ['中小盘', '易方达', '小盘'] },
  { code: '163406', name: '兴全合润分级', keywords: ['兴全', '合润', '分级'] },
  { code: '000961', name: '天弘沪深300ETF联接A', keywords: ['沪深300', '天弘', '指数', '300'] },
  { code: '519674', name: '银河创新成长混合', keywords: ['银河', '创新', '成长'] },
  { code: '001102', name: '前海开源国家比较优势混合', keywords: ['前海', '国家', '优势'] },
  { code: '260108', name: '景顺长城新兴成长混合', keywords: ['景顺', '新兴', '成长', '长城'] },
  { code: '000751', name: '嘉实新兴产业股票', keywords: ['嘉实', '新兴', '产业'] },
  { code: '001410', name: '信达澳银新能源产业股票', keywords: ['新能源', '信达', '能源', '产业'] },
  { code: '005827', name: '易方达蓝筹精选混合', keywords: ['蓝筹', '易方达', '精选'] },
  { code: '003834', name: '华夏能源革新股票', keywords: ['能源', '华夏', '革新'] },
  { code: '001216', name: '易方达新收益混合A', keywords: ['易方达', '收益', '混合'] },
  { code: '000913', name: '农银汇理医疗保健股票', keywords: ['医疗', '医药', '保健', '农银'] },
  { code: '001717', name: '工银瑞信前沿医疗股票', keywords: ['医疗', '医药', '工银', '前沿'] },
  { code: '001475', name: '易方达国防军工混合', keywords: ['军工', '国防', '易方达'] },
  { code: '161028', name: '富国中证新能源汽车指数分级', keywords: ['新能源', '汽车', '富国', '车'] }
];

// 把接口返回的单条记录映射成 FundInfo（单只/批量共用）
// 解析逻辑借鉴开源项目 x2rr/funds（同样以 fundmobapi/FundMNFInfo 为实时估值源）：
//   · 盘中（当日净值尚未公布，PDATE ≠ GZTIME 的日期）→ 用实时估值 GSZ / GSZZL
//   · 收盘后（当日净值已公布，PDATE == GZTIME 的日期）→ 估值即已确认净值 NAV，涨跌用净值涨跌率 NAVCHGRT
function mapFundDatum(d: any): FundInfo {
  const netValue = parseFloat(d.NAV) || 0; // 当日已确认净值(dwjz)
  const pdate = d.PDATE && d.PDATE !== '--' ? d.PDATE : ''; // 净值日期(jzrq)
  const gztime = d.GZTIME || ''; // 估值时间，形如 "2026-07-21 15:00"
  const navchgrt = parseFloat(d.NAVCHGRT); // 已确认净值涨跌率 %

  let estimatedValue: number;
  let estimatedGrowth: number;
  let estimateSource: FundInfo['estimateSource'];

  if (pdate && gztime && pdate === gztime.substr(0, 10)) {
    // 当日净值已公布：盘中估值已失效，直接用净值 + 净值涨跌率
    estimatedValue = netValue;
    estimatedGrowth = isNaN(navchgrt) ? 0 : navchgrt;
    estimateSource = 'navchg';
  } else {
    // 盘中：用官方实时估值 GSZ / GSZZL；缺失（已下线/未生成）时回落净值、涨跌 0，避免虚假盈亏
    const gsz = parseFloat(d.GSZ);
    const gszzl = parseFloat(d.GSZZL);
    if (!isNaN(gsz)) {
      estimatedValue = gsz;
      estimatedGrowth = isNaN(gszzl) ? 0 : gszzl;
      estimateSource = 'official';
    } else {
      estimatedValue = netValue;
      estimatedGrowth = 0;
      estimateSource = 'none'; // 待 getBatchFundEstimate 用重仓自算补上
    }
  }

  return {
    code: d.FCODE,
    name: d.SHORTNAME || '',
    type: getFundType(d.FCODE),
    netValue,
    estimatedValue,
    estimatedGrowth,
    dayGrowth: estimatedGrowth,
    // 真实估值时间戳，缺失时返回空串（不回落到本地时间，避免显示与数据脱钩的假时间）
    updateTime: gztime,
    valuationDate: pdate,
    estimateSource
  };
}

// 底层请求：一次拉取 codes 的估值，返回原始记录数组（接口支持 Fcodes 逗号分隔批量）
function requestFundEstimateRaw(codes: string[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: FUND_ESTIMATE_API,
      method: 'GET',
      data: {
        pageIndex: 1,
        pageSize: codes.length,
        plat: 'Android',
        appType: 'ttjj',
        product: 'EFund',
        Version: 1,
        deviceid: 'wx-miniprogram',
        Fcodes: codes.join(','),
        _: Date.now()
      },
      success: (res: any) => {
        try {
          // 该接口 Content-Type 为 application/json，wx.request 通常已自动解析成对象；
          // 兜底再兼容字符串返回的情况。
          let payload: any = res.data;
          if (typeof payload === 'string') {
            payload = JSON.parse(payload);
          }
          const list = payload && payload.Datas;
          resolve(Array.isArray(list) ? list : []);
        } catch (e) {
          console.error('解析基金估值数据失败:', e);
          reject(e);
        }
      },
      fail: (err) => {
        console.error('请求基金估值数据失败:', err);
        reject(err);
      }
    });
  });
}

// 云函数返回的记录 → FundInfo（云函数已判定 official/navchg/none）
function mapCloudDatum(d: any): FundInfo {
  const netValue = Number(d.netValue) || 0;
  const estimatedValue = Number(d.estimatedValue) || netValue;
  const estimatedGrowth = Number(d.estimatedGrowth) || 0;
  return {
    code: d.code,
    name: d.name || '',
    type: getFundType(d.code),
    netValue,
    estimatedValue,
    estimatedGrowth,
    dayGrowth: estimatedGrowth,
    updateTime: d.updateTime || '',
    valuationDate: d.valuationDate || '',
    estimateSource: d.estimateSource || d.source || 'none'
  };
}

// 经云函数取官方估值（GetFundGZList，最准）；返回 null 表示云函数不可用，由调用方回落直连。
async function getBaseViaCloud(valid: string[]): Promise<FundInfo[] | null> {
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') return null;
  try {
    const res: any = await wx.cloud.callFunction({ name: 'getFund', data: { codes: valid } });
    const r = res && res.result;
    if (r && r.success && Array.isArray(r.data)) {
      return r.data.filter((d: any) => d && d.code).map(mapCloudDatum);
    }
  } catch (e) {
    console.warn('[估值诊断] 云函数不可用，回落直连 fundmobapi:', e);
  }
  return null;
}

// 直连 fundmobapi（云函数不可用时的兜底：仅净值 + navchg 判定，官方 gsz 拿不到）
async function getBaseViaDirect(valid: string[]): Promise<FundInfo[]> {
  const CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < valid.length; i += CHUNK) chunks.push(valid.slice(i, i + CHUNK));
  const settled = await Promise.allSettled(chunks.map((chunk) => requestFundEstimateRaw(chunk)));
  const out: FundInfo[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      for (const d of r.value) {
        if (d && d.FCODE) out.push(mapFundDatum(d));
      }
    }
  }
  return out;
}

// 批量获取基金估值：
//   1) 云函数优先 → 东财官方估值排行 GetFundGZList（含官方 gsz，最准；AkShare 同源）
//   2) 云函数不可用 → 直连 fundmobapi（仅净值）
//   3) 仍无官方估值(source==='none')的基金 → 前十大重仓自算兜底（全覆盖）
export async function getBatchFundEstimate(codes: string[]): Promise<FundInfo[]> {
  const valid = Array.from(new Set(codes.filter((c) => /^\d{6}$/.test(c))));
  if (valid.length === 0) return [];

  const out: FundInfo[] = (await getBaseViaCloud(valid)) || (await getBaseViaDirect(valid));

  // 官方无估值(source==='none')的基金，用前十大重仓自算补上。
  // 不限时段：非交易时段个股为最近收盘价，算出的即"截至最近收盘的估值"，与旧 fundgz 行为一致。
  const needCompute = out.filter((f) => f.estimateSource === 'none' && f.netValue > 0);
  if (needCompute.length > 0) {
    try {
      const estMap = await computeEstimatesForFunds(
        needCompute.map((f) => ({ code: f.code, netValue: f.netValue }))
      );
      for (const f of out) {
        const e = estMap.get(f.code);
        if (e) {
          f.estimatedValue = e.estimatedValue;
          f.estimatedGrowth = e.estimatedGrowth;
          f.dayGrowth = e.estimatedGrowth;
          f.estimateSource = 'computed';
        }
      }
    } catch (e) {
      console.warn('[估值诊断] 自算失败:', e);
    }
  }

  return out;
}

// ===== 自算估值（官方 fundgz 实时估值 gsz 下线后的替代）=====
// 社区通行做法：基金前十大重仓股(占净值比 JZBL) × 个股实时涨跌%，归一化到已披露仓位得到估算涨跌。
// 注意：仅覆盖披露的前十大重仓（股票型基金约占净值 50-70%），是近似值，非官方精确估值。

interface WeightedHolding {
  code: string;
  weight: number; // 占净值比 %
}

// 重仓/资产配置按季度披露，缓存 6 小时，避免每次刷新重复请求
const holdingsCache = new Map<string, { ts: number; holdings: WeightedHolding[] }>();
const stockRatioCache = new Map<string, { ts: number; ratio: number | null }>();
const HOLDINGS_TTL = 6 * 60 * 60 * 1000;

// 上次成功算出的估算涨跌：某轮重仓/行情取数失败时用它兜底，避免估值在刷新/返回时闪没
const estimateCache = new Map<string, { ts: number; estimatedGrowth: number }>();

// 取某基金的股票占净比(%)，用于把"前十大加权涨跌"按真实股票仓位摊分（现金/债券不随股价波动）。
// 数据源：东财资产配置接口(轻量)，季度披露；取不到返回 null（调用方退回不摊分的旧口径）。
function getFundStockRatio(code: string): Promise<number | null> {
  const cached = stockRatioCache.get(code);
  if (cached && Date.now() - cached.ts < HOLDINGS_TTL) {
    return Promise.resolve(cached.ratio);
  }
  return new Promise((resolve) => {
    wx.request({
      url: 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNAssetAllocationNew',
      method: 'GET',
      data: { FCODE: code, deviceid: 'wx', plat: 'Android', product: 'EFund', version: '1', _: Date.now() },
      success: (res: any) => {
        try {
          let p: any = res.data;
          if (typeof p === 'string') p = JSON.parse(p);
          const row = (p && p.Datas && p.Datas[0]) || null;
          const gp = row ? parseFloat(row.GP) : NaN; // GP=股票占净比
          const ratio = !isNaN(gp) && gp > 0 ? Math.min(gp, 100) : null;
          stockRatioCache.set(code, { ts: Date.now(), ratio });
          resolve(ratio);
        } catch (e) {
          resolve(null);
        }
      },
      fail: () => resolve(null)
    });
  });
}

// 取某基金前十大重仓（代码 + 占净值比），带缓存
function getTopHoldingsWeighted(code: string): Promise<WeightedHolding[]> {
  const cached = holdingsCache.get(code);
  if (cached && Date.now() - cached.ts < HOLDINGS_TTL) {
    return Promise.resolve(cached.holdings);
  }
  return new Promise((resolve) => {
    wx.request({
      url: 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition',
      method: 'GET',
      data: { FCODE: code, deviceid: 'wx', plat: 'WAP', product: 'EFund', version: '2.0.0', _: Date.now() },
      success: (res: any) => {
        try {
          let p: any = res.data;
          if (typeof p === 'string') p = JSON.parse(p);
          const stocks = (p && p.Datas && p.Datas.fundStocks) || [];
          const holdings: WeightedHolding[] = [];
          for (const s of stocks.slice(0, 10)) {
            const c = String(s.GPDM || '').trim();
            const w = parseFloat(s.JZBL);
            // 仅取 A 股 6 位代码（港股/美股 push2 行情口径不同，跳过并归一化到 A 股部分）
            if (/^\d{6}$/.test(c) && !isNaN(w) && w > 0) holdings.push({ code: c, weight: w });
          }
          holdingsCache.set(code, { ts: Date.now(), holdings });
          resolve(holdings);
        } catch (e) {
          resolve([]);
        }
      },
      fail: () => resolve([])
    });
  });
}

// 个股行情缓存：20 秒内复用，避免快速刷新/从详情页返回时反复猛打 push2 导致限流。
// 同时保留"上次成功值"：某轮 push2 失败(502/限流)时，用上次的值兜底，估值不会闪没。
const stockChangeCache = new Map<string, { ts: number; chg: number }>();
const STOCK_CHANGE_TTL = 20 * 1000;

// 腾讯行情批量：qt.gtimg.cn 独立于东财，push2 502 时仍可用；只取涨跌%(数字)，GBK 编码不影响解析。
// 与页面里大盘指数(loadMarketIndex)相同的解析方式，已验证可用。
function fetchTencentChanges(codes: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (codes.length === 0) return Promise.resolve(m);
  const toTx = (c: string) => {
    const mkt = c.startsWith('6') || c.startsWith('9') ? 'sh' : c.startsWith('4') || c.startsWith('8') ? 'bj' : 'sz';
    return `s_${mkt}${c}`;
  };
  const CHUNK = 60;
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += CHUNK) chunks.push(codes.slice(i, i + CHUNK));
  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve) => {
          wx.request({
            url: `https://qt.gtimg.cn/q=${chunk.map(toTx).join(',')}`,
            method: 'GET',
            success: (res: any) => {
              try {
                const text = typeof res.data === 'string' ? res.data : '';
                // v_s_sh600519="1~名称~600519~价~涨跌额~涨跌%~..."  取代码(6位)与涨跌%(索引5)
                const re = /v_s_[a-z]{2}(\d{6})="([^"]*)"/g;
                let mm: RegExpExecArray | null;
                while ((mm = re.exec(text)) !== null) {
                  const parts = mm[2].split('~');
                  const chg = parseFloat(parts[5]);
                  if (Number.isFinite(chg)) m.set(mm[1], chg);
                }
              } catch (e) {
                /* 忽略该批 */
              }
              resolve();
            },
            fail: () => resolve()
          });
        })
    )
  ).then(() => m);
}

// push2 批量（兜底，腾讯没取到的再试）：fltt=2 直接为百分比数值
function fetchPush2Changes(codes: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (codes.length === 0) return Promise.resolve(m);
  const toSecid = (c: string) => `${c.startsWith('6') || c.startsWith('9') ? '1' : '0'}.${c}`;
  const CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += CHUNK) chunks.push(codes.slice(i, i + CHUNK));
  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve) => {
          wx.request({
            url: 'https://push2.eastmoney.com/api/qt/ulist.np/get',
            method: 'GET',
            data: { fltt: 2, fields: 'f3,f12', secids: chunk.map(toSecid).join(','), _: Date.now() },
            success: (res: any) => {
              try {
                let p: any = res.data;
                if (typeof p === 'string') p = JSON.parse(p);
                const diff = (p && p.data && p.data.diff) || [];
                for (const d of diff) {
                  const c = String(d.f12 || '');
                  const chg = Number(d.f3);
                  if (c && Number.isFinite(chg)) m.set(c, chg);
                }
              } catch (e) {
                /* 忽略该批 */
              }
              resolve();
            },
            fail: () => resolve()
          });
        })
    )
  ).then(() => m);
}

// 个股实时涨跌%：腾讯主源 + push2 兜底；20s 短缓存复用；某轮全失败时保留上次值，估值不闪没。
async function getBatchStockChangeMap(codes: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const uniq = Array.from(new Set(codes.filter((c) => /^\d{6}$/.test(c))));
  if (uniq.length === 0) return map;

  const now = Date.now();
  const toFetch: string[] = [];
  for (const c of uniq) {
    const hit = stockChangeCache.get(c);
    if (hit) map.set(c, hit.chg); // 先用上次已知值兜底（可能略旧）
    if (!hit || now - hit.ts >= STOCK_CHANGE_TTL) toFetch.push(c); // 过期/没有的才刷新
  }
  if (toFetch.length === 0) return map; // 全部命中新鲜缓存

  // 1) 腾讯主源
  const tx = await fetchTencentChanges(toFetch);
  tx.forEach((chg, c) => {
    map.set(c, chg);
    stockChangeCache.set(c, { ts: Date.now(), chg });
  });
  // 2) 腾讯没取到的，push2 兜底
  const missing = toFetch.filter((c) => !tx.has(c));
  if (missing.length > 0) {
    const p2 = await fetchPush2Changes(missing);
    p2.forEach((chg, c) => {
      map.set(c, chg);
      stockChangeCache.set(c, { ts: Date.now(), chg });
    });
  }
  return map;
}

// 为多只基金自算估值：Map<基金代码, {estimatedValue, estimatedGrowth}>
async function computeEstimatesForFunds(
  items: { code: string; netValue: number }[]
): Promise<Map<string, { estimatedValue: number; estimatedGrowth: number }>> {
  const out = new Map<string, { estimatedValue: number; estimatedGrowth: number }>();
  // 1) 各基金重仓 + 股票占净比（均带缓存，季度数据）
  const [holdingsList, ratioList] = await Promise.all([
    Promise.all(items.map((it) => getTopHoldingsWeighted(it.code))),
    Promise.all(items.map((it) => getFundStockRatio(it.code)))
  ]);
  // 2) 汇总全部个股代码，一次批量取实时行情
  const allStockCodes: string[] = [];
  holdingsList.forEach((hs) => hs.forEach((h) => allStockCodes.push(h.code)));
  const changeMap = await getBatchStockChangeMap(allStockCodes);
  // 3) 逐基金加权：
  //    前十大加权平均涨跌 top10Avg = Σ(占比 × 涨跌) / Σ(占比)
  //    再按股票占净比摊分：估算涨跌 = top10Avg × 股票占净比/100
  //    （现金/债券不随股价波动，取不到股票占比时退回不摊分的旧口径）
  items.forEach((it, i) => {
    const holdings = holdingsList[i];
    let sumW = 0;
    let sumWC = 0;
    for (const h of holdings) {
      const chg = changeMap.get(h.code);
      // 剔除脏报价：A 股单日涨跌上限 30%(北交所)，|涨跌|>30% 必是停牌残值/错误数据；
      //           正常涨停(主板±10 / 创业板·科创板±20 / 北交所±30)均保留。
      if (chg == null || !Number.isFinite(chg) || Math.abs(chg) > 30) continue;
      sumW += h.weight;
      sumWC += h.weight * chg;
    }
    if (sumW > 0) {
      const top10Avg = sumWC / sumW;
      const stockRatio = ratioList[i];
      const estimatedGrowth = stockRatio != null ? top10Avg * (stockRatio / 100) : top10Avg;
      const estimatedValue = it.netValue * (1 + estimatedGrowth / 100);
      out.set(it.code, { estimatedValue, estimatedGrowth });
      estimateCache.set(it.code, { ts: Date.now(), estimatedGrowth });
    } else {
      // 这轮没算出（重仓或行情都没取到）：用上次成功的估值兜底，避免估值闪没
      const cached = estimateCache.get(it.code);
      if (cached) {
        out.set(it.code, {
          estimatedValue: it.netValue * (1 + cached.estimatedGrowth / 100),
          estimatedGrowth: cached.estimatedGrowth
        });
      }
    }
  });
  return out;
}

// 获取单只基金实时估值数据（复用批量逻辑）
export async function getFundEstimate(code: string): Promise<FundInfo> {
  const list = await getBatchFundEstimate([code]);
  const info = list.find((x) => x.code === code) || list[0];
  if (!info) {
    throw new Error('数据格式错误：无估值数据');
  }
  return info;
}

// 搜索基金 - 使用天天基金搜索接口
export async function searchFund(keyword: string): Promise<FundInfo[]> {
  // 从基金列表文件中搜索
  return new Promise((resolve, reject) => {
    console.log('开始从基金列表搜索:', keyword);
    
    wx.request({
      url: 'https://fund.eastmoney.com/js/fundcode_search.js',
      method: 'GET',
      success: async (res: any) => {
        try {
          console.log('基金列表返回数据类型:', typeof res.data);
          
          let dataStr = res.data;
          if (typeof dataStr !== 'string') {
            console.error('返回数据不是字符串');
            resolve([]);
            return;
          }
          
          // 解析 var r = [[...], [...]] 格式
          const match = dataStr.match(/var\s+r\s*=\s*(\[[\s\S]*\]);?/);
          if (!match || !match[1]) {
            console.error('无法解析基金列表数据');
            resolve([]);
            return;
          }
          
          const fundList = JSON.parse(match[1]);
          console.log('基金列表总数:', fundList.length);
          
          // 搜索匹配的基金
          // 格式: ["000001", "HXCZHH", "华夏成长混合", "混合型", "HUAXIACHENGZHANGHUNHE"]
          
          // 蚂蚁财富等渠道的"营销名"经常额外夹带"上证/中证/主题/板/发起式"等修饰词，
          // 而天天基金登记的是简化官方名，二者无法 substring 互含。
          // 这里把所有指数体系/产品形态/策略修饰词作为停用词剥离，再用 token 集合 Jaccard 相似度做模糊匹配。
          const STOP_WORDS = [
            '上证', '深证', '中证', '沪深', '国证', '中信',
            '主题', '板',
            '发起式', '发起', '联接', 'ETF', 'LOF', 'QDII',
            '指数', '增强', '量化',
            '优选', '精选', '价值', '成长',
            '混合', '股票', '债券', '货币', '灵活配置',
            '基金', '型', '开放式', '封闭式'
          ];

          // 份额类别支持 A/B/C/D/E/F/H/I 等多字母
          const extractShareClass = (text: string) => {
            const m = text.trim().match(/[A-Z]+$/);
            return m ? m[0] : '';
          };

          // 强清洗：去份额尾巴、停用词、标点
          const strongClean = (text: string) => {
            let s = text.trim().replace(/[A-Z]+$/, '');
            for (const w of STOP_WORDS) {
              s = s.split(w).join('');
            }
            return s.replace(/[()（）\s\-]/g, '');
          };

          // token 集合：英文/数字段整体保留，中文按单字
          const toTokenSet = (s: string): Set<string> => {
            const set = new Set<string>();
            const en = s.match(/[A-Za-z0-9]+/g) || [];
            for (const t of en) set.add(t.toUpperCase());
            const zh = s.replace(/[A-Za-z0-9]+/g, '');
            for (const ch of zh) {
              if (/[\u4e00-\u9fa5]/.test(ch)) set.add(ch);
            }
            return set;
          };

          const jaccard = (a: Set<string>, b: Set<string>): number => {
            if (a.size === 0 || b.size === 0) return 0;
            let inter = 0;
            a.forEach(x => { if (b.has(x)) inter++; });
            return inter / (a.size + b.size - inter);
          };

          // 基金公司前缀（前 2 字作为硬约束）
          const companyHead = (text: string): string => {
            const m = text.match(/^[\u4e00-\u9fa5]{2,4}/);
            return m ? m[0] : '';
          };

          const keywordCleaned = strongClean(keyword);
          const keywordTokens = toTokenSet(keywordCleaned);
          const shareClass = extractShareClass(keyword);
          const kwCompany2 = companyHead(keyword).slice(0, 2);
          const kwCompany3 = companyHead(keyword).slice(0, 3);

          console.log('搜索关键词:', keyword);
          console.log('清理后关键词:', keywordCleaned);
          console.log('份额类别:', shareClass || '无');

          // 场内 ETF：名字带「ETF」且不带「联接」（ETF联接是场外可申购的，保留）。
          // 这类基金需在交易所买卖，不在本 App 的场外申购范围内，排序时排到场外基金之后。
          const isOnExchangeETF = (name: string) => /ETF/i.test(name) && !name.includes('联接');

          type Scored = { item: any[]; score: number; sim: number; etf: boolean };
          const scored: Scored[] = [];

          for (const item of fundList) {
            const code = item[0];
            const name = item[2];
            const pinyin = item[4];

            // 1. 精确匹配（代码或完整名称）
            if (code === keyword || name === keyword) {
              scored.push({ item, score: 999, sim: 1, etf: isOnExchangeETF(name) });
              continue;
            }
            // 2. 拼音整体一致
            if (pinyin && pinyin.toLowerCase() === keyword.toLowerCase()) {
              scored.push({ item, score: 950, sim: 1, etf: isOnExchangeETF(name) });
              continue;
            }

            // 3. 份额类别硬约束（keyword 有 share，name 也有，必须一致）
            const nameShareClass = extractShareClass(name);
            if (shareClass && nameShareClass && shareClass !== nameShareClass) continue;

            const nameCleaned = strongClean(name);

            // 4. 直接包含关键词 —— 主题/关键字搜索（如「白酒」「半导体」「医疗」）的主路径，
            //    这类词不是公司名，名称不会以它开头，必须靠子串包含命中。
            //    只用原始关键词判断，避免「华夏成长混合」被清洗成「华夏」后误配所有华夏系基金。
            const contains = name.includes(keyword);

            // 5. token 相似度（用于非完全包含的模糊匹配，如营销名 vs 官方简称、带份额后缀的「白酒A」）
            const nameTokens = toTokenSet(nameCleaned);
            const sim = jaccard(keywordTokens, nameTokens);

            // 命中条件：直接包含 或 token 相似度达标
            if (!contains && sim < 0.4) continue;

            let score = sim * 100;
            // 公司前缀一致：仅作为加分项，不再硬过滤（否则「白酒」等主题词会把所有基金排除）
            if (kwCompany2 && name.startsWith(kwCompany2)) score += 5;
            if (kwCompany3 && name.startsWith(kwCompany3)) score += 5;
            if (nameCleaned && (nameCleaned.includes(keywordCleaned) || keywordCleaned.includes(nameCleaned))) score += 10;
            if (shareClass && shareClass === nameShareClass) score += 5;
            // 未指定份额类别时，默认偏向 C 类（场外短期持有最常用）
            if (!shareClass && nameShareClass === 'C') score += 8;
            if (contains) score += 30;

            scored.push({ item, score, sim, etf: isOnExchangeETF(name) });
          }

          // 场外基金一律排在场内 ETF 前面；同组内再按相关度得分排序。
          // 精确匹配（代码/全名一致，score≥900）例外：即便是 ETF 也应优先返回。
          scored.sort((a, b) => {
            const aExact = a.score >= 900, bExact = b.score >= 900;
            if (aExact !== bExact) return aExact ? -1 : 1;
            if (!aExact && a.etf !== b.etf) return a.etf ? 1 : -1;
            return b.score - a.score;
          });
          const matchedFunds = scored.slice(0, 10).map(s => s.item);
          
          // 尝试获取每个基金的详细信息
          const fundInfos = await Promise.allSettled(
            matchedFunds.map((item: any[]) => getFundEstimate(item[0]))
          );
          
          // 处理结果：成功的使用详细信息，失败的使用基本信息
          const results: FundInfo[] = [];
          for (let i = 0; i < fundInfos.length; i++) {
            const result = fundInfos[i];
            const fundData = matchedFunds[i];
            
            if (result.status === 'fulfilled') {
              // 成功获取详细信息
              results.push(result.value);
            } else {
              // 失败时使用基金列表中的基本信息
              console.log(`基金 ${fundData[0]} 获取详情失败，使用基本信息`);
              results.push({
                code: fundData[0],
                name: fundData[2],
                type: fundData[3] || getFundType(fundData[0]),
                netValue: 0,
                estimatedValue: 0,
                estimatedGrowth: 0,
                dayGrowth: 0,
                updateTime: '',
                valuationDate: ''
              });
            }
          }
          
          console.log('最终结果:', results);
          resolve(results);
        } catch (e) {
          console.error('搜索解析错误:', e);
          reject(e);
        }
      },
      fail: (err) => {
        console.error('搜索请求失败:', err);
        reject(err);
      }
    });
  });
}

// 获取基金详细信息（包括历史净值）
export async function getFundDetail(code: string): Promise<any> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `https://api.fund.eastmoney.com/f10/lsjz`,
      method: 'GET',
      data: {
        fundCode: code,
        pageIndex: 1,
        pageSize: 10,
        startDate: '',
        endDate: '',
        _: Date.now()
      },
      success: (res: any) => {
        try {
          resolve(res.data);
        } catch (e) {
          reject(e);
        }
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
}

// 获取某只基金在指定日期的已确认单位净值（用于按申购申请日折算份额）。
// 查不到（非交易日 / 净值未发布 / 接口失败）一律返回 0，调用方据此判定"尚未确认"。
export async function getNetValueByDate(code: string, date: string): Promise<number> {
  if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  return new Promise((resolve) => {
    wx.request({
      url: 'https://api.fund.eastmoney.com/f10/lsjz',
      method: 'GET',
      header: { 'Referer': 'https://fundf10.eastmoney.com/' },
      data: {
        fundCode: code,
        pageIndex: 1,
        pageSize: 10,
        startDate: date,
        endDate: date,
        _: Date.now()
      },
      success: (res: any) => {
        try {
          let data = res.data;
          if (typeof data === 'string') data = JSON.parse(data);
          const list: any[] = (data && data.Data && data.Data.LSJZList) || [];
          const hit = list.find((x) => x.FSRQ === date) || list[0];
          const nav = hit ? parseFloat(hit.DWJZ) : 0;
          resolve(isNaN(nav) ? 0 : nav);
        } catch (e) {
          console.warn('解析历史净值失败:', code, date, e);
          resolve(0);
        }
      },
      fail: (err) => {
        console.warn('查询历史净值失败:', code, date, err);
        resolve(0);
      }
    });
  });
}

// 获取基金近一年涨幅
export async function getFundYearGrowth(code: string): Promise<number> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `https://fund.eastmoney.com/pingzhongdata/${code}.js`,
      method: 'GET',
      success: (res: any) => {
        try {
          const text = res.data;
          // 提取近一年收益率
          const yearGrowthMatch = text.match(/Data_rateInSimilarPersent\s*=\s*"([^"]+)"/);
          if (yearGrowthMatch) {
            const growthStr = yearGrowthMatch[1];
            const growthValue = parseFloat(growthStr);
            resolve(isNaN(growthValue) ? 0 : growthValue);
          } else {
            // 尝试其他可能的字段
            const altMatch = text.match(/syl_1n\s*=\s*"([^"]+)"/);
            if (altMatch) {
              const growthValue = parseFloat(altMatch[1]);
              resolve(isNaN(growthValue) ? 0 : growthValue);
            } else {
              resolve(0);
            }
          }
        } catch (e) {
          console.error('解析近一年涨幅失败:', e);
          resolve(0);
        }
      },
      fail: (err) => {
        console.error('获取近一年涨幅失败:', err);
        resolve(0);
      }
    });
  });
}

// 获取基金持仓信息（重仓股）- 使用JSON API
export async function getFundHoldings(code: string): Promise<FundHoldingsDetail> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `https://fund.eastmoney.com/pingzhongdata/${code}.js`,
      method: 'GET',
      success: (res: any) => {
        try {
          const text = res.data;
          console.log('===== 开始解析持仓数据 =====');
          console.log('原始数据长度:', text.length);
          
          const result: FundHoldingsDetail = {
            fundCode: code,
            fundName: '',
            reportDate: '',
            stocks: []
          };
          
          // 提取基金名称
          const nameMatch = text.match(/var\s+fS_name\s*=\s*["']([^"']+)["']/);
          if (nameMatch) {
            result.fundName = nameMatch[1];
            console.log('基金名称:', result.fundName);
          }
          
          // 提取所有var变量声明（包括数组、对象、字符串等）
          const allVarMatches = text.matchAll(/var\s+(\w+)\s*=\s*([^;]+);/g);
          const varMap = new Map<string, string>();
          
          for (const match of allVarMatches) {
            const varName = match[1];
            const varContent = match[2].trim();
            varMap.set(varName, varContent);
          }
          
          console.log('找到的所有变量:', Array.from(varMap.keys()));
          
          // 查找股票代码数组（优先使用 stockCodesNew，格式更标准）
          let codes: string[] = [];
          let names: string[] = [];
          let ratios: number[] = [];
          
          // 尝试多种可能的变量名（优先使用New版本）
          const codeVarNames = ['stockCodesNew', 'stockCodes', 'stock_codes', 'fundStocks'];
          const ratioVarNames = [
            'stockPercents', 'stockPercentsNew', 'stock_percents', 
            'fundStockPercents', 'stockProportion', 'stockPercent',
            'zycgbl', // 重仓持股比例
            'ccbl', // 持仓比例
            'jjcgbl', // 基金持股比例
            'fundSharesPercentages', // 基金份额百分比
            'stockPercentage', // 股票百分比
            'stockRatio', // 股票比率
            'stockWeight' // 股票权重
          ];
          
          // 查找代码数组
          for (const varName of codeVarNames) {
            if (varMap.has(varName)) {
              try {
                const content = varMap.get(varName)!;
                // 移除开头的 [ 和结尾的 ]
                const arrayContent = content.replace(/^\[/, '').replace(/\]$/, '');
                codes = JSON.parse('[' + arrayContent + ']');
                
                // 如果是带市场标识的格式（如"1.688012"），提取纯代码
                if (codes.length > 0 && typeof codes[0] === 'string' && codes[0].includes('.')) {
                  codes = codes.map(code => {
                    const parts = code.split('.');
                    return parts.length > 1 ? parts[1] : code;
                  });
                  console.log(`✓ 从 ${varName} 解析到 ${codes.length} 个股票代码（已去除市场标识）`);
                } else {
                  console.log(`✓ 从 ${varName} 解析到 ${codes.length} 个股票代码`);
                }
                console.log('前3个代码:', codes.slice(0, 3));
                break;
              } catch (e) {
                console.log(`✗ 解析 ${varName} 失败:`, e);
              }
            }
          }
          
          // 查找比例数组 - 扩展搜索范围
          console.log('=== 开始查找持仓比例数组 ===');
          
          // 首先尝试从 Data_assetAllocation 中提取（这是资产配置数据）
          if (varMap.has('Data_assetAllocation')) {
            try {
              const content = varMap.get('Data_assetAllocation')!;
              console.log('Data_assetAllocation 内容预览:', content.substring(0, 200));
              
              // 这个变量包含股票占净比等信息，但不是单只股票的比例
              // 所以我们跳过它，继续查找其他变量
            } catch (e) {
              console.log('解析 Data_assetAllocation 失败:', e);
            }
          }
          
          // 尝试查找持仓比例数组
          for (const varName of ratioVarNames) {
            console.log(`尝试查找变量: ${varName}, 是否存在: ${varMap.has(varName)}`);
            if (varMap.has(varName)) {
              try {
                const content = varMap.get(varName)!;
                console.log(`${varName} 内容预览:`, content.substring(0, 100));
                // 移除开头的 [ 和结尾的 ]
                const arrayContent = content.replace(/^\[/, '').replace(/\]$/, '');
                ratios = JSON.parse('[' + arrayContent + ']');
                console.log(`✓ 从 ${varName} 解析到 ${ratios.length} 个持仓比例`);
                console.log('前3个比例:', ratios.slice(0, 3));
                break;
              } catch (e) {
                console.log(`✗ 解析 ${varName} 失败:`, e);
              }
            }
          }
          
          // 如果还是没找到，尝试搜索所有包含数字数组的变量
          if (ratios.length === 0) {
            console.log('⚠️ 未找到持仓比例数据，尝试搜索所有数字数组');
            for (const [varName, content] of varMap.entries()) {
              // 跳过已知的非比例变量
              if (varName.includes('Code') || varName.includes('Date') || varName.includes('Time')) {
                continue;
              }
              
              // 检查是否是数字数组（包含逗号分隔的数字）
              if (/^\[[\d.,\s]+\]$/.test(content)) {
                try {
                  const testArray = JSON.parse(content);
                  // 检查是否是合理的比例数据（0-100之间的数字，且数量与股票代码匹配）
                  if (Array.isArray(testArray) && 
                      testArray.length === codes.length &&
                      testArray.every((n: number) => typeof n === 'number' && n >= 0 && n <= 100)) {
                    ratios = testArray;
                    console.log(`✓ 从 ${varName} 推测出 ${ratios.length} 个持仓比例`);
                    console.log('前3个比例:', ratios.slice(0, 3));
                    break;
                  }
                } catch (e) {
                  // 忽略解析失败的变量
                }
              }
            }
          }
          
          if (ratios.length === 0) {
            console.log('⚠️ 仍未找到持仓比例数据');
            console.log('=== 所有变量列表（前30个字符）===');
            let count = 0;
            for (const [varName, content] of varMap.entries()) {
              const preview = content.length > 30 ? content.substring(0, 30) + '...' : content;
              console.log(`${++count}. ${varName} = ${preview}`);
              
              if (count >= 30) {
                console.log('... 还有更多变量，已省略');
                break;
              }
            }
          }
          
          // 组装结果
          if (codes.length > 0) {
            const count = Math.min(codes.length, 10);
            
            console.log('=== 开始组装持仓数据 ===');
            console.log('股票代码数量:', codes.length);
            console.log('持仓比例数量:', ratios.length);
            console.log('持仓比例数据:', ratios);
            
            for (let i = 0; i < count; i++) {
              const stockCode = codes[i] || '';
              const ratio = ratios[i] !== undefined ? ratios[i] : 0;
              
              console.log(`股票 ${i + 1}: 代码=${stockCode}, 比例=${ratio}`);
              
              result.stocks.push({
                code: stockCode,
                name: '', // 暂时为空，后续通过API获取
                ratio: ratio > 0 ? ratio + '%' : '-'
              });
            }
            console.log(`✓ 成功组装 ${result.stocks.length} 条持仓记录`);
            console.log('组装后的数据:', result.stocks);
          } else {
            console.log('✗ 未找到股票代码数据');
          }
          
          // 提取持仓日期
          const dateMatch = text.match(/var\s+stockDate\s*=\s*['"](\d{4}-\d{2}-\d{2})['"]/);
          if (dateMatch) {
            result.reportDate = dateMatch[1];
            console.log('持仓日期:', result.reportDate);
          }
          
          console.log('===== 解析完成 =====');
          resolve(result);
        } catch (e) {
          console.error('解析持仓数据失败:', e);
          resolve({
            fundCode: code,
            fundName: '',
            reportDate: '',
            stocks: []
          });
        }
      },
      fail: (err) => {
        console.error('请求失败:', err);
        reject(err);
      }
    });
  });
}

// 获取完整的基金持仓明细（包括股票名称和实时价格）
export async function getFundHoldingsWithDetails(code: string): Promise<FundHoldingsDetail> {
  try {
    // 1. 获取基础持仓数据
    const holdings = await getFundHoldings(code);
    
    if (holdings.stocks.length === 0) {
      return holdings;
    }
    
    // 2. 批量获取股票名称和价格
    const stockCodes = holdings.stocks.map(s => s.code);
    const stockQuotes = await getBatchStockQuotes(stockCodes);
    
    // 3. 合并数据
    const stockMap = new Map(stockQuotes.map(q => [q.code, q]));
    
    holdings.stocks = holdings.stocks.map(stock => {
      const quote = stockMap.get(stock.code);
      return {
        ...stock,
        name: quote?.name || stock.code
      };
    });
    
    return holdings;
  } catch (e) {
    console.error('获取完整持仓明细失败:', e);
    return {
      fundCode: code,
      fundName: '',
      reportDate: '',
      stocks: []
    };
  }
}

// 获取股票实时行情 - 使用东方财富API（UTF-8编码，无乱码问题）
export async function getStockQuote(code: string): Promise<any> {
  return new Promise((resolve) => {
    const market = (code.startsWith('6') || code.startsWith('688') || code.startsWith('689')) ? '1' : '0';
    const stockCode = `${market}.${code}`;
    
    wx.request({
      url: `https://push2.eastmoney.com/api/qt/stock/get`,
      method: 'GET',
      data: {
        secid: stockCode,
        fields: 'f58,f43,f60,f170', // f58:名称, f43:现价, f60:昨收, f170:涨跌额
        _: Date.now()
      },
      success: (res: any) => {
        try {
          console.log(`东方财富API返回 ${code}:`, JSON.stringify(res.data));
          
          if (!res.data || res.data.rc !== 0 || !res.data.data) {
            console.log(`股票 ${code} 无数据或请求失败`);
            resolve(null);
            return;
          }
          
          const data = res.data.data;
          console.log(`股票 ${code} 原始字段:`, {
            f58: data.f58,
            f43: data.f43,
            f60: data.f60,
            f170: data.f170
          });
          
          const name = data.f58 || code;
          const current = data.f43 ? data.f43 / 100 : 0; // 现价（需要除以100）
          const close = data.f60 ? data.f60 / 100 : 0; // 昨收（需要除以100）
          const change = data.f170 ? data.f170 / 100 : 0; // 涨跌额（需要除以100）
          
          // 自己计算涨跌幅：(现价 - 昨收) / 昨收 * 100
          const changePercent = close > 0 ? ((current - close) / close) * 100 : 0;
          
          console.log(`股票 ${code} 解析结果:`, { 
            name, 
            price: current,
            close: close,
            change,
            changePercent: changePercent.toFixed(2)
          });
          
          resolve({
            code: code,
            name: name,
            price: current,
            change: change,
            changePercent: changePercent
          });
        } catch (e) {
          console.error(`股票 ${code} 解析失败:`, e);
          resolve(null);
        }
      },
      fail: (err) => {
        console.log(`股票 ${code} 请求失败:`, err);
        resolve(null);
      }
    });
  });
}

// 东方财富API（备用）- 已废弃，直接使用 getStockQuote
function getStockQuoteFromEastmoney(code: string): Promise<any> {
  return new Promise((resolve) => {
    const market = (code.startsWith('6') || code.startsWith('688') || code.startsWith('689')) ? '1' : '0';
    const stockCode = `${market}.${code}`;
    
    wx.request({
      url: `https://push2.eastmoney.com/api/qt/stock/get`,
      method: 'GET',
      data: {
        secid: stockCode,
        fields: 'f58,f43,f44,f45,f46,f60,f170,f152',
        _: Date.now()
      },
      success: (res: any) => {
        try {
          console.log(`东方财富API完整返回 ${code}:`, JSON.stringify(res.data));
          
          if (!res.data || !res.data.data) {
            console.log(`股票 ${code} 无数据`);
            resolve(null);
            return;
          }
          
          const data = res.data.data;
          console.log(`股票 ${code} 字段值:`, {
            f58: data.f58,
            f43: data.f43,
            f44: data.f44,
            f45: data.f45,
            f46: data.f46,
            f60: data.f60,
            f170: data.f170,
            f152: data.f152
          });
          
          const name = data.f58 || '';
          const current = data.f43 ? data.f43 / 100 : 0;
          const high = data.f44 ? data.f44 / 100 : 0;
          const low = data.f45 ? data.f45 / 100 : 0;
          const open = data.f46 ? data.f46 / 100 : 0;
          const close = data.f60 ? data.f60 / 100 : 0;
          const change = data.f170 ? data.f170 / 100 : 0;
          const changePercent = data.f152 || 0;
          
          console.log('东方财富API解析结果:', { code, name, price: current, changePercent, change, close });
          
          resolve({
            code: code,
            name: name,
            price: current,
            change: change,
            changePercent: changePercent,
            high: high,
            low: low,
            open: open,
            close: close
          });
        } catch (e) {
          console.error('东方财富API解析失败:', e);
          resolve(null);
        }
      },
      fail: () => {
        console.log(`股票 ${code} 请求失败`);
        resolve(null);
      }
    });
  });
}

// 批量获取股票行情
export async function getBatchStockQuotes(codes: string[]): Promise<any[]> {
  const results = await Promise.allSettled(codes.map(code => getStockQuote(code)));
  return results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}

// 获取基金行业配置 - 使用JSON API
export async function getFundIndustry(code: string): Promise<any> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `https://fund.eastmoney.com/pingzhongdata/${code}.js`,
      method: 'GET',
      success: (res: any) => {
        try {
          const text = res.data;
          console.log('===== 开始解析行业数据 =====');
          
          const result = {
            industries: [] as any[],
            date: ''
          };
          
          // 提取所有var变量声明
          const allVarMatches = text.matchAll(/var\s+(\w+)\s*=\s*\[([^\]]*)\];/g);
          const varMap = new Map<string, string>();
          
          for (const match of allVarMatches) {
            const varName = match[1];
            const varContent = match[2];
            varMap.set(varName, varContent);
          }
          
          console.log('找到的所有数组变量:', Array.from(varMap.keys()));
          
          let names: string[] = [];
          let ratios: number[] = [];
          
          // 尝试多种可能的变量名
          const nameVarNames = ['sectorNames', 'sector_names', 'industryNames', 'industry_names'];
          const ratioVarNames = ['sectorPercents', 'sector_percents', 'industryPercents', 'industry_percents'];
          
          // 查找名称数组
          for (const varName of nameVarNames) {
            if (varMap.has(varName)) {
              try {
                const content = varMap.get(varName)!;
                names = JSON.parse('[' + content + ']');
                console.log(`✓ 从 ${varName} 解析到 ${names.length} 个行业名称`);
                console.log('前3个行业:', names.slice(0, 3));
                break;
              } catch (e) {
                console.log(`✗ 解析 ${varName} 失败:`, e);
              }
            }
          }
          
          // 查找比例数组
          for (const varName of ratioVarNames) {
            if (varMap.has(varName)) {
              try {
                const content = varMap.get(varName)!;
                ratios = JSON.parse('[' + content + ']');
                console.log(`✓ 从 ${varName} 解析到 ${ratios.length} 个行业比例`);
                console.log('前3个比例:', ratios.slice(0, 3));
                break;
              } catch (e) {
                console.log(`✗ 解析 ${varName} 失败:`, e);
              }
            }
          }
          
          // 组装结果
          if (names.length > 0 && ratios.length > 0) {
            const count = Math.min(names.length, ratios.length, 10);
            for (let i = 0; i < count; i++) {
              if (names[i]) {
                result.industries.push({
                  name: names[i],
                  ratio: ratios[i] + '%',
                  value: ''
                });
              }
            }
            console.log(`✓ 成功组装 ${result.industries.length} 条行业记录`);
          } else {
            console.log('✗ 未找到行业数据');
          }
          
          // 提取日期
          const dateMatch = text.match(/var\s+stockDate\s*=\s*['"](\d{4}-\d{2}-\d{2})['"]/);
          if (dateMatch) {
            result.date = dateMatch[1];
            console.log('数据日期:', result.date);
          }
          
          console.log('===== 解析完成 =====');
          resolve(result);
        } catch (e) {
          console.error('解析行业配置失败:', e);
          resolve({ industries: [], date: '' });
        }
      },
      fail: (err) => {
        console.error('请求失败:', err);
        reject(err);
      }
    });
  });
}

// 根据基金代码判断基金类型（简单判断）
function getFundType(code: string): string {
  const firstChar = code.charAt(0);
  switch (firstChar) {
    case '0':
    case '1':
      return '股票型';
    case '2':
      return '债券型';
    case '3':
      return '混合型';
    case '4':
      return '指数型';
    case '5':
      return 'QDII';
    case '6':
      return 'LOF';
    default:
      return '其他';
  }
}
