// 全局"当前日期"开关。
// 正常情况下 DATE_OVERRIDE = null，取真实当前日期。
// 调试时可临时固定成某天（如加仓确认中状态测试），测完务必改回 null。
const DATE_OVERRIDE: string | null = null; // 平时保持 null（取真实当前日期）；调试时可临时固定某天

export function getTodayStr(): string {
  if (DATE_OVERRIDE) return DATE_OVERRIDE;
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 是否正在使用调试覆盖日期（便于在 UI/日志上提示）
export function isDateOverridden(): boolean {
  return DATE_OVERRIDE !== null;
}
