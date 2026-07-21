// 交易日历：A 股节假日休市判定（纯函数，不依赖 wx，可单测）。
// 数据每年手动更新：国务院放假安排 / 交易所休市公告公布后，补充下一年份。
// 仅登记"落在工作日的休市日"——周末由 getDay 处理无需登记；调休上班日股市照常休市，也无需登记。

// A 股节假日休市日（YYYY-MM-DD，仅工作日）。
// 来源：上海证券交易所《关于2026年部分节假日休市安排的通知》(2025-12-22)。
const MARKET_HOLIDAYS: Record<string, string[]> = {
  '2026': [
    '2026-01-01', '2026-01-02',                                                          // 元旦
    '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',  // 春节
    '2026-04-06',                                                                         // 清明节
    '2026-05-01', '2026-05-04', '2026-05-05',                                             // 劳动节
    '2026-06-19',                                                                         // 端午节
    '2026-09-25',                                                                         // 中秋节
    '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'                 // 国庆节
  ]
  // 每年维护：2027 年放假安排公布后在此补充。未登记的年份会自动降级为"仅按周末判定"。
};

function toDateStr(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 是否 A 股节假日休市（周末不计入此表，返回 false；未登记年份优雅降级返回 false）
export function isMarketHoliday(date: Date = new Date()): boolean {
  const list = MARKET_HOLIDAYS[`${date.getFullYear()}`];
  if (!list) return false;
  return list.indexOf(toDateStr(date)) !== -1;
}

// 是否交易日：非周末 且 非节假日
export function isTradingDay(date: Date = new Date()): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  return !isMarketHoliday(date);
}
