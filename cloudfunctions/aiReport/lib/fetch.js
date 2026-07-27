// 东财取数 + 解析。解析器为纯函数(可单测);fetchAllData 做编排,单项失败静默留空。
// 接口与参数照抄仓库现有实现:checkAlerts(估值排行)、getFund(FundMNFInfo)、fundApi.ts(其余)。
const https = require('https');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36';

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, ...headers }, timeout: 25000 }, (res) => {
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
function parseNavList(json) {
  const map = Object.create(null);
  for (const d of asJson(json)?.Datas || []) {
    if (!d || !d.FCODE) continue;
    map[d.FCODE] = {
      nav: parseFloat(d.DWJZ) || 0,
      navDate: d.PDATE && d.PDATE !== '--' ? d.PDATE : '',
      navChg: parseFloat(d.NAVCHGRT),
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

// 拉全量数据:估值表/净值/每基金(阶段涨幅+行业+重仓)/重仓个股涨跌/大盘指数
async function fetchAllData(codes) {
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const [gzMap, navMap] = await Promise.all([
    safe(async () => parseGZList(await httpGet(
      'https://api.fund.eastmoney.com/FundGuZhi/GetFundGZList?type=1&sort=3&orderType=desc&canbuy=0&pageIndex=1&pageSize=30000',
      { Referer: 'https://fund.eastmoney.com/' })), {}),
    safe(async () => parseNavList(await httpGet(
      `${MOB}/FundMNFInfo?pageIndex=1&pageSize=${codes.length}&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=cf&Fcodes=${codes.join(',')}`)), {})
  ]);

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
      navChg: nav.navChg, estChg: gz.gszzl, periods, sectors, topStocks
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

  // 大盘指数
  const INDEXES = [['1.000001', '上证指数'], ['0.399001', '深证成指'], ['0.399006', '创业板指']];
  const idxMap = await safe(async () => parseUlist(await httpGet(
    `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f3,f12&secids=${INDEXES.map(([s]) => s).join(',')}&_=${Date.now()}`)), new Map());
  const indexes = INDEXES
    .map(([secid, name]) => ({ name, chg: idxMap.get(secid.split('.')[1]) ?? null }))
    .filter((i) => i.chg != null);

  return { fundData, indexes, today };
}

module.exports = { parseGZList, parseNavList, parsePeriods, parseSectors, parseTopStocks, parseUlist, fetchAllData, httpGet };
