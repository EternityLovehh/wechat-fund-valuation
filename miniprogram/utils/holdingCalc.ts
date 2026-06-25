// 持仓计算纯逻辑（不依赖 wx，可单独单测）
// 负责：交易记录解析、待确认加仓的结算/并入、导入持仓的实时显示计算、旧数据迁移
import { ImportedHolding, PendingAdd } from './storage'

// ===== 交易记录解析 =====

export interface TxRecord {
  action: 'buy' | 'sell';
  name: string;       // 基金名称（用于后续搜索代码）
  amount: number;     // 金额（元）
  date: string;       // 申请日 YYYY-MM-DD
  datetime: string;   // 完整时间，用于排序
  status: 'confirmed' | 'pending' | 'closed';
}

// 从一段（OCR 或粘贴的）交易记录文本中解析出每笔交易。
// 以「买入/卖出/申购/赎回」作为每条记录的起始锚点，按块切分，块内再抽取金额/日期/状态/名称，
// 这样对 OCR 把一条记录拆成多行、行序错乱都更稳。
export function parseTransactionRecords(text: string): TxRecord[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const isStart = (l: string) => /(买入|卖出|申购|赎回)/.test(l);

  const blocks: string[][] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    if (isStart(line)) {
      if (cur) blocks.push(cur);
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) blocks.push(cur);

  const records: TxRecord[] = [];
  for (const block of blocks) {
    const joined = block.join(' ');
    const action: 'buy' | 'sell' = /(卖出|赎回)/.test(joined) ? 'sell' : 'buy';

    const dtMatch = joined.match(/(\d{4}-\d{2}-\d{2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/);
    const date = dtMatch ? dtMatch[1] : '';
    const datetime = dtMatch ? dtMatch[0] : '';

    // 金额：优先「数字+元」，否则取块内最后一个两位小数金额
    let amount = 0;
    const amtYuan = joined.match(/([\d,]+\.\d{2})\s*元/);
    if (amtYuan) {
      amount = parseFloat(amtYuan[1].replace(/,/g, ''));
    } else {
      const nums = joined.match(/[\d,]+\.\d{2}/g);
      if (nums && nums.length) amount = parseFloat(nums[nums.length - 1].replace(/,/g, ''));
    }

    let status: TxRecord['status'] = 'confirmed';
    if (/(进行中|确认中)/.test(joined)) status = 'pending';
    else if (/(关闭|失败|撤单|已撤|取消)/.test(joined)) status = 'closed';

    const name = extractTxFundName(block);

    if (name && amount > 0 && date) {
      records.push({ action, name, amount, date, datetime, status });
    }
  }
  return records;
}

// 从交易记录块中抽取基金名称：剔除日期、金额、动作/状态等关键词与分隔符后，剩下的即名称
function extractTxFundName(block: string[]): string {
  let s = block.join(' ');
  s = s.replace(/\d{4}-\d{2}-\d{2}(\s+\d{1,2}:\d{2}(:\d{2})?)?/g, ' '); // 日期时间
  s = s.replace(/[\d,]+\.\d{2}\s*元?/g, ' ');                            // 金额
  s = s.replace(/(买入|卖出|申购|赎回|交易进行中|交易关闭|进行中|确认中|关闭|失败|撤单|已撤|取消|基金|元)/g, ' ');
  s = s.replace(/[|丨\\/\s]+/g, ''); // 分隔符与空白（| 常被 OCR 成 丨）
  return s.trim();
}

// ===== 由交易记录构建一只基金的持仓 =====
// records: 同一只基金的全部交易；navByDate: 申请日 -> 该日已确认净值（0/缺失=未发布）
export function buildHoldingFromTxns(
  code: string,
  name: string,
  records: TxRecord[],
  navByDate: Record<string, number>,
  importTime: number,
  fallbackNav: number = 0 // 历史净值查不到时的兜底净值（一般传当前净值）
): ImportedHolding {
  let costTotal = 0; // 已确认部分累计成本
  let shares = 0;    // 已确认份额
  const pendingAdds: PendingAdd[] = [];

  // 按时间顺序处理，保证先买后卖
  const sorted = [...records].sort((a, b) => (a.datetime < b.datetime ? -1 : 1));
  for (const r of sorted) {
    if (r.status === 'closed') continue;
    if (r.action === 'buy') {
      if (r.status === 'pending') {
        // 真正"进行中"才挂待确认（确认前不算收益）
        pendingAdds.push({ amount: r.amount, date: r.date });
      } else {
        // 已确认买入：优先用申请日历史净值；查不到则退回当前净值近似，
        // 保持"已确认"状态，绝不因查不到净值就误判成确认中
        const nav = navByDate[r.date] > 0 ? navByDate[r.date] : fallbackNav;
        if (nav > 0) {
          shares += r.amount / nav;
          costTotal += r.amount;
        } else {
          pendingAdds.push({ amount: r.amount, date: r.date });
        }
      }
    } else {
      // 卖出：按申请日净值（查不到退回当前净值）折份额扣减，成本单价保持不变
      const nav = navByDate[r.date] > 0 ? navByDate[r.date] : fallbackNav;
      if (nav > 0 && shares > 0) {
        const sellShares = Math.min(shares, r.amount / nav);
        const ratio = sellShares / shares;
        costTotal -= costTotal * ratio;
        shares -= sellShares;
      }
    }
  }

  const cost = shares > 0 ? costTotal / shares : 0;
  const pendingAmount = pendingAdds.reduce((s, a) => s + a.amount, 0);
  return {
    code,
    name,
    importTime,
    shares,
    cost,
    importNetValue: 0,
    pendingAdds,
    // 快照兜底：成本口径的金额
    amount: shares * cost + pendingAmount,
    profit: 0,
    profitRate: 0
  };
}

// ===== 待确认加仓结算：净值已发布的 lot 折成份额并入已确认部分 =====
export interface SettleResult {
  shares: number;
  cost: number;            // 成本单价
  pendingAdds: PendingAdd[];
  changed: boolean;
}

// navByDate: 加仓日 -> 该日已确认净值（>0 表示已发布、可确认）
export function settlePendingAdds(
  shares: number,
  cost: number,
  pendingAdds: PendingAdd[],
  navByDate: Record<string, number>
): SettleResult {
  let curShares = shares || 0;
  let costTotal = (shares || 0) * (cost || 0);
  const remaining: PendingAdd[] = [];
  let changed = false;

  for (const add of pendingAdds || []) {
    const nav = navByDate[add.date];
    if (nav && nav > 0) {
      curShares += add.amount / nav;
      costTotal += add.amount;
      changed = true;
    } else {
      remaining.push(add);
    }
  }

  const newCost = curShares > 0 ? costTotal / curShares : 0;
  return { shares: curShares, cost: newCost, pendingAdds: remaining, changed };
}

// ===== 导入持仓的实时显示计算 =====
export interface ImportedDisplayCalc {
  holdingAmount: number;        // 持有金额 = 已确认市值 + 待确认金额
  confirmedMarketValue: number; // 已确认市值
  pendingAmount: number;        // 待确认加仓金额合计
  totalCost: number;            // 已确认成本
  profit: number;               // 持有收益（仅已确认部分）
  profitRate: number;           // 收益率（仅已确认部分）
  todayProfit: number;          // 今日收益（仅已确认部分）
}

export function computeImportedDisplay(
  shares: number,
  cost: number,
  pendingAdds: PendingAdd[],
  netValue: number,
  estimatedValue: number
): ImportedDisplayCalc {
  const pendingAmount = (pendingAdds || []).reduce((s, a) => s + a.amount, 0);
  const valuationPrice = netValue || estimatedValue || 0;
  const confirmedMarketValue = shares > 0 ? shares * valuationPrice : 0;
  const totalCost = shares > 0 ? shares * cost : 0;
  const holdingAmount = confirmedMarketValue + pendingAmount;
  const profit = shares > 0 ? confirmedMarketValue - totalCost : 0;
  const profitRate = totalCost > 0 ? (profit / totalCost) * 100 : 0;
  // 今日收益只算已确认份额；待确认那截没确认净值，今天贡献 0
  const todayProfit = shares > 0 && estimatedValue > 0 && netValue > 0
    ? shares * (estimatedValue - netValue)
    : 0;

  return { holdingAmount, confirmedMarketValue, pendingAmount, totalCost, profit, profitRate, todayProfit };
}

// ===== 旧数据迁移：把旧的整仓 pending / 无 pendingAdds 的记录规整成新结构 =====
export function normalizeHolding(h: ImportedHolding): ImportedHolding {
  if (Array.isArray(h.pendingAdds)) return h; // 已是新结构

  const out: ImportedHolding = { ...h, pendingAdds: [] };
  if (h.pending) {
    // 旧版整仓待确认 → 一笔待确认加仓，无已确认份额
    out.pendingAdds = [{ amount: h.amount || 0, date: h.importDate || '' }];
    out.shares = 0;
    out.cost = 0;
  }
  // 旧版非待确认：保留已锚定的 shares/cost；没有则留空，由 holding.ts 用 amount/净值补锚定
  out.pending = false;
  return out;
}
