// 东财取数 + 解析。解析器为纯函数(可单测);fetchAllData 做编排,单项失败静默留空。
// 接口与参数照抄仓库现有实现:checkAlerts(估值排行)、getFund(FundMNFInfo)、fundApi.ts(其余)。
const https = require('https');

// ⚠️ 不要伪装浏览器 UA：东财风控拦截"自称 Chrome 但特征不符"的请求(61136403)，不带 UA 反而放行
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { ...headers }, timeout: 25000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
function asJson(v) { return typeof v === 'string' ? JSON.parse(v) : v; }

function parseGZList(json) {
  const list = (asJson(json)?.Data?.list) || [];
  const map = Object.create(null);
  for (const it of list) {
    const g = parseFloat(String(it.gszzl).replace('%', ''));
    map[it.bzdm] = { gszzl: isNaN(g) ? null : g, gsz: parseFloat(it.gsz) || 0, name: it.jjjc };
  }
  return map;
}
// 估值口径日期(Data.gzrq):仅取日期部分,供 fetchAllData 校验估值是否为当日估值(防周末/节假日拿旧估值冒充当日)
function parseGZDate(json) {
  const raw = asJson(json)?.Data?.gzrq;
  return raw ? String(raw).slice(0, 10) : null;
}
function parseNavList(json) {
  const map = Object.create(null);
  for (const d of asJson(json)?.Datas || []) {
    if (!d || !d.FCODE) continue;
    const v = parseFloat(d.NAVCHGRT);
    map[d.FCODE] = {
      // 净值字段东财现为 NAV(旧版曾叫 DWJZ)，兼容取
      nav: parseFloat(d.NAV != null ? d.NAV : d.DWJZ) || 0,
      navDate: d.PDATE && d.PDATE !== '--' ? d.PDATE : '',
      navChg: isNaN(v) ? null : v,
      name: d.SHORTNAME || ''
    };
  }
  return map;
}
const PERIOD_MAP = [['Y', '近1月'], ['3Y', '近3月'], ['1N', '近1年']];
function parsePeriods(json) {
  const byTitle = new Map((asJson(json)?.Datas || []).map((d) => [String(d.title), d]));
  const out = [];
  for (const [title, label] of PERIOD_MAP) {
    const d = byTitle.get(title);
    if (!d) continue;
    const syl = parseFloat(d.syl);
    if (Number.isFinite(syl)) out.push({ label, syl });
  }
  return out;
}
function parseSectors(json) {
  return (asJson(json)?.Datas || [])
    .map((d) => ({ name: String(d.HYMC || '').trim(), ratio: parseFloat(d.ZJZBL) || 0 }))
    .filter((s) => s.name && s.ratio > 0);
}
function parseTopStocks(json) {
  const stocks = asJson(json)?.Datas?.fundStocks || [];
  const out = [];
  for (const s of stocks.slice(0, 10)) {
    const c = String(s.GPDM || '').trim();
    const w = parseFloat(s.JZBL);
    if (/^\d{6}$/.test(c) && Number.isFinite(w) && w > 0) out.push({ code: c, name: String(s.GPJC || '').trim(), weight: w });
  }
  return out;
}
function parseUlist(json) {
  const m = new Map();
  for (const d of asJson(json)?.data?.diff || []) {
    const c = String(d.f12 || '');
    const chg = Number(d.f3);
    if (c && Number.isFinite(chg)) m.set(c, chg);
  }
  return m;
}

