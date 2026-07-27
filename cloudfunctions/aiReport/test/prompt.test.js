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
