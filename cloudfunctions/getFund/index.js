// 云函数：获取基金官方实时估值（+ 净值），跑在腾讯云国内节点，外网请求不受小程序合法域名限制。
// 数据源：东方财富官方估值排行 GetFundGZList（AkShare fund_value_estimation_em 同源），内含官方 gsz/gszzl。
// ⚠️ 2026-07 监管收紧后 GetFundGZList 已下架（恒返回"暂无数据"），此处保留探测以防恢复；
//    当前实际主路径：FundMNFInfo 出名称/净值/净值涨跌率 → 小程序端"前十大重仓自算"出盘中估值。
//    FundMNFInfo 对数据中心 IP 有随机风控(61136403)，故带重试；两上游全空则返回失败，端上回落直连。
// 该接口只能拉全量排行(约 2.4 万只、~7MB)、不支持按代码查，故在云函数里【拉一次、缓存 2 分钟、按代码返回】。
// 官方估值表未收录的基金(部分 LOF/特定基金) → 返回 source:'none'，由小程序端用"前十大重仓自算"兜底。
const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ⚠️ 不要伪装浏览器 UA：东财风控会拦截"自称 Chrome 但请求特征不符"的客户端(61136403 网络繁忙)，
//    node 不带 UA 反而全部放行（fundmobapi / rankhandler 实测均通过，rankhandler 只校验 Referer）。
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { ...headers }, timeout: 25000 }, (res) => {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// FundMNFInfo 取净值 + 净值日期/估值时间/净值涨跌率（官方估值表没有的基金用它兜底净值与"收盘已出净值"判定）
async function loadNav(codes) {
  // deviceid 每次随机：东财风控按 deviceid+IP 维度阵发拦截(61136403)，固定值更易被持续命中
  const deviceid = Math.random().toString(36).slice(2, 12);
  const url =
    'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo' +
    `?pageIndex=1&pageSize=${codes.length}&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=${deviceid}&Fcodes=${codes.join(',')}`;
  const r = await httpGet(url);
  const j = JSON.parse(r.body);
  const list = (j && j.Datas) || [];
  const map = Object.create(null);
  for (const d of list) {
    if (d && d.FCODE) map[d.FCODE] = d;
  }
  return map;
}

// 东财风控(ErrCode 61136403 "网络繁忙")对数据中心 IP 拦截率高且随机，重试可显著提高命中
async function loadNavWithRetry(codes, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const m = await loadNav(codes);
      if (Object.keys(m).length > 0) return m;
    } catch (e) {
      /* 重试 */
    }
    if (i < tries - 1) await sleep(400 * (i + 1));
  }
  return Object.create(null);
}

// 基金排行：web rankhandler 需东财 Referer(小程序端设不了)，故经云函数中转。
// sc→CSV 列索引：日6 / 周7 / 月8 / 3月9 / 6月10 / 1年11 / 今年14；code0 name1 nav4
const RANK_SC_INDEX = { rzf: 6, '1yzf': 8, '3yzf': 9, '1nzf': 11, jnzf: 14 };
async function loadRank(ft, sc, pn) {
  const url =
    'https://fund.eastmoney.com/data/rankhandler.aspx' +
    `?op=ph&dt=kf&ft=${ft}&rs=&gs=0&sc=${sc}&st=desc&pi=1&pn=${pn}&dx=1`;
  const r = await httpGet(url, { Referer: 'https://fund.eastmoney.com/data/fundranking.html' });
  const m = String(r.body || '').match(/datas:(\[[\s\S]*?\])/);
  if (!m) return [];
  const arr = JSON.parse(m[1]);
  const idx = RANK_SC_INDEX[sc] != null ? RANK_SC_INDEX[sc] : 11;
  return arr
    .map((s) => {
      const p = String(s).split(',');
      return { code: p[0], name: p[1], nav: parseFloat(p[4]) || 0, ret: parseFloat(p[idx]) || 0 };
    })
    .filter((x) => /^\d{6}$/.test(x.code));
}

exports.main = async (event) => {
  // 排行模式
  if (event.rank) {
    try {
      const { ft, sc, pn } = event.rank;
      const list = await loadRank(ft || 'all', sc || '1nzf', pn || 30);
      return { success: true, rank: list };
    } catch (e) {
      return { success: false, error: (e && e.message) || String(e) };
    }
  }

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
  navMap = await loadNavWithRetry(valid);

  // 两个上游全空（估值排行已下架 + 净值接口被风控）时不能返回"成功的空壳"，
  // 必须报失败，让小程序端回落直连 fundmobapi（住宅 IP 通常不被拦）。
  const gzEmpty = !gz.map || Object.keys(gz.map).length === 0;
  if (gzEmpty && Object.keys(navMap).length === 0) {
    return { success: false, error: '上游无数据：估值排行已下架，净值接口被风控拦截' };
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
