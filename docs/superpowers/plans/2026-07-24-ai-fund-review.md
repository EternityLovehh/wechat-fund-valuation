# AI 基金复盘功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 MyFund 小程序内落地 AI 持仓复盘：每交易日 21:00 云函数自动生成四板块 markdown 报告（复盘归因/阶段走势/未来展望/操作参考）并订阅消息推送，另有手动生成入口与报告页。

**Architecture:** 两个新云函数（`syncHoldings` 持仓快照上云、`aiReport` 取数→代码算 facts→DeepSeek 生成→落库→推送），两个新集合（`user_holdings`、`fund_reports`），一个新页面 `pages/report`。LLM 只做解读，所有数字由代码算好。spec 见 `docs/superpowers/specs/2026-07-24-ai-fund-review-design.md`。

**Tech Stack:** 微信云开发（wx-server-sdk ~2.6.3）、@cloudbase/node-sdk ≥3.16.0（云开发原生大模型，`ai.createModel("cloudbase")`）、原生小程序 TypeScript。

## Global Constraints

- 云函数纯逻辑放 `lib/*.js`，**不得 require wx-server-sdk**（本地 `node --test` 要能跑，本机 Node v22）。
- LLM：`model.generateText({ model: 'deepseek-v3.2', messages })`，`tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, timeout: 60000 })`，失败重试 1 次。
- 订阅消息模板与 `checkAlerts` 共用：`xKSDHWEZPtQaJq_73F5JVQk6UI8T8SlfmkILDfCLV_E`，quota 共池；报告推送去重用 `fund_alerts` 新字段 `lastReportDate`。
- 报告固定四个二级标题：`## 当日复盘`、`## 阶段走势`、`## 未来展望`、`## 操作参考`；结尾固定行 `> 本报告由 AI 基于公开数据生成，仅供参考，不构成投资建议。`
- 报告每用户保留 30 份；同一 openid+date 重复生成覆盖。
- 前端本地存储 key 一律带环境后缀（仿 `storage.ts` 的 `envSuffix()`）。
- 小程序端无测试框架：前端任务以开发者工具手动验证为准，验证点写在步骤里。
- commit message 用中文 conventional 风格（仓库惯例），结尾加 `Co-Authored-By: Claude <noreply@anthropic.com>`。

## File Structure

```
cloudfunctions/syncHoldings/{index.js, lib/sanitize.js, test/sanitize.test.js, package.json, config.json}
cloudfunctions/aiReport/{index.js, lib/fetch.js, lib/facts.js, lib/prompt.js, lib/llm.js,
                         test/{parsers,facts,prompt}.test.js, package.json, config.json}
miniprogram/utils/reportSync.ts   # 三源持仓合并 + hash 节流 + 调 syncHoldings
miniprogram/utils/mdRender.ts     # markdown 子集 → rich-text 节点
miniprogram/pages/report/{report.ts, report.wxml, report.wxss, report.json}
修改: miniprogram/app.json、pages/holding/holding.ts、pages/mine/{mine.wxml,mine.ts}、utils/alert.ts
```

---

### Task 1: aiReport 纯计算模块 lib/facts.js

**Files:**
- Create: `cloudfunctions/aiReport/lib/facts.js`
- Test: `cloudfunctions/aiReport/test/facts.test.js`

**Interfaces:**
- Produces: `computeFacts(holdings, fundData, indexes, today)` →
  - `holdings`: `[{code, name, shares, cost}]`
  - `fundData`: `{ [code]: { name, nav, navDate, navChg, estChg, periods:[{label,syl}], sectors:[{name,ratio}], topStocks:[{code,name,weight,chg}] } }`（任一子项可缺）
  - `indexes`: `[{name, chg}]`；`today`: `'YYYY-MM-DD'`
  - 返回 `facts` 对象（结构见实现），持仓为空或全部无净值返回 `null`。

- [ ] **Step 1: 写失败测试**

```js
// cloudfunctions/aiReport/test/facts.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { computeFacts } = require('../lib/facts');

const TODAY = '2026-07-24';

test('净值口径:市值/当日盈亏/累计收益', () => {
  const f = computeFacts(
    [{ code: '000001', name: 'A基金', shares: 1000, cost: 1 }],
    { '000001': { nav: 1.1, navDate: TODAY, navChg: 1.0, estChg: null } },
    [{ name: '上证指数', chg: 0.5 }],
    TODAY
  );
  assert.equal(f.portfolio.totalValue, 1100);
  assert.equal(f.portfolio.totalProfit, 100);
  assert.ok(Math.abs(f.portfolio.dayProfit - (1100 - 1100 / 1.01)) < 1e-6);
  assert.equal(f.funds[0].chgSource, 'nav');
});

test('净值未出用估值兜底并标注', () => {
  const f = computeFacts(
    [{ code: '000002', name: 'B基金', shares: 100, cost: 2 }],
    { '000002': { nav: 2.0, navDate: '2026-07-23', navChg: 0.3, estChg: -1.2 } },
    [], TODAY
  );
  assert.equal(f.funds[0].chgSource, 'est');
  assert.ok(f.funds[0].dayChg === -1.2);
});

test('净值估值全无:计市值不计当日盈亏,列入 navMissing', () => {
  const f = computeFacts(
    [{ code: '000003', name: 'C基金', shares: 100, cost: 1 }],
    { '000003': { nav: 1.5, navDate: '2026-07-20', navChg: 0.1, estChg: null } },
    [], TODAY
  );
  assert.equal(f.funds[0].chgSource, null);
  assert.deepEqual(f.portfolio.navMissing, ['000003']);
});

test('重仓股按市值加权穿透聚合', () => {
  const f = computeFacts(
    [
      { code: '000001', name: 'A', shares: 1000, cost: 1 }, // 市值 1000
      { code: '000002', name: 'B', shares: 500, cost: 2 }   // 市值 1000
    ],
    {
      '000001': { nav: 1, navDate: TODAY, navChg: 0, estChg: null, topStocks: [{ code: '600519', name: '贵州茅台', weight: 10, chg: 2 }] },
      '000002': { nav: 2, navDate: TODAY, navChg: 0, estChg: null, topStocks: [{ code: '600519', name: '贵州茅台', weight: 5, chg: 2 }] }
    },
    [], TODAY
  );
  // (1000*10% + 1000*5%) / 2000 = 7.5%
  assert.equal(f.stockExposure[0].code, '600519');
  assert.ok(Math.abs(f.stockExposure[0].pct - 7.5) < 1e-6);
});

test('空持仓返回 null', () => {
  assert.equal(computeFacts([], {}, [], TODAY), null);
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd cloudfunctions/aiReport && node --test test/facts.test.js
```
预期:FAIL（Cannot find module '../lib/facts'）

