// calendar.ts - 收益日历 / 月度统计
// 数据来自 utils/history 的每日资产快照(totalDayProfit=当日估算收益)。
// 快照从"数据快照地基"上线后开始按天累积，早于此的日期无数据(显示"-")。
import { getPortfolioHistory, PortfolioSnapshot } from '../../utils/history'
import { getTodayStr } from '../../utils/appDate'

interface DayCell {
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
    canGoNext: false    // 是否允许翻到下个月(不超过当前月)
  },

  onLoad() {
    const today = getTodayStr();
    const [y, m] = today.split('-').map(Number);
    this.build(y, m);
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
      cells.push({ day: 0, date: '', profit: 0, hasData: false, isToday: false });
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
      cells.push({ day: d, date, profit, hasData, isToday: date === todayStr });
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
