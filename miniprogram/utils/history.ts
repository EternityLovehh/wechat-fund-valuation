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

// ===== 估值准确度：记录每只基金"当日估算涨跌" vs "实际公布净值涨跌"，供准确度回顾 =====
// 采集时机：盘中/盘后拿到估算(official/computed) → 记 est；当日净值公布(navchg) → 记 actual。
// 数据按天向前累积；早于本功能上线的日期无记录。
const ESTIMATE_ACC_KEY = `estimate_accuracy${envSuffix()}`;
const MAX_ACC_RECORDS = 800; // 约 40 只 × 20 天

export interface EstimateAccuracy {
  code: string;
  date: string;          // 交易日 YYYY-MM-DD（估值针对的那一天）
  est: number | null;    // 当日估算涨跌 %
  actual: number | null; // 当日实际净值涨跌 %（公布后）
}

export function getEstimateAccuracyAll(): EstimateAccuracy[] {
  try {
    const d = wx.getStorageSync(ESTIMATE_ACC_KEY);
    return Array.isArray(d) ? d : [];
  } catch (e) {
    return [];
  }
}

function saveEstimateAccuracy(list: EstimateAccuracy[]): void {
  try {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const trimmed = list.length > MAX_ACC_RECORDS ? list.slice(list.length - MAX_ACC_RECORDS) : list;
    wx.setStorageSync(ESTIMATE_ACC_KEY, trimmed);
  } catch (e) {
    // 忽略
  }
}

function upsertAccuracy(code: string, date: string, patch: Partial<EstimateAccuracy>): void {
  if (!code || !date) return;
  const list = getEstimateAccuracyAll();
  const i = list.findIndex((r) => r.code === code && r.date === date);
  if (i >= 0) {
    list[i] = { ...list[i], ...patch };
  } else {
    list.push({ code, date, est: null, actual: null, ...patch });
  }
  saveEstimateAccuracy(list);
}

// 记录当日估算涨跌（不覆盖已有 actual）
export function recordEstimateForecast(code: string, date: string, est: number): void {
  if (!Number.isFinite(est)) return;
  upsertAccuracy(code, date, { est });
}

// 记录当日实际净值涨跌（净值公布后）
export function recordEstimateActual(code: string, date: string, actual: number): void {
  if (!Number.isFinite(actual)) return;
  upsertAccuracy(code, date, { actual });
}

// 取某只基金近 N 条"估算与实际都齐全"的对比（最新在前），用于展示准确度
export function getEstimateAccuracy(code: string, limit: number = 10): EstimateAccuracy[] {
  return getEstimateAccuracyAll()
    .filter((r) => r.code === code && r.est != null && r.actual != null)
    .sort((a, b) => (a.date > b.date ? -1 : 1))
    .slice(0, limit);
}
