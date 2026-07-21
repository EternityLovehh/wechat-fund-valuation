// 每日数据快照：记录每天的持仓总市值/收益，供"总资产走势图"和"收益日历/月度统计"使用。
// 与 storage.ts 一致，按运行环境(开发/体验/正式)隔离 key，避免多环境串数据。
import { getTodayStr } from './appDate'

function envSuffix(): string {
  try {
    const env = wx.getAccountInfoSync().miniProgram.envVersion;
    return env && env !== 'release' ? `__${env}` : '';
  } catch (e) {
    return '';
  }
}
const PORTFOLIO_HISTORY_KEY = `portfolio_history${envSuffix()}`;
const MAX_DAYS = 400; // 约一年半，够画走势/日历，且不无限增长

export interface PortfolioSnapshot {
  date: string;           // YYYY-MM-DD
  totalValue: number;     // 持仓总市值（已确认净值口径）
  totalCost: number;      // 总成本
  totalProfit: number;    // 累计收益
  totalDayProfit: number; // 当日收益
}

export function getPortfolioHistory(): PortfolioSnapshot[] {
  try {
    const d = wx.getStorageSync(PORTFOLIO_HISTORY_KEY);
    return Array.isArray(d) ? d : [];
  } catch (e) {
    return [];
  }
}

// 记录/更新"某天"(默认今天)的快照：同一天多次刷新用最新值覆盖(upsert)。
// 按日期升序保存，超过 MAX_DAYS 截断最旧的。记录失败静默，不影响主流程。
export function recordPortfolioSnapshot(
  snap: Omit<PortfolioSnapshot, 'date'>,
  date: string = getTodayStr()
): void {
  try {
    const list = getPortfolioHistory();
    const rec: PortfolioSnapshot = { date, ...snap };
    const i = list.findIndex((s) => s.date === date);
    if (i >= 0) list[i] = rec;
    else list.push(rec);
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const trimmed = list.length > MAX_DAYS ? list.slice(list.length - MAX_DAYS) : list;
    wx.setStorageSync(PORTFOLIO_HISTORY_KEY, trimmed);
  } catch (e) {
    // 忽略：快照记录失败不影响页面
  }
}