const MOB = 'https://fundmobapi.eastmoney.com/FundMNewApi';
const MOB_PARAMS = 'deviceid=wx&plat=Android&product=EFund&version=1';
async function safe(fn, fallback) { try { return await fn(); } catch (e) { return fallback; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// FundMNFInfo 取净值：东财风控(61136403)对数据中心 IP 阵发拦截，deviceid 每次随机 + 重试提高命中
async function fetchNavMap(codes, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const deviceid = Math.random().toString(36).slice(2, 12);
    let rawErr = '';
    const map = await safe(async () => {
      const raw = await httpGet(
        `${MOB}/FundMNFInfo?pageIndex=1&pageSize=${codes.length}&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=${deviceid}&Fcodes=${codes.join(',')}`);
      const j = asJson(raw);
      if (j && j.ErrCode && j.ErrCode !== 0) rawErr = `ErrCode=${j.ErrCode} ${j.ErrMsg || ''}`;
      return parseNavList(raw);
    }, {});
    const n = Object.keys(map).length;
    console.log(`[fetch] nav attempt#${i} got=${n}${rawErr ? ' upstream:' + rawErr : ''}`);
    if (n > 0) return map;
    if (i < tries - 1) await sleep(400 * (i + 1));
  }
  console.warn('[fetch] nav 全部失败(上游风控/下架?),facts 将无净值→computeFacts 返回 null');
  return {};
}

// 拉全量数据:估值表/净值/每基金(阶段涨幅+行业+重仓)/重仓个股涨跌/大盘指数
async function fetchAllData(codes) {
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const [gzResult, navMap] = await Promise.all([
    safe(async () => {
      const json = await httpGet(
        'https://api.fund.eastmoney.com/FundGuZhi/GetFundGZList?type=1&sort=3&orderType=desc&canbuy=0&pageIndex=1&pageSize=30000',
        { Referer: 'https://fund.eastmoney.com/' });
      return { map: parseGZList(json), date: parseGZDate(json) };
    }, { map: {}, date: null }),
    fetchNavMap(codes)
  ]);
  const gzMap = gzResult.map;
  // 估值日期非当日(周末/节假日接口仍返回上个交易日估值)时,不把估值当作当日涨跌,交由 facts.js 落入 navMissing
  const gzIsToday = gzResult.date === today;

  const fundData = {};
  await Promise.all(codes.map(async (code) => {
    const [periods, sectors, topStocks] = await Promise.all([
      safe(async () => parsePeriods(await httpGet(`${MOB}/FundMNPeriodIncrease?FCODE=${code}&${MOB_PARAMS}&_=${Date.now()}`)), []),
      safe(async () => parseSectors(await httpGet(`${MOB}/FundMNSectorAllocation?FCODE=${code}&${MOB_PARAMS}&_=${Date.now()}`)), []),
      safe(async () => parseTopStocks(await httpGet(`${MOB}/FundMNInverstPosition?FCODE=${code}&deviceid=wx&plat=WAP&product=EFund&version=2.0.0&_=${Date.now()}`)), [])
    ]);
    const nav = navMap[code] || {};
    const gz = gzMap[code] || {};
    fundData[code] = {
      name: nav.name || gz.name || '', nav: nav.nav, navDate: nav.navDate,
      navChg: nav.navChg, estChg: gzIsToday ? gz.gszzl : null, periods, sectors, topStocks
    };
  }));

  // 重仓个股当日涨跌(push2 ulist,50 一批)
  const stockCodes = [...new Set(Object.values(fundData).flatMap((d) => (d.topStocks || []).map((s) => s.code)))];
  const chgMap = new Map();
  const toSecid = (c) => `${c.startsWith('6') || c.startsWith('9') ? '1' : '0'}.${c}`;
  for (let i = 0; i < stockCodes.length; i += 50) {
    const chunk = stockCodes.slice(i, i + 50);
    const m = await safe(async () => parseUlist(await httpGet(
      `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f3,f12&secids=${chunk.map(toSecid).join(',')}&_=${Date.now()}`)), new Map());
    for (const [k, v] of m) chgMap.set(k, v);
  }
  for (const d of Object.values(fundData)) {
    for (const s of d.topStocks || []) s.chg = chgMap.has(s.code) ? chgMap.get(s.code) : null;
  }

  // 大盘指数：先 push2；数据中心 IP 常被限流(拿到空)，回落腾讯行情 qt.gtimg.cn(宽松,只取涨跌%不受 GBK 影响)
  const INDEXES = [['1.000001', '上证指数', 's_sh000001'], ['0.399001', '深证成指', 's_sz399001'], ['0.399006', '创业板指', 's_sz399006']];
  const idxMap = await safe(async () => parseUlist(await httpGet(
    `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f3,f12&secids=${INDEXES.map(([s]) => s).join(',')}&_=${Date.now()}`)), new Map());
  let indexes = INDEXES
    .map(([secid, name]) => ({ name, chg: idxMap.get(secid.split('.')[1]) ?? null }))
    .filter((i) => i.chg != null);
  if (!indexes.length) {
    indexes = await safe(async () => {
      const txt = await httpGet(`https://qt.gtimg.cn/q=${INDEXES.map(([, , tx]) => tx).join(',')}`);
      const out = [];
      for (const [, name, tx] of INDEXES) {
        const m = String(txt).match(new RegExp(`v_${tx}="([^"]*)"`));
        if (m) { const chg = parseFloat(m[1].split('~')[5]); if (Number.isFinite(chg)) out.push({ name, chg }); }
      }
      return out;
    }, []);
  }
  console.log(`[fetch] indexes=${indexes.length}${indexes.length ? ' ' + indexes.map((i) => i.name + i.chg).join(',') : ''}`);

  return { fundData, indexes, today };
}

module.exports = { parseGZList, parseGZDate, parseNavList, parsePeriods, parseSectors, parseTopStocks, parseUlist, fetchAllData, httpGet };
