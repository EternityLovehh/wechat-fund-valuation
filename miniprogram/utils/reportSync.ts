// 持仓快照上云(供 aiReport 定时生成读取):合并手动持仓与截图导入(已确认部分),
// 内容 hash 无变化不重复调用云函数。key 带环境后缀,与 storage.ts 隔离策略一致。
import { getHoldingFunds, getImportedHoldings } from './storage'

export interface UnifiedHolding { code: string; name: string; shares: number; cost: number }

function envSuffix(): string {
  try {
    const env = wx.getAccountInfoSync().miniProgram.envVersion;
    return env && env !== 'release' ? `__${env}` : '';
  } catch (e) { return ''; }
}
const HASH_KEY = `report_holdings_hash${envSuffix()}`;

export function collectUnifiedHoldings(): UnifiedHolding[] {
  const map = new Map<string, UnifiedHolding>();
  try {
    for (const h of getHoldingFunds()) {
      if (/^\d{6}$/.test(h.code) && h.shares > 0 && h.cost > 0)
        map.set(h.code, { code: h.code, name: h.name || h.code, shares: h.shares, cost: h.cost });
    }
  } catch (e) { /* ignore */ }
  try {
    for (const h of getImportedHoldings()) {
      // 只取已确认锚定部分;同代码手动持仓优先
      if (!map.has(h.code) && /^\d{6}$/.test(h.code) && (h.shares || 0) > 0 && (h.cost || 0) > 0)
        map.set(h.code, { code: h.code, name: h.name || h.code, shares: h.shares as number, cost: h.cost as number });
    }
  } catch (e) { /* ignore */ }
  return [...map.values()];
}

function hashOf(list: UnifiedHolding[]): string {
  const s = list
    .slice().sort((a, b) => (a.code < b.code ? -1 : 1))
    .map((h) => `${h.code}:${h.shares}:${h.cost}`).join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

// 静默同步(可在 onShow/loadHoldings 后调):失败忽略,下次自然重试
export async function syncHoldingsToCloud(): Promise<void> {
  const holdings = collectUnifiedHoldings();
  if (!holdings.length) return;
  const hash = hashOf(holdings);
  try { if (wx.getStorageSync(HASH_KEY) === hash) return; } catch (e) { /* ignore */ }
  try {
    const r: any = await wx.cloud.callFunction({ name: 'syncHoldings', data: { holdings } });
    if (r && r.result && r.result.success) wx.setStorageSync(HASH_KEY, hash);
  } catch (e) { /* ignore:静默失败 */ }
}
