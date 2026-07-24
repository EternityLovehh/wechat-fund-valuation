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
