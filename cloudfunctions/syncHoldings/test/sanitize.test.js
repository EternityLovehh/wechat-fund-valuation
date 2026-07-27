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
