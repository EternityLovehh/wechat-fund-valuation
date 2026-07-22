// rank.ts - 基金排行（类型 × 周期）
import { getFundRankList, RankItem } from '../../utils/fundApi'
import { addOptionalFund } from '../../utils/storage'

const TYPES = [
  { ft: 'all', label: '全部' },
  { ft: 'gp', label: '股票' },
  { ft: 'hh', label: '混合' },
  { ft: 'zq', label: '债券' },
  { ft: 'zs', label: '指数' },
  { ft: 'qdii', label: 'QDII' }
];
const PERIODS = [
  { sc: '1yzf', label: '近1月' },
  { sc: '3yzf', label: '近3月' },
  { sc: '1nzf', label: '近1年' },
  { sc: 'jnzf', label: '今年来' },
  { sc: 'rzf', label: '日涨幅' }
];

Page({
  data: {
    types: TYPES,
    periods: PERIODS,
    ftIndex: 0,
    scIndex: 2, // 默认近1年
    list: [] as RankItem[],
    loading: false
  },

  onLoad() {
    this.load();
  },

  pickType(e: any) {
    this.setData({ ftIndex: Number(e.currentTarget.dataset.i) });
    this.load();
  },
  pickPeriod(e: any) {
    this.setData({ scIndex: Number(e.currentTarget.dataset.i) });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    const ft = TYPES[this.data.ftIndex].ft;
    const sc = PERIODS[this.data.scIndex].sc;
    const list = await getFundRankList(ft, sc, 30);
    this.setData({ list, loading: false });
  },

  goDetail(e: any) {
    wx.navigateTo({ url: `/pages/detail/detail?code=${e.currentTarget.dataset.code}` });
  },

  addFav(e: any) {
    const { code, name } = e.currentTarget.dataset;
    const ok = addOptionalFund(code, name);
    wx.showToast({ title: ok ? '已加自选' : '已在自选', icon: 'none' });
  }
})