- [ ] **Step 3: 实现 lib/facts.js**

```js
// 纯计算:由持仓+行情数据算出报告事实(facts)。不 require 任何云 SDK,便于本地单测。
// 口径:navDate===today 用净值涨跌(nav);否则有估值用估值(est);都没有则该基金不计当日盈亏。
function computeFacts(holdings, fundData, indexes, today) {
  if (!Array.isArray(holdings) || !holdings.length) return null;

  const funds = [];
  const navMissing = [];
  let totalValue = 0, totalCost = 0, dayProfit = 0, dayBase = 0;

  for (const h of holdings) {
    const d = (fundData && fundData[h.code]) || {};
    const nav = Number(d.nav);
    if (!Number.isFinite(nav) || nav <= 0) continue; // 连净值都没有:跳过该基金
    const marketValue = h.shares * nav;
    const cost = h.shares * h.cost;

    let dayChg = null, chgSource = null;
    if (d.navDate === today && Number.isFinite(Number(d.navChg))) {
      dayChg = Number(d.navChg); chgSource = 'nav';
    } else if (Number.isFinite(Number(d.estChg))) {
      dayChg = Number(d.estChg); chgSource = 'est';
    } else {
      navMissing.push(h.code);
    }

    let dayProfitAmt = 0;
    if (dayChg != null) {
      const yesterday = marketValue / (1 + dayChg / 100);
      dayProfitAmt = marketValue - yesterday;
      dayProfit += dayProfitAmt;
      dayBase += yesterday;
    }
    totalValue += marketValue;
    totalCost += cost;
    funds.push({
      code: h.code, name: h.name || d.name || h.code,
      marketValue: round2(marketValue), dayChg, chgSource,
      dayProfitAmt: round2(dayProfitAmt),
      totalProfitAmt: round2(marketValue - cost),
      totalProfitRate: cost > 0 ? round2(((marketValue - cost) / cost) * 100) : 0,
      periods: Array.isArray(d.periods) ? d.periods : []
    });
  }
  if (!funds.length) return null;
  funds.sort((a, b) => b.dayProfitAmt - a.dayProfitAmt);

  // 重仓股/行业按市值加权穿透
  const stockMap = new Map(), sectorMap = new Map();
  for (const h of holdings) {
    const d = (fundData && fundData[h.code]) || {};
    const nav = Number(d.nav);
    if (!Number.isFinite(nav) || nav <= 0) continue;
    const mv = h.shares * nav;
    for (const s of d.topStocks || []) {
      const cur = stockMap.get(s.code) || { code: s.code, name: s.name, amount: 0, chg: s.chg ?? null };
      cur.amount += (mv * s.weight) / 100;
      stockMap.set(s.code, cur);
    }
    for (const s of d.sectors || []) {
      sectorMap.set(s.name, (sectorMap.get(s.name) || 0) + (mv * s.ratio) / 100);
    }
  }
  const stockExposure = [...stockMap.values()]
    .map((s) => ({ code: s.code, name: s.name, pct: round2((s.amount / totalValue) * 100), chg: s.chg }))
    .sort((a, b) => b.pct - a.pct).slice(0, 10);
  const sectorExposure = [...sectorMap.entries()]
    .map(([name, amt]) => ({ name, pct: round2((amt / totalValue) * 100) }))
    .sort((a, b) => b.pct - a.pct).slice(0, 8);

  return {
    date: today,
    portfolio: {
      totalValue: round2(totalValue), totalCost: round2(totalCost),
      totalProfit: round2(totalValue - totalCost),
      totalProfitRate: totalCost > 0 ? round2(((totalValue - totalCost) / totalCost) * 100) : 0,
      dayProfit: round2(dayProfit),
      dayProfitRate: dayBase > 0 ? round2((dayProfit / dayBase) * 100) : 0,
      navMissing
    },
    funds, stockExposure, sectorExposure,
    indexes: Array.isArray(indexes) ? indexes : []
  };
}
function round2(n) { return Math.round(n * 100) / 100; }
module.exports = { computeFacts };
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd cloudfunctions/aiReport && node --test test/facts.test.js
```
预期:5 pass

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/aiReport/lib/facts.js cloudfunctions/aiReport/test/facts.test.js
git commit -m "feat(aiReport): facts 纯计算模块(盈亏归因/穿透聚合)"
```

---

### Task 2: aiReport 取数模块 lib/fetch.js（解析器可测）

**Files:**
- Create: `cloudfunctions/aiReport/lib/fetch.js`
- Test: `cloudfunctions/aiReport/test/parsers.test.js`

**Interfaces:**
- Produces（解析器,纯函数）: `parseGZList(json)`→`{[code]:{gszzl,gsz,name}}`; `parseNavList(json)`→`{[code]:{nav,navDate,navChg,name}}`; `parsePeriods(json)`→`[{label,syl}]`; `parseSectors(json)`→`[{name,ratio}]`; `parseTopStocks(json)`→`[{code,name,weight}]`; `parseUlist(json)`→`Map<code,chg>`
- Produces（取数编排,云端用）: `fetchAllData(codes)` → `{ fundData, indexes, today }`（内部并发拉取,单项失败留空）

- [ ] **Step 1: 写失败测试（每个解析器一条,fixture 仿真实返回结构）**

```js
// cloudfunctions/aiReport/test/parsers.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const p = require('../lib/fetch');

