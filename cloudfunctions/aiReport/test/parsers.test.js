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
