// 云函数：获取基金官方实时估值（+ 净值），跑在腾讯云国内节点，外网请求不受小程序合法域名限制。
// 数据源：东方财富官方估值排行 GetFundGZList（AkShare fund_value_estimation_em 同源），内含官方 gsz/gszzl。
// 该接口只能拉全量排行(约 2.4 万只、~7MB)、不支持按代码查，故在云函数里【拉一次、缓存 2 分钟、按代码返回】。
// 官方估值表未收录的基金(部分 LOF/特定基金) → 返回 source:'none'，由小程序端用"前十大重仓自算"兜底。
const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, ...headers }, timeout: 25000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ===== 官方估值排行缓存（warm 实例全局，TTL 2 分钟）=====
let gzCache = { ts: 0, map: null, gzrq: '' };
const GZ_TTL = 2 * 60 * 1000;

async function loadOfficialGZ() {
  if (gzCache.map && Date.now() - gzCache.ts < GZ_TTL) return gzCache;
  const url =
    'https://api.fund.eastmoney.com/FundGuZhi/GetFundGZList' +
    '?type=1&sort=3&orderType=desc&canbuy=0&pageIndex=1&pageSize=30000';
  const r = await httpGet(url, { Referer: 'https://fund.eastmoney.com/' });
  const j = JSON.parse(r.body);
  const list = (j && j.Data && j.Data.list) || [];
  const map = Object.create(null);
  for (const it of list) {
    map[it.bzdm] = { name: it.jjjc, gsz: it.gsz, gszzl: it.gszzl, dwjz: it.dwjz };
  }
  gzCache = { ts: Date.now(), map, gzrq: (j.Data && j.Data.gzrq) || '' };
  return gzCache;
}

// FundMNFInfo 取净值 + 净值日期/估值时间/净值涨跌率（官方估值表没有的基金用它兜底净值与"收盘已出净值"判定）
async function loadNav(codes) {
  const url =
    'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo' +
    `?pageIndex=1&pageSize=${codes.length}&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=cf&Fcodes=${codes.join(',')}`;
  const r = await httpGet(url);
  const j = JSON.parse(r.body);
  const list = (j && j.Datas) || [];
  const map = Object.create(null);
  for (const d of list) {
    if (d && d.FCODE) map[d.FCODE] = d;
  }
  return map;
}

exports.main = async (event) => {
  const raw = Array.isArray(event.codes) ? event.codes : event.code ? [event.code] : [];
  const valid = Array.from(new Set(raw.filter((c) => /^\d{6}$/.test(c))));
  if (valid.length === 0) return { success: false, error: '无有效基金代码' };

  let gz = { map: Object.create(null), gzrq: '' };
  try {
    gz = await loadOfficialGZ();
  } catch (e) {
    /* 官方表失败：全部走净值/自算兜底 */
  }
  let navMap = Object.create(null);
  try {
    navMap = await loadNav(valid);
  } catch (e) {
    /* 忽略 */
  }

  const data = [];
  let officialCount = 0;
  for (const code of valid) {
    const o = gz.map[code];
    const nav = navMap[code] || {};
    const netValue = parseFloat(nav.NAV != null ? nav.NAV : o && o.dwjz) || 0;
    const pdate = nav.PDATE && nav.PDATE !== '--' ? nav.PDATE : '';
    const navChg = parseFloat(nav.NAVCHGRT); // 已确认净值涨跌率（对应 pdate），供准确度对比
    const navChgRt = isNaN(navChg) ? null : navChg;

    if (o && o.gsz && o.gsz !== '---' && o.gsz !== '') {
      // 官方实时估值（最准）
      const gsz = parseFloat(o.gsz) || 0;
      const gszzl = parseFloat(String(o.gszzl).replace('%', '')) || 0;
      data.push({
        code,
        name: o.name || nav.SHORTNAME || '',
        netValue,
        estimatedValue: gsz,
        estimatedGrowth: gszzl,
        updateTime: nav.GZTIME || '', // 用估值时间戳(HH:mm)，不用 gzrq 日期，避免状态栏把日期当时间
        valuationDate: pdate,
        source: 'official',
        navChgRt
      });
      officialCount++;
    } else if (pdate && nav.GZTIME && pdate === String(nav.GZTIME).substr(0, 10)) {
      // 当日净值已公布：用净值 + 净值涨跌率
      const chg = parseFloat(nav.NAVCHGRT);
      data.push({
        code,
        name: nav.SHORTNAME || '',
        netValue,
        estimatedValue: netValue,
        estimatedGrowth: isNaN(chg) ? 0 : chg,
        updateTime: nav.GZTIME || '',
        valuationDate: pdate,
        source: 'navchg',
        navChgRt
      });
    } else {
      // 官方无估值、当日净值未出 → 交给客户端自算
      data.push({
        code,
        name: nav.SHORTNAME || '',
        netValue,
        estimatedValue: netValue,
        estimatedGrowth: 0,
        updateTime: nav.GZTIME || '',
        valuationDate: pdate,
        source: 'none',
        navChgRt
      });
    }
  }

  return { success: true, data, diag: { gzrq: gz.gzrq, official: officialCount, total: valid.length } };
};
