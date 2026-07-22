// calc.ts - 定投计算器（复利估算，假设年化收益恒定）
const FREQS = [
  { label: '每月', ppy: 12 },
  { label: '每周', ppy: 52 },
  { label: '每日', ppy: 250 } // 按约 250 个交易日/年
];

interface CalcResult { invest: number; fv: number; gain: number; rate: number; periods: number }

Page({
  data: {
    freqs: FREQS,
    amount: '1000',
    freqIndex: 0,
    years: '3',
    rate: '8',
    result: null as CalcResult | null
  },

  onLoad() { this.calc(); },

  onAmount(e: any) { this.setData({ amount: e.detail.value }); this.calc(); },
  onYears(e: any) { this.setData({ years: e.detail.value }); this.calc(); },
  onRate(e: any) { this.setData({ rate: e.detail.value }); this.calc(); },
  pickFreq(e: any) { this.setData({ freqIndex: Number(e.currentTarget.dataset.i) }); this.calc(); },

  calc() {
    const A = parseFloat(this.data.amount) || 0;
    const ppy = FREQS[this.data.freqIndex].ppy;
    const years = parseFloat(this.data.years) || 0;
    const annual = (parseFloat(this.data.rate) || 0) / 100;
    const n = Math.round(ppy * years);
    if (A <= 0 || n <= 0) { this.setData({ result: null }); return; }

    // 每期利率 i：年化换算到每期；期末复利终值 FV = A × ((1+i)^n − 1) / i
    const i = Math.pow(1 + annual, 1 / ppy) - 1;
    const fv = Math.abs(i) < 1e-9 ? A * n : A * ((Math.pow(1 + i, n) - 1) / i);
    const invest = A * n;
    const gain = fv - invest;
    const rate = invest > 0 ? (gain / invest) * 100 : 0;
    this.setData({ result: { invest, fv, gain, rate, periods: n } });
  }
})
