// 基金涨跌提醒(全局版)
// 模型:一个开关 + 全局阈值,对所有持仓生效;云端每人每天最多推一条(取涨跌最猛的一只)。
// 微信限制:
//  1) wx.requestSubscribeMessage 必须由用户「点击」触发,不能在 onShow 里后台自动调用。
//  2) 一次授权 = 一次可发额度;勾选弹窗里「总是保持以上选择」后,后续授权不再弹窗(静默)。
// 因此:开关/续订走用户点击;持仓代码同步走后台(不需点击)。
const ALERT_TEMPLATE_ID = 'xKSDHWEZPtQaJq_73F5JVQk6UI8T8SlfmkILDfCLV_E';
const SETTINGS_KEY = 'fund_alert_settings';
const RENEW_KEY = 'fund_alert_last_renew';

import { getHoldingFunds, getImportedHoldings } from './storage'

export interface AlertSettings {
  enabled: boolean;
  upPct: number;   // 涨幅提醒线(正数,0=不设)
  downPct: number; // 跌幅提醒线(正数,0=不设)
}

// 北京日期 YYYY-MM-DD
function beijingToday(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function getAlertSettings(): AlertSettings {
  const s = wx.getStorageSync(SETTINGS_KEY);
  if (s && typeof s === 'object') {
    return { enabled: !!s.enabled, upPct: s.upPct == null ? 3 : s.upPct, downPct: s.downPct == null ? 3 : s.downPct };
  }
  return { enabled: false, upPct: 3, downPct: 3 };
}

function saveSettingsLocal(s: AlertSettings): void {
  wx.setStorageSync(SETTINGS_KEY, s);
}

// 今日是否已授权额度(本地节流,避免一天内重复弹窗/请求)
export function isRenewedToday(): boolean {
  return wx.getStorageSync(RENEW_KEY) === beijingToday();
}

// 汇总当前持仓(手动 + 导入)的 6 位代码与名称
function collectHoldings(): { codes: string[]; names: Record<string, string> } {
  const names: Record<string, string> = {};
  try {
    for (const h of getHoldingFunds()) if (/^\d{6}$/.test(h.code)) names[h.code] = h.name || h.code;
  } catch (e) { /* ignore */ }
  try {
    for (const h of getImportedHoldings()) if (/^\d{6}$/.test(h.code)) names[h.code] = h.name || h.code;
  } catch (e) { /* ignore */ }
  return { codes: Object.keys(names), names };
}

// 请求一次订阅授权(必须在用户点击回调链中调用)。勾了「总是保持」则静默返回。
function requestSubscribe(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [ALERT_TEMPLATE_ID],
      success: (res: any) => resolve(res[ALERT_TEMPLATE_ID] === 'accept'),
      fail: () => resolve(false)
    });
  });
}

// 上传设置 + 持仓代码到云端;grantOne=true 时额度+1
function pushToCloud(s: AlertSettings, grantOne: boolean): Promise<boolean> {
  const { codes, names } = collectHoldings();
  return wx.cloud
    .callFunction({ name: 'saveAlert', data: { enabled: s.enabled, upPct: s.upPct, downPct: s.downPct, codes, names, grantOne } })
    .then((r: any) => !!(r && r.result && r.result.success))
    .catch(() => false);
}

// 开启提醒(用户点击):请求授权 + 保存设置 + 上传持仓 + 额度+1
export async function enableAlert(upPct: number, downPct: number): Promise<'ok' | 'rejected' | 'fail'> {
  const accepted = await requestSubscribe();
  const s: AlertSettings = { enabled: true, upPct, downPct };
  saveSettingsLocal(s);
  const ok = await pushToCloud(s, accepted);
  if (accepted) wx.setStorageSync(RENEW_KEY, beijingToday());
  if (!ok) return 'fail';
  return accepted ? 'ok' : 'rejected';
}

// 关闭提醒(用户点击):仅更新设置,不动额度
export async function disableAlert(): Promise<boolean> {
  const s = getAlertSettings();
  const next: AlertSettings = { ...s, enabled: false };
  saveSettingsLocal(next);
  return pushToCloud(next, false);
}

// 仅更新阈值(不需点击,不弹窗,不动额度)
export async function updateThreshold(upPct: number, downPct: number): Promise<void> {
  const s = getAlertSettings();
  const next: AlertSettings = { enabled: s.enabled, upPct, downPct };
  saveSettingsLocal(next);
  if (next.enabled) await pushToCloud(next, false);
}

// 续订今日额度(用户点击;勾了「总是保持」则静默)。返回是否成功拿到额度。
export async function renewQuota(): Promise<boolean> {
  const s = getAlertSettings();
  if (!s.enabled) return false;
  const accepted = await requestSubscribe();
  await pushToCloud(s, accepted);
  if (accepted) wx.setStorageSync(RENEW_KEY, beijingToday());
  return accepted;
}

// 后台同步持仓代码/设置到云端(不需点击,可在 onShow 调用)。保证 checkAlerts 针对最新持仓。
export async function syncCodesSilently(): Promise<void> {
  const s = getAlertSettings();
  if (!s.enabled) return;
  await pushToCloud(s, false);
}

// 报告页「订阅每日推送」:请求一次授权并给云端额度+1。
// 与涨跌提醒共用模板与 quota 池;不改动 enabled/阈值(沿用当前本地设置原样上传)。
export async function grantReportQuota(): Promise<boolean> {
  const accepted = await requestSubscribe();
  await pushToCloud(getAlertSettings(), accepted);
  if (accepted) wx.setStorageSync(RENEW_KEY, beijingToday());
  return accepted;
}
