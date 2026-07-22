// compare.ts - 基金对比（从自选/持仓中选 2-3 只并排比）
import { getBatchFundEstimate, getFundBaseInfo, getFundPeriodIncrease } from '../../utils/fundApi'
import { getOptionalFunds, getHoldingFunds, getImportedHoldings } from '../../utils/storage'

interface Candidate { code: string; name: string }
interface Cell { text: string; cls: string }
interface Row { label: string; values: Cell[] }

function pctCell(v: number | null | undefined): Cell {
  if (v == null || !isFinite(v)) return { text: '--', cls: '' };
  return { text: `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, cls: v >= 0 ? 'positive' : 'negative' };
}
function plain(text: string): Cell { return { text: text || '--', cls: '' }; }

Page({
  data: {
    candidates: [] as Candidate[],
    selected: [] as string[],
    names: [] as string[], // 选中基金名（表头）
    rows: [] as Row[],
    loading: false
  },

  onLoad() {
    const map = new Map<string, string>();
    getOptionalFunds().forEach((f) => map.set(f.code, f.name));
    getHoldingFunds().forEach((f) => map.set(f.code, f.name));
    getImportedHoldings().forEach((f) => map.set(f.code, f.name));
    const candidates = Array.from(map.entries())
      .filter(([c]) => /^\d{6}$/.test(c))
      .map(([code, name]) => ({ code, name }));
    this.setData({ candidates });
    if (candidates.length) this.setSelected(candidates.slice(0, Math.min(2, candidates.length)).map((c) => c.code));
  },

  toggle(e: any) {
    const code = e.currentTarget.dataset.code as string;
    const sel = [...this.data.selected];
    const i = sel.indexOf(code);
    if (i >= 0) sel.splice(i, 1);
    else {
      if (sel.length >= 3) { wx.showToast({ title: '最多对比 3 只', icon: 'none' }); return; }
      sel.push(code);
    }
    this.setSelected(sel);
  },

  async setSelected(sel: string[]) {
    this.setData({ selected: sel });
    if (!sel.length) { this.setData({ rows: [], names: [] }); return; }
    this.setData({ loading: true });
    try {
      const [estimates, baseArr, perfArr] = await Promise.all([
        getBatchFundEstimate(sel),
        Promise.all(sel.map((c) => getFundBaseInfo(c))),
        Promise.all(sel.map((c) => getFundPeriodIncrease(c)))
      ]);
      const estMap = new Map(estimates.map((e) => [e.code, e]));
      const nameMap = new Map(this.data.candidates.map((c) => [c.code, c.name]));

      const cols = sel.map((code, i) => {
        const est = estMap.get(code);
        const base = baseArr[i];
        const perf = perfArr[i];
        const pget = (label: string) => perf.find((p) => p.label === label);
        const m1 = pget('近1月'); const m3 = pget('近3月'); const y1 = pget('近1年');
        return { code, name: nameMap.get(code) || (est && est.name) || code, est, base, m1, m3, y1 };
      });

      const rows: Row[] = [
        { label: '估算涨跌', values: cols.map((c) => pctCell(c.est ? c.est.estimatedGrowth : null)) },
        { label: '近1月', values: cols.map((c) => pctCell(c.m1 ? c.m1.syl : null)) },
        { label: '近3月', values: cols.map((c) => pctCell(c.m3 ? c.m3.syl : null)) },
        { label: '近1年', values: cols.map((c) => pctCell(c.y1 ? c.y1.syl : null)) },
        { label: '近1年排名', values: cols.map((c) => plain(c.y1 && c.y1.sc ? `${c.y1.rank}/${c.y1.sc}` : '')) },
        { label: '规模(亿)', values: cols.map((c) => plain(c.base ? c.base.scaleYi.toFixed(1) : '')) },
        { label: '成立日', values: cols.map((c) => plain(c.base ? c.base.estabDate : '')) },
        { label: '风险', values: cols.map((c) => plain(c.base ? c.base.riskLabel : '')) },
        { label: '经理', values: cols.map((c) => plain(c.base ? c.base.manager : '')) }
      ];
      this.setData({ rows, names: cols.map((c) => c.name), loading: false });
    } catch (e) {
      console.error('对比加载失败:', e);
      this.setData({ loading: false });
    }
  }
})