test('parseGZList', () => {
  const m = p.parseGZList({ Data: { list: [{ bzdm: '000001', gszzl: '1.23%', gsz: '1.10', jjjc: 'A基金' }] } });
  assert.deepEqual(m['000001'], { gszzl: 1.23, gsz: 1.1, name: 'A基金' });
});
test('parseNavList', () => {
  const m = p.parseNavList({ Datas: [{ FCODE: '000001', DWJZ: '1.5000', PDATE: '2026-07-24', NAVCHGRT: '0.85', SHORTNAME: 'A基金' }] });
  assert.deepEqual(m['000001'], { nav: 1.5, navDate: '2026-07-24', navChg: 0.85, name: 'A基金' });
});
test('parsePeriods 只保留近1月/近3月/近1年', () => {
  const out = p.parsePeriods({ Datas: [
    { title: 'Y', syl: '5.1' }, { title: '3Y', syl: '12.0' }, { title: '6Y', syl: '9' }, { title: '1N', syl: '30.5' }
  ] });
  assert.deepEqual(out, [{ label: '近1月', syl: 5.1 }, { label: '近3月', syl: 12 }, { label: '近1年', syl: 30.5 }]);
});
test('parseSectors', () => {
  const out = p.parseSectors({ Datas: [{ HYMC: ' 电子 ', ZJZBL: '25.5' }, { HYMC: '', ZJZBL: '1' }] });
  assert.deepEqual(out, [{ name: '电子', ratio: 25.5 }]);
});
test('parseTopStocks 仅取A股6位代码前10', () => {
  const out = p.parseTopStocks({ Datas: { fundStocks: [
    { GPDM: '600519', GPJC: '贵州茅台', JZBL: '9.8' }, { GPDM: '00700', GPJC: '腾讯控股', JZBL: '8' }
  ] } });
  assert.deepEqual(out, [{ code: '600519', name: '贵州茅台', weight: 9.8 }]);
});
test('parseUlist', () => {
  const m = p.parseUlist({ data: { diff: [{ f12: '600519', f3: 2.11 }] } });
  assert.equal(m.get('600519'), 2.11);
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd cloudfunctions/aiReport && node --test test/parsers.test.js
```
预期:FAIL（Cannot find module '../lib/fetch'）

- [ ] **Step 3: 实现 lib/fetch.js**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd cloudfunctions/aiReport && node --test test/parsers.test.js
```
预期:6 pass

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/aiReport/lib/fetch.js cloudfunctions/aiReport/test/parsers.test.js
git commit -m "feat(aiReport): 东财取数模块(解析器纯函数可单测)"
```

---

### Task 3: aiReport 提示词模块 lib/prompt.js

**Files:**
- Create: `cloudfunctions/aiReport/lib/prompt.js`
- Test: `cloudfunctions/aiReport/test/prompt.test.js`

**Interfaces:**
- Consumes: Task 1 的 `facts` 结构
- Produces: `buildPrompt(facts)` → `{ system: string, user: string }`；`extractSummary(markdown)` → 首个正文段落截 60 字

- [ ] **Step 1: 写失败测试**

```js
// cloudfunctions/aiReport/test/prompt.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildPrompt, extractSummary } = require('../lib/prompt');

const FACTS = {
  date: '2026-07-24',
  portfolio: { totalValue: 1100, totalCost: 1000, totalProfit: 100, totalProfitRate: 10, dayProfit: 10.89, dayProfitRate: 1, navMissing: [] },
  funds: [{ code: '000001', name: 'A基金', marketValue: 1100, dayChg: 1, chgSource: 'nav', dayProfitAmt: 10.89, totalProfitAmt: 100, totalProfitRate: 10, periods: [] }],
  stockExposure: [], sectorExposure: [], indexes: [{ name: '上证指数', chg: 0.5 }]
};

test('system 含四板块标题与合规约束', () => {
  const { system } = buildPrompt(FACTS);
  for (const h of ['## 当日复盘', '## 阶段走势', '## 未来展望', '## 操作参考']) assert.ok(system.includes(h));
  assert.ok(system.includes('不构成投资建议'));
  assert.ok(system.includes('推测'));
});
test('user 含 facts 数据', () => {
  const { user } = buildPrompt(FACTS);
  assert.ok(user.includes('A基金') && user.includes('10.89'));
});
test('extractSummary 跳过标题取首段截60字', () => {
  const md = '## 当日复盘\n\n今日组合上涨1%，主要由A基金贡献。' + 'x'.repeat(100);
  const s = extractSummary(md);
  assert.ok(s.startsWith('今日组合上涨1%'));
  assert.ok(s.length <= 60);
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd cloudfunctions/aiReport && node --test test/prompt.test.js
```
预期:FAIL（Cannot find module '../lib/prompt'）

- [ ] **Step 3: 实现 lib/prompt.js**

```js
// 单轮提示词:facts(代码算好的数字) + 四板块写作指令 + 合规约束。
const DISCLAIMER = '> 本报告由 AI 基于公开数据生成，仅供参考，不构成投资建议。';

function buildPrompt(facts) {
  const system = [
    '你是一位基金组合分析助手，为持有人撰写每日持仓复盘报告。',
    '硬性规则：',
    '1. 所有数字必须直接引用输入数据，禁止自行计算或编造数字。',
    '2. 对未来的判断必须明确标注"推测"，不得使用确定性表述。',
    '3. 操作部分只给倾向性参考并说明理由，禁止给出明确的买卖指令与点位承诺。',
    '4. 输出为 markdown，正文开头先用一句话总结当日整体表现，然后依次输出且仅输出以下四个二级标题：',
    '## 当日复盘（组合与单基金盈亏归因，结合重仓股/板块暴露和大盘环境解释涨跌来源）',
    '## 阶段走势（结合各基金近1月/3月/1年阶段涨幅评价组合走势与结构）',
    '## 未来展望（基于持仓板块近期表现做推演，每条标注"推测"）',
    '## 操作参考（集中度/暴露风险提示与倾向性参考，非指令）',
    `5. 报告最后单独一行输出：${DISCLAIMER}`,
    '6. 若输入标注某基金"当日数据缺失"，在当日复盘中说明并跳过其归因。'
  ].join('\n');

  const lines = [
    `日期：${facts.date}`,
    `大盘：${facts.indexes.map((i) => `${i.name} ${fmt(i.chg)}%`).join('，') || '无数据'}`,
    `组合：总市值 ${facts.portfolio.totalValue} 元，当日盈亏 ${facts.portfolio.dayProfit} 元（${fmt(facts.portfolio.dayProfitRate)}%），累计收益 ${facts.portfolio.totalProfit} 元（${fmt(facts.portfolio.totalProfitRate)}%）`,
    facts.portfolio.navMissing.length ? `当日数据缺失基金：${facts.portfolio.navMissing.join('、')}` : '',
    '各基金（按当日贡献从高到低）：',
    ...facts.funds.map((f) =>
      `- ${f.name}(${f.code}) 市值${f.marketValue}元 当日${f.dayChg == null ? '数据缺失' : fmt(f.dayChg) + '%（' + (f.chgSource === 'nav' ? '净值' : '估值') + '口径，贡献' + f.dayProfitAmt + '元）'} 累计${fmt(f.totalProfitRate)}%` +
      (f.periods.length ? ` 阶段涨幅:${f.periods.map((p) => `${p.label}${fmt(p.syl)}%`).join('/')}` : '')),
    facts.stockExposure.length ? '穿透重仓股暴露（占组合%）：' + facts.stockExposure.map((s) => `${s.name}${s.pct}%${s.chg != null ? '(今日' + fmt(s.chg) + '%)' : ''}`).join('，') : '',
    facts.sectorExposure.length ? '行业暴露（占组合%）：' + facts.sectorExposure.map((s) => `${s.name}${s.pct}%`).join('，') : '',
    '',
    '请根据以上数据撰写报告。'
  ].filter(Boolean);

  return { system, user: lines.join('\n') };
}
function fmt(n) { return n == null ? '--' : (n >= 0 ? '+' : '') + n; }

// 列表页摘要:跳过标题/空行/引用,取首个正文段落截 60 字
function extractSummary(md) {
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('>')) continue;
    return line.slice(0, 60);
  }
  return '';
}
module.exports = { buildPrompt, extractSummary, DISCLAIMER };
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd cloudfunctions/aiReport && node --test test/prompt.test.js
```
预期:3 pass

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/aiReport/lib/prompt.js cloudfunctions/aiReport/test/prompt.test.js
git commit -m "feat(aiReport): 提示词构建(四板块+合规约束)与摘要提取"
```

---

### Task 4: aiReport 主流程 index.js + LLM 调用 + 配置

**Files:**
- Create: `cloudfunctions/aiReport/lib/llm.js`、`cloudfunctions/aiReport/index.js`、`cloudfunctions/aiReport/package.json`、`cloudfunctions/aiReport/config.json`

**Interfaces:**
- Consumes: `computeFacts`(Task 1)、`fetchAllData`(Task 2)、`buildPrompt`/`extractSummary`(Task 3)
- Produces: 云函数 `aiReport`，`event` 协议：
  - `{ action: 'list' }` → 调用者最近 30 份报告元信息（不含 content/facts）
  - `{ action: 'get', id }` → 单份报告全文（校验 openid）
  - `{ holdings?, dryRun?, state? }`（无 action）→ 生成报告；小程序调用（有 OPENID）只处理调用者；定时触发（无 OPENID）遍历 `user_holdings` 全部用户并推送

- [ ] **Step 1: 实现 lib/llm.js**

```js
// 云开发原生大模型调用(服务端)。失败重试 1 次。
const tcb = require('@cloudbase/node-sdk');
const MODEL_ID = 'deepseek-v3.2';
let app = null;

async function generateReport(system, user) {
  if (!app) app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, timeout: 60000 });
  const model = app.ai().createModel('cloudbase');
  const call = () =>
    model.generateText({
      model: MODEL_ID,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    });
  try {
    return (await call()).text;
  } catch (e) {
    return (await call()).text; // 重试 1 次,再失败让异常上抛
  }
}
module.exports = { generateReport, MODEL_ID };
```

- [ ] **Step 2: 实现 index.js**

```js
// 云函数:AI 持仓复盘报告。
// 触发:timer 每天 21:00(函数内跳过周末) / 小程序手动调用(可带最新持仓) / action list|get 供报告页读取。
// 流程:持仓 → fetchAllData → computeFacts → buildPrompt → LLM → fund_reports(同 openid+date 覆盖,留 30 份) → 订阅消息(仅 timer)。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const { fetchAllData } = require('./lib/fetch');
const { computeFacts } = require('./lib/facts');
const { buildPrompt, extractSummary } = require('./lib/prompt');
const { generateReport } = require('./lib/llm');

const TEMPLATE_ID = 'xKSDHWEZPtQaJq_73F5JVQk6UI8T8SlfmkILDfCLV_E';
const KEEP_REPORTS = 30;

function sanitizeHoldings(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const h of input.slice(0, 100)) {
    if (!h || !/^\d{6}$/.test(String(h.code))) continue;
    const shares = Number(h.shares), cost = Number(h.cost);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(cost) || cost <= 0) continue;
    out.push({ code: String(h.code), name: String(h.name || '').slice(0, 40), shares, cost });
  }
  return out.length ? out : null;
}

async function generateForUser(openid, holdings, trigger, dryRun) {
  const codes = holdings.map((h) => h.code);
  const { fundData, indexes, today } = await fetchAllData(codes);
  const facts = computeFacts(holdings, fundData, indexes, today);
  if (!facts) return { openid: openid.slice(0, 8) + '…', skip: 'no-usable-data' };
  const prompt = buildPrompt(facts);
  if (dryRun) return { facts, prompt };

  let content, status = 'ok';
  try {
    content = await generateReport(prompt.system, prompt.user);
  } catch (e) {
    content = '';
    status = 'failed';
  }
  const doc = {
    openid, date: facts.date, content, facts,
    summary: status === 'ok' ? extractSummary(content) : '生成失败',
    status, trigger, createdAt: Date.now()
  };
  const col = db.collection('fund_reports');
  const existed = await col.where({ openid, date: facts.date }).get();
  if (existed.data.length) await col.doc(existed.data[0]._id).update({ data: doc });
  else await col.add({ data: doc });

  // 留存:超 30 份删最旧
  const { total } = await col.where({ openid }).count();
  if (total > KEEP_REPORTS) {
    const old = await col.where({ openid }).orderBy('createdAt', 'asc').limit(total - KEEP_REPORTS).get();
    for (const d of old.data) await col.doc(d._id).remove();
  }
  return { openid: openid.slice(0, 8) + '…', status, date: facts.date, dayProfit: facts.portfolio.dayProfit, summary: doc.summary };
}

// 仅 timer:发订阅消息(与涨跌提醒共池 quota;lastReportDate 独立去重)
async function pushReport(openid, result, state) {
  if (result.status !== 'ok') return 'not-ok';
  const alertDoc = await db.collection('fund_alerts').doc(openid).get().catch(() => null);
  const a = alertDoc && alertDoc.data;
  if (!a || !(a.quota > 0)) return 'no-quota';
  if (a.lastReportDate === result.date) return 'already-pushed';
  try {
    const r = await cloud.openapi.subscribeMessage.send({
      touser: openid, templateId: TEMPLATE_ID, page: 'pages/report/report',
      miniprogramState: state,
      data: {
        thing6: { value: 'AI持仓复盘' },
        character_string8: { value: `${result.dayProfit >= 0 ? '+' : '-'}${Math.abs(result.dayProfit).toFixed(2)}` },
        time9: { value: `${result.date} 21:00` },
        amount12: { value: Math.abs(result.dayProfit).toFixed(2) },
        thing10: { value: (result.summary || '今日复盘已生成').slice(0, 20) }
      }
    });
    if (!r || r.errCode === 0 || r.errCode == null) {
      await db.collection('fund_alerts').doc(openid).update({ data: { quota: _.inc(-1), lastReportDate: result.date } });
      return 'sent';
    }
    return `err:${r.errCode}`;
  } catch (e) {
    return `exception:${(e && (e.errMsg || e.message)) || e}`;
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();

  if (event.action === 'list') {
    if (!OPENID) return { success: false, error: '无 openid' };
    const r = await db.collection('fund_reports').where({ openid: OPENID })
      .orderBy('date', 'desc').limit(KEEP_REPORTS)
      .field({ date: true, summary: true, status: true, trigger: true }).get();
    return { success: true, list: r.data };
  }
  if (event.action === 'get') {
    if (!OPENID || !event.id) return { success: false, error: '参数缺失' };
    const r = await db.collection('fund_reports').doc(String(event.id)).get().catch(() => null);
    if (!r || !r.data || r.data.openid !== OPENID) return { success: false, error: '报告不存在' };
    return { success: true, report: r.data };
  }

  if (OPENID) {
    // 手动模式:优先用请求带来的最新持仓,否则读云端快照
    let holdings = sanitizeHoldings(event.holdings);
    if (!holdings) {
      const snap = await db.collection('user_holdings').doc(OPENID).get().catch(() => null);
      holdings = snap && snap.data && sanitizeHoldings(snap.data.holdings);
    }
    if (!holdings) return { success: false, error: '请先在持仓页添加持仓' };
    const result = await generateForUser(OPENID, holdings, 'manual', !!event.dryRun);
    if (event.dryRun) return { success: true, dryRun: result };
    return { success: result.status === 'ok', result };
  }

  // 定时模式:遍历全部用户
  const bjDay = new Date(Date.now() + 8 * 3600 * 1000).getUTCDay();
  if (bjDay === 0 || bjDay === 6) return { skipped: 'weekend' };
  const users = await db.collection('user_holdings').get();
  const state = (event && event.state) || 'trial';
  const debug = [];
  for (const u of users.data) {
    const holdings = sanitizeHoldings(u.holdings);
    if (!holdings) { debug.push({ openid: String(u._id).slice(0, 8) + '…', skip: 'no-holdings' }); continue; }
    const result = await generateForUser(u._id, holdings, 'timer', false);
    result.push = result.status ? await pushReport(u._id, result, state) : 'skipped';
    debug.push(result);
  }
  return { users: users.data.length, state, debug };
};
```

- [ ] **Step 3: 写 package.json 与 config.json**

```json
// cloudfunctions/aiReport/package.json
{
  "name": "aiReport",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "~2.6.3",
    "@cloudbase/node-sdk": "^3.16.0"
  }
}
```

```json
// cloudfunctions/aiReport/config.json
{
  "triggers": [
    { "name": "dailyReport", "type": "timer", "config": "0 0 21 * * * *" }
  ],
  "permissions": {
    "openapi": ["subscribeMessage.send"]
  }
}
```

- [ ] **Step 4: 全量本地测试仍通过（回归）**

```bash
cd cloudfunctions/aiReport && node --test test/
```
预期:全部 pass（index.js/llm.js 依赖云 SDK 不做本地单测，云端验证在 Task 8）

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/aiReport
git commit -m "feat(aiReport): 主流程(生成/列表/详情/定时推送)+21:00触发器"
```

---

### Task 5: syncHoldings 云函数

**Files:**
- Create: `cloudfunctions/syncHoldings/lib/sanitize.js`、`cloudfunctions/syncHoldings/index.js`、`cloudfunctions/syncHoldings/package.json`、`cloudfunctions/syncHoldings/config.json`
- Test: `cloudfunctions/syncHoldings/test/sanitize.test.js`

**Interfaces:**
- Produces: 云函数 `syncHoldings`，`event = { holdings: [{code,name,shares,cost}] }`，upsert `user_holdings`（`_id=openid`）。`sanitizeHoldings(input)` 与 aiReport 内同名函数同规则（各云函数独立打包，允许重复）。

- [ ] **Step 1: 写失败测试**

```js
// cloudfunctions/syncHoldings/test/sanitize.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeHoldings } = require('../lib/sanitize');

test('过滤非法项并截断字段', () => {
  const out = sanitizeHoldings([
    { code: '000001', name: 'A', shares: 100, cost: 1.5 },
    { code: 'abc', shares: 1, cost: 1 },
    { code: '000002', shares: -5, cost: 1 },
    { code: '000003', shares: 10, cost: 0 }
  ]);
  assert.deepEqual(out, [{ code: '000001', name: 'A', shares: 100, cost: 1.5 }]);
});
test('非数组/全非法返回 null', () => {
  assert.equal(sanitizeHoldings('x'), null);
  assert.equal(sanitizeHoldings([{ code: 'bad' }]), null);
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd cloudfunctions/syncHoldings && node --test test/
```
预期:FAIL（Cannot find module '../lib/sanitize'）

- [ ] **Step 3: 实现**

```js
// cloudfunctions/syncHoldings/lib/sanitize.js
// 持仓入参清洗:6位代码/正数份额与成本/上限100条。与 aiReport/index.js 内同名函数同规则。
function sanitizeHoldings(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const h of input.slice(0, 100)) {
    if (!h || !/^\d{6}$/.test(String(h.code))) continue;
    const shares = Number(h.shares), cost = Number(h.cost);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(cost) || cost <= 0) continue;
    out.push({ code: String(h.code), name: String(h.name || '').slice(0, 40), shares, cost });
  }
  return out.length ? out : null;
}
module.exports = { sanitizeHoldings };
```

```js
// cloudfunctions/syncHoldings/index.js
// 云函数:持仓快照上云(一个用户一条,_id=openid),供 aiReport 定时生成时读取。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { sanitizeHoldings } = require('./lib/sanitize');

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { success: false, error: '无 openid' };
  const holdings = sanitizeHoldings(event.holdings);
  if (!holdings) return { success: false, error: '持仓为空或非法' };
  const data = { openid: OPENID, holdings, updatedAt: Date.now() };
  const col = db.collection('user_holdings');
  try {
    const existing = await col.doc(OPENID).get().catch(() => null);
    if (existing && existing.data) await col.doc(OPENID).update({ data });
    else await col.doc(OPENID).set({ data });
    return { success: true, count: holdings.length };
  } catch (e) {
    return { success: false, error: (e && e.message) || String(e) };
  }
};
```

```json
// cloudfunctions/syncHoldings/package.json
{ "name": "syncHoldings", "version": "1.0.0", "main": "index.js",
  "dependencies": { "wx-server-sdk": "~2.6.3" } }
```

```json
// cloudfunctions/syncHoldings/config.json
{ "permissions": { "openapi": [] } }
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd cloudfunctions/syncHoldings && node --test test/
```
预期:2 pass

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/syncHoldings
git commit -m "feat: syncHoldings 云函数(持仓快照上云)"
```

---

### Task 6: 前端持仓同步 reportSync.ts + 持仓页接线

**Files:**
- Create: `miniprogram/utils/reportSync.ts`
- Modify: `miniprogram/pages/holding/holding.ts`（`loadHoldings` 成功后追加一次静默同步）

**Interfaces:**
- Produces: `collectUnifiedHoldings(): UnifiedHolding[]`（合并手动持仓+截图导入已确认部分）、`syncHoldingsToCloud(): Promise<void>`（hash 节流后调 `syncHoldings`）。报告页(Task 7)手动生成时复用 `collectUnifiedHoldings`。

- [ ] **Step 1: 实现 reportSync.ts**

```ts
// 持仓快照上云(供 aiReport 定时生成读取):合并手动持仓与截图导入(已确认部分),
// 内容 hash 无变化不重复调用云函数。key 带环境后缀,与 storage.ts 隔离策略一致。
import { getHoldingFunds, getImportedHoldings } from './storage'

export interface UnifiedHolding { code: string; name: string; shares: number; cost: number }

function envSuffix(): string {
  try {
    const env = wx.getAccountInfoSync().miniProgram.envVersion;
    return env && env !== 'release' ? `__${env}` : '';
  } catch (e) { return ''; }
}
const HASH_KEY = `report_holdings_hash${envSuffix()}`;

export function collectUnifiedHoldings(): UnifiedHolding[] {
  const map = new Map<string, UnifiedHolding>();
  try {
    for (const h of getHoldingFunds()) {
      if (/^\d{6}$/.test(h.code) && h.shares > 0 && h.cost > 0)
        map.set(h.code, { code: h.code, name: h.name || h.code, shares: h.shares, cost: h.cost });
    }
  } catch (e) { /* ignore */ }
  try {
    for (const h of getImportedHoldings()) {
      // 只取已确认锚定部分;同代码手动持仓优先
      if (!map.has(h.code) && /^\d{6}$/.test(h.code) && (h.shares || 0) > 0 && (h.cost || 0) > 0)
        map.set(h.code, { code: h.code, name: h.name || h.code, shares: h.shares as number, cost: h.cost as number });
    }
  } catch (e) { /* ignore */ }
  return [...map.values()];
}

function hashOf(list: UnifiedHolding[]): string {
  const s = list
    .slice().sort((a, b) => (a.code < b.code ? -1 : 1))
    .map((h) => `${h.code}:${h.shares}:${h.cost}`).join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

// 静默同步(可在 onShow/loadHoldings 后调):失败忽略,下次自然重试
export async function syncHoldingsToCloud(): Promise<void> {
  const holdings = collectUnifiedHoldings();
  if (!holdings.length) return;
  const hash = hashOf(holdings);
  try { if (wx.getStorageSync(HASH_KEY) === hash) return; } catch (e) { /* ignore */ }
  try {
    const r: any = await wx.cloud.callFunction({ name: 'syncHoldings', data: { holdings } });
    if (r && r.result && r.result.success) wx.setStorageSync(HASH_KEY, hash);
  } catch (e) { /* ignore:静默失败 */ }
}
```

- [ ] **Step 2: 持仓页接线**

在 `miniprogram/pages/holding/holding.ts` 顶部 import 区（第 3 行附近）追加：

```ts
import { syncHoldingsToCloud } from '../../utils/reportSync'
```

在 `onShow()` 方法内（现有 `this.loadHoldings();` 之后）追加一行：

```ts
    syncHoldingsToCloud(); // 静默:持仓快照上云,hash 无变化不实际调用
```

- [ ] **Step 3: 开发者工具手动验证**

- 编译无 TS 报错。
- 打开持仓页 → 云开发控制台 `user_holdings` 集合出现 `_id=openid` 文档，`holdings` 与持仓一致（注：集合需先在控制台创建，见 Task 8；本步可先在控制台建 `user_holdings` 单个集合）。
- 再次进入持仓页 → Network 面板无重复 `syncHoldings` 调用（hash 节流生效）。
- 修改一笔持仓后进入持仓页 → 云端文档更新。

- [ ] **Step 4: Commit**

```bash
git add miniprogram/utils/reportSync.ts miniprogram/pages/holding/holding.ts
git commit -m "feat: 持仓快照静默上云(hash节流),供AI复盘定时生成"
```

---

### Task 7: 报告页(markdown渲染/列表/生成/订阅) + 入口

**Files:**
- Create: `miniprogram/utils/mdRender.ts`、`miniprogram/pages/report/report.ts`、`report.wxml`、`report.wxss`、`report.json`
- Modify: `miniprogram/app.json`（注册页面）、`miniprogram/pages/mine/mine.wxml`、`mine.ts`（入口）、`miniprogram/utils/alert.ts`（新增 `grantReportQuota`）

**Interfaces:**
- Consumes: `aiReport` 的 `action:'list'/'get'/生成` 协议(Task 4)、`collectUnifiedHoldings`(Task 6)、`utils/alert.ts` 现有 `requestSubscribe`/`pushToCloud`/`getAlertSettings`
- Produces: 页面 `pages/report/report`；`parseMarkdown(md): MdNode[]`；`grantReportQuota(): Promise<boolean>`

- [ ] **Step 1: 实现 mdRender.ts**

```ts
// markdown 子集解析:## / ### 标题、- 列表、> 引用、**加粗**、普通段落。
// 输出结构直接供 wxml 循环渲染(不引入 towxml)。
export interface MdSpan { text: string; bold: boolean }
export interface MdNode { type: 'h2' | 'h3' | 'li' | 'quote' | 'p'; spans: MdSpan[] }

function parseSpans(text: string): MdSpan[] {
  const spans: MdSpan[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index), bold: false });
    spans.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), bold: false });
  return spans.length ? spans : [{ text, bold: false }];
}

export function parseMarkdown(md: string): MdNode[] {
  const nodes: MdNode[] = [];
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('### ')) nodes.push({ type: 'h3', spans: parseSpans(line.slice(4)) });
    else if (line.startsWith('## ')) nodes.push({ type: 'h2', spans: parseSpans(line.slice(3)) });
    else if (line.startsWith('- ')) nodes.push({ type: 'li', spans: parseSpans(line.slice(2)) });
    else if (line.startsWith('> ')) nodes.push({ type: 'quote', spans: parseSpans(line.slice(2)) });
    else nodes.push({ type: 'p', spans: parseSpans(line.replace(/^#+\s*/, '')) });
  }
  return nodes;
}
```

- [ ] **Step 2: utils/alert.ts 新增导出（文件末尾追加）**

```ts
// 报告页「订阅每日推送」:请求一次授权并给云端额度+1。
// 与涨跌提醒共用模板与 quota 池;不改动 enabled/阈值(沿用当前本地设置原样上传)。
export async function grantReportQuota(): Promise<boolean> {
  const accepted = await requestSubscribe();
  await pushToCloud(getAlertSettings(), accepted);
  if (accepted) wx.setStorageSync(RENEW_KEY, beijingToday());
  return accepted;
}
```

- [ ] **Step 3: report.json / report.wxml / report.wxss / report.ts**

```json
// miniprogram/pages/report/report.json
{ "navigationBarTitleText": "AI 复盘", "enablePullDownRefresh": true, "usingComponents": {} }
```

```xml
<!-- miniprogram/pages/report/report.wxml -->
<view class="page">
  <!-- 列表态 -->
  <block wx:if="{{!detail}}">
    <view class="toolbar">
      <button class="btn primary" bindtap="onGenerate" loading="{{generating}}" disabled="{{generating}}">立即生成今日复盘</button>
      <button class="btn" bindtap="onSubscribe">订阅每日推送</button>
    </view>
    <view wx:if="{{!list.length && !loading}}" class="empty">还没有报告，点上方按钮生成第一份</view>
    <view class="card" wx:for="{{list}}" wx:key="_id" bindtap="openDetail" data-id="{{item._id}}">
      <view class="card-head">
        <text class="card-date">{{item.date}}</text>
        <text class="tag {{item.status === 'ok' ? (item.trigger === 'timer' ? 'tag-timer' : 'tag-manual') : 'tag-fail'}}">
          {{item.status === 'ok' ? (item.trigger === 'timer' ? '自动' : '手动') : '失败'}}
        </text>
      </view>
      <text class="card-summary">{{item.summary}}</text>
    </view>
  </block>
  <!-- 详情态 -->
  <block wx:else>
    <view class="detail-head"><text class="back" bindtap="closeDetail">‹ 返回列表</text><text class="detail-date">{{detail.date}}</text></view>
    <view class="md">
      <view wx:for="{{nodes}}" wx:key="index" class="md-{{item.type}}">
        <text wx:for="{{item.spans}}" wx:for-item="sp" wx:key="index" class="{{sp.bold ? 'b' : ''}}">{{sp.text}}</text>
      </view>
    </view>
  </block>
</view>
```

```css
/* miniprogram/pages/report/report.wxss */
.page { padding: 24rpx; }
.toolbar { display: flex; gap: 16rpx; margin-bottom: 24rpx; }
.btn { flex: 1; font-size: 28rpx; border-radius: 12rpx; background: #f2f3f5; }
.btn.primary { background: #1989fa; color: #fff; }
.empty { text-align: center; color: #999; padding: 120rpx 0; font-size: 28rpx; }
.card { background: #fff; border-radius: 16rpx; padding: 24rpx; margin-bottom: 20rpx; box-shadow: 0 2rpx 8rpx rgba(0,0,0,.04); }
.card-head { display: flex; justify-content: space-between; margin-bottom: 8rpx; }
.card-date { font-weight: 600; font-size: 30rpx; }
.tag { font-size: 22rpx; padding: 2rpx 12rpx; border-radius: 8rpx; }
.tag-timer { background: #e8f3ff; color: #1989fa; }
.tag-manual { background: #e8f7ee; color: #07c160; }
.tag-fail { background: #ffece8; color: #ee0a24; }
.card-summary { color: #666; font-size: 26rpx; }
.detail-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20rpx; }
.back { color: #1989fa; font-size: 28rpx; }
.detail-date { font-weight: 600; }
.md { background: #fff; border-radius: 16rpx; padding: 28rpx; }
.md-h2 { font-size: 32rpx; font-weight: 700; margin: 28rpx 0 12rpx; }
.md-h3 { font-size: 29rpx; font-weight: 600; margin: 20rpx 0 8rpx; }
.md-p { font-size: 27rpx; line-height: 1.7; color: #333; margin-bottom: 12rpx; }
.md-li { font-size: 27rpx; line-height: 1.7; color: #333; padding-left: 24rpx; position: relative; margin-bottom: 8rpx; }
.md-li::before { content: '•'; position: absolute; left: 4rpx; color: #1989fa; }
.md-quote { font-size: 24rpx; color: #999; border-left: 6rpx solid #eee; padding-left: 16rpx; margin-top: 24rpx; }
.b { font-weight: 700; }
```

```ts
// miniprogram/pages/report/report.ts
// AI 复盘:列表(fund_reports 元信息) + 详情(markdown渲染) + 立即生成 + 订阅每日推送。
import { parseMarkdown, MdNode } from '../../utils/mdRender'
import { collectUnifiedHoldings } from '../../utils/reportSync'
import { grantReportQuota } from '../../utils/alert'

Page({
  data: {
    list: [] as any[], loading: false, generating: false,
    detail: null as any, nodes: [] as MdNode[]
  },
  onLoad() { this.loadList(); },
  onPullDownRefresh() { this.loadList().then(() => wx.stopPullDownRefresh()); },

  async loadList() {
    this.setData({ loading: true });
    try {
      const r: any = await wx.cloud.callFunction({ name: 'aiReport', data: { action: 'list' } });
      this.setData({ list: (r.result && r.result.list) || [] });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  async openDetail(e: any) {
    const id = e.currentTarget.dataset.id;
    wx.showLoading({ title: '加载中' });
    try {
      const r: any = await wx.cloud.callFunction({ name: 'aiReport', data: { action: 'get', id } });
      const report = r.result && r.result.report;
      if (report) this.setData({ detail: report, nodes: parseMarkdown(report.content) });
      else wx.showToast({ title: '报告不存在', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    wx.hideLoading();
  },
  closeDetail() { this.setData({ detail: null, nodes: [] }); },

  async onGenerate() {
    const holdings = collectUnifiedHoldings();
    if (!holdings.length) { wx.showToast({ title: '请先在持仓页添加持仓', icon: 'none' }); return; }
    this.setData({ generating: true });
    wx.showLoading({ title: '生成中，约需30秒', mask: true });
    try {
      const r: any = await wx.cloud.callFunction({ name: 'aiReport', data: { holdings } });
      wx.hideLoading();
      if (r.result && r.result.success) {
        await this.loadList();
        if (this.data.list.length) this.openDetail({ currentTarget: { dataset: { id: this.data.list[0]._id } } });
      } else {
        wx.showToast({ title: (r.result && r.result.error) || '生成失败，稍后再试', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '生成超时或失败', icon: 'none' });
    }
    this.setData({ generating: false });
  },

  async onSubscribe() {
    const ok = await grantReportQuota();
    wx.showToast({ title: ok ? '已订阅，今晚21点推送' : '未授权', icon: 'none' });
  }
});
```

- [ ] **Step 4: 注册页面 + 我的页入口**

`miniprogram/app.json` 的 `pages` 数组末尾（`"pages/alert/alert"` 之后）加：

```json
    "pages/report/report"
```

`miniprogram/pages/mine/mine.wxml` 「持仓穿透」cell 之后加：

```xml
    <view class="cell" bindtap="goReport" hover-class="cell-hover">
      <text class="cell-icon">🤖</text>
      <view class="cell-main"><text class="cell-label">AI 复盘</text><text class="cell-desc">每日持仓复盘 · 归因 · 走势解读</text></view>
      <text class="cell-arrow">›</text>
    </view>
```

`miniprogram/pages/mine/mine.ts` 的 `goPenetration` 方法之后加：

```ts
  goReport() {
    wx.navigateTo({ url: '/pages/report/report' });
  },
```

- [ ] **Step 5: 开发者工具手动验证**

- 编译无 TS 报错；我的页出现「AI 复盘」入口，可进入报告页。
- 空列表显示引导文案；`parseMarkdown` 用控制台验证：`parseMarkdown('## 标题\n**加粗**正文\n- 项1\n> 引用')` 返回 4 个节点、类型依次 h2/p/li/quote。
- 「立即生成」在云函数未部署时提示失败（预期，全链路在 Task 8 验）。

- [ ] **Step 6: Commit**

```bash
git add miniprogram/utils/mdRender.ts miniprogram/pages/report miniprogram/app.json miniprogram/pages/mine miniprogram/utils/alert.ts
git commit -m "feat: AI复盘页(列表/详情/立即生成/订阅推送)+我的页入口"
```

---

### Task 8: 部署与端到端验证（手动清单）

**Files:** 无新增代码；操作在微信开发者工具与云开发控制台完成。

- [ ] **Step 1: 云端资源准备**

- 云开发控制台 → 数据库 → 创建集合 `user_holdings`、`fund_reports`（权限默认「仅创建者可读写」即可，读写都走云函数）。
- 云开发控制台 → AI → 确认大模型服务已开通（新用户有免费 token 额度）。
- 开发者工具中对 `syncHoldings`、`aiReport` 右键「上传并部署：云端安装依赖」。

- [ ] **Step 2: 数据管道验证（dryRun,不耗token）**

- 真机/工具打开持仓页一次（触发持仓上云）。
- 云开发控制台 → aiReport → 云端测试，入参 `{"dryRun": true}`（注：控制台测试无 OPENID，会走 timer 分支——改用小程序端临时调用或在测试入参里直接带 `holdings`。推荐:开发者工具 console 执行
  `wx.cloud.callFunction({ name:'aiReport', data:{ dryRun:true } }).then(console.log)`）。
- 核对返回 `facts`：总市值/当日盈亏与持仓页显示一致；穿透 Top 与持仓穿透页一致。

- [ ] **Step 3: 手动全链路（真实 LLM）**

- 报告页点「立即生成」→ 30 秒内出报告;检查四个标题齐全、数字与 facts 一致、结尾有免责声明行。
- `fund_reports` 集合出现记录;再次生成同日报告 → 覆盖而非新增。

- [ ] **Step 4: 定时+推送验证**

- 报告页点「订阅每日推送」并授权（quota+1，可在 `fund_alerts` 里确认）。
- 临时把 `aiReport/config.json` 触发器 cron 改为几分钟后（如 `0 30 14 * * * *`），重新上传触发器 → 到点后检查:新报告生成、微信收到订阅消息（体验版默认 `state='trial'`）、`fund_alerts.lastReportDate` 更新、quota-1。
- **验证后把 cron 改回 `0 0 21 * * * *` 并重新上传**。

- [ ] **Step 5: 回归与收尾**

```bash
cd cloudfunctions/aiReport && node --test test/ && cd ../syncHoldings && node --test test/
```
预期:全部 pass。

```bash
git add -A && git status  # 确认只有 config.json 若有改动已还原
git commit -m "chore: AI复盘端到端验证收尾" --allow-empty
```

---

## Self-Review 记录

- **Spec 覆盖**：两集合(Task 5/4)、两云函数(Task 5/4)、21:00 触发器(Task 4)、dryRun(Task 4)、持仓同步+节流(Task 6)、报告页+md渲染+订阅(Task 7)、我的页入口(Task 7)、留存30份+同日覆盖(Task 4)、quota共池+lastReportDate(Task 4)、错误处理表(fetch.js safe()/index.js status:failed/无持仓提示)、测试计划(各任务+Task 8)。спec 全覆盖。
- **占位符**：无 TBD/TODO；所有代码完整。
- **类型一致性**：`sanitizeHoldings` 双处同规则已注明；`collectUnifiedHoldings` 返回结构与云函数入参一致；`action:'list'/'get'` 协议前后端一致；`extractSummary`/`parseMarkdown` 名称前后一致。
