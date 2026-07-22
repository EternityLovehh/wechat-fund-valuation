// calendar.ts - 收益日历 / 月度统计
// 数据来自 utils/history 的每日资产快照(totalDayProfit=当日估算收益)。
// 快照从"数据快照地基"上线后开始按天累积，早于此的日期无数据(显示"-")。
import { getPortfolioHistory, PortfolioSnapshot, getEstimateAccuracySummary, EstimateAccuracy } from '../../utils/history'
import { getTodayStr } from '../../utils/appDate'

interface DayCell {
  id: number;          // wx:key 用
  day: number;         // 1-31；0 表示占位空格
  date: string;        // YYYY-MM-DD
  profit: number;      // 当日收益
  hasData: boolean;    // 是否有快照
  isToday: boolean;
}

Page({
  data: {
    year: 0,
    month: 0,           // 1-12
    monthLabel: '',     // "2026年7月"
    weekHeads: ['日', '一', '二', '三', '四', '五', '六'],
    cells: [] as DayCell[],
    monthProfit: 0,     // 本月收益合计
    monthWinDays: 0,    // 盈利天数
    monthLoseDays: 0,   // 亏损天数
    canGoNext: false,   // 是否允许翻到下个月(不超过当前月)
    // 总资产走势
    hasTrend: false,
    trendLatest: 0,     // 最新总市值
    trendFrom: '',      // 起始日期
    trendTo: '',        // 最新日期
    // 估值准确度
    hasAcc: false,
    accCount: 0,
    accAvgErr: 0,
    accRecords: [] as EstimateAccuracy[]
  },

  onLoad() {
    const today = getTodayStr();
    const [y, m] = today.split('-').map(Number);
    this.build(y, m);
    this.loadAccuracy();
  },

  // 估值准确度汇总（跨所有基金）
  loadAccuracy() {
    const s = getEstimateAccuracySummary(15);
    this.setData({
      hasAcc: s.count > 0,
      accCount: s.count,
      accAvgErr: s.avgErr,
      accRecords: s.records.map((r, i) => ({ ...r, id: i }))
    });
  },

  onReady() {
    this.drawTrend();
  },

  // 绘制总资产走势（取最近 60 个快照点，Canvas 2D 折线）
  drawTrend() {
    const history = getPortfolioHistory();
    const points = history.slice(-60); // 最近 60 天
    if (points.length < 2) {
      this.setData({ hasTrend: false });
      return;
    }
    this.setData({
      hasTrend: true,
      trendLatest: Number(points[points.length - 1].totalValue) || 0,
      trendFrom: points[0].date.slice(5),
      trendTo: points[points.length - 1].date.slice(5)
    });

    const query = wx.createSelectorQuery();
    query.select('#trendChart').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = (wx.getSystemInfoSync().pixelRatio) || 2;
      const W = res[0].width;
      const H = res[0].height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      const pad = { l: 8, r: 8, t: 12, b: 12 };
      const vals = points.map((p) => Number(p.totalValue) || 0);
      let min = Math.min(...vals);
      let max = Math.max(...vals);
      if (max === min) { max += 1; min -= 1; } // 防止除零
      const plotW = W - pad.l - pad.r;
      const plotH = H - pad.t - pad.b;
      const x = (i: number) => pad.l + (plotW * i) / (points.length - 1);
      const y = (v: number) => pad.t + plotH * (1 - (v - min) / (max - min));

      const up = vals[vals.length - 1] >= vals[0];
      const line = up ? '#e64340' : '#1aad19';
      const fill = up ? 'rgba(230,67,64,0.10)' : 'rgba(26,173,25,0.10)';

      // 面积
      ctx.beginPath();
      ctx.moveTo(x(0), y(vals[0]));
      for (let i = 1; i < vals.length; i++) ctx.lineTo(x(i), y(vals[i]));
      ctx.lineTo(x(vals.length - 1), pad.t + plotH);
      ctx.lineTo(x(0), pad.t + plotH);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      // 折线
      ctx.beginPath();
      ctx.moveTo(x(0), y(vals[0]));
      for (let i = 1; i < vals.length; i++) ctx.lineTo(x(i), y(vals[i]));
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 末点
      ctx.beginPath();
      ctx.arc(x(vals.length - 1), y(vals[vals.length - 1]), 3, 0, Math.PI * 2);
      ctx.fillStyle = line;
      ctx.fill();
    });
  },

  // 构建某年某月的日历
  build(year: number, month: number) {
    const history = getPortfolioHistory();
    const map: Record<string, number> = {};
    history.forEach((s: PortfolioSnapshot) => {
      map[s.date] = Number(s.totalDayProfit) || 0;
    });

    const todayStr = getTodayStr();
    const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0=周日
    const daysInMonth = new Date(year, month, 0).getDate();

    const cells: DayCell[] = [];
    // 月初前置空格
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ id: cells.length, day: 0, date: '', profit: 0, hasData: false, isToday: false });
    }
    let monthProfit = 0;
    let win = 0;
    let lose = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${`${month}`.padStart(2, '0')}-${`${d}`.padStart(2, '0')}`;
      const hasData = Object.prototype.hasOwnProperty.call(map, date);
      const profit = hasData ? map[date] : 0;
      if (hasData) {
        monthProfit += profit;
        if (profit > 0) win++;
        else if (profit < 0) lose++;
      }
      cells.push({ id: cells.length, day: d, date, profit, hasData, isToday: date === todayStr });
    }

    // 当前(真实)年月，用于禁止翻到未来
    const [ty, tm] = todayStr.split('-').map(Number);
    const canGoNext = year < ty || (year === ty && month < tm);

    this.setData({
      year,
      month,
      monthLabel: `${year}年${month}月`,
      cells,
      monthProfit,
      monthWinDays: win,
      monthLoseDays: lose,
      canGoNext
    });
  },

  prevMonth() {
    let { year, month } = this.data;
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
    this.build(year, month);
  },

  nextMonth() {
    if (!this.data.canGoNext) return;
    let { year, month } = this.data;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    this.build(year, month);
  }
})
