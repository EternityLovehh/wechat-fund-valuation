// 本地存储工具类
// 开发版/体验版/正式版共用同一 appid、同一本地缓存空间，数据会互相串。
// 按运行环境给 key 加后缀做隔离：开发版→__develop、体验版→__trial；
// 正式版保持原始 key（兼容老数据、不丢正式用户数据）。
function envSuffix(): string {
  try {
    const env = wx.getAccountInfoSync().miniProgram.envVersion;
    return env && env !== 'release' ? `__${env}` : '';
  } catch (e) {
    return '';
  }
}
const ENV_SUFFIX = envSuffix();

const BASE_OPTIONAL_KEY = 'optional_funds';
const BASE_HOLDING_KEY = 'holding_funds';
const BASE_IMPORTED_KEY = 'imported_holdings';

const OPTIONAL_FUNDS_KEY = `${BASE_OPTIONAL_KEY}${ENV_SUFFIX}`;
const HOLDING_FUNDS_KEY = `${BASE_HOLDING_KEY}${ENV_SUFFIX}`;
const IMPORTED_HOLDINGS_KEY = `${BASE_IMPORTED_KEY}${ENV_SUFFIX}`; // 从截图导入的持仓

// 一次性迁移：加 key 后缀前，数据都存在原始 key 下。
// 首次（且仅首次）把原始数据拷到当前环境的新 key，避免开发/体验版"看起来数据丢了"还要重导。
// 用 migrated 标记保证只迁移一次——否则每次加载、尤其是用户"清空"后新 key 为空时，
// 会反复把旧的共享数据拷回来，表现就像"隔离失效 / 删掉的数据又回来了"。
(function migrateLegacyStorage() {
  if (!ENV_SUFFIX) return; // 正式版用原始 key，无需迁移
  const MIGRATED_FLAG = `__migrated${ENV_SUFFIX}`;
  try {
    if (wx.getStorageSync(MIGRATED_FLAG)) return; // 已迁移过，绝不再拷（清空后也不会复活旧数据）
  } catch (e) {
    return;
  }
  const hasData = (v: any) => (Array.isArray(v) ? v.length > 0 : !!v);
  const pairs: Array<[string, string]> = [
    [BASE_OPTIONAL_KEY, OPTIONAL_FUNDS_KEY],
    [BASE_HOLDING_KEY, HOLDING_FUNDS_KEY],
    [BASE_IMPORTED_KEY, IMPORTED_HOLDINGS_KEY]
  ];
  for (const [baseKey, envKey] of pairs) {
    try {
      if (hasData(wx.getStorageSync(envKey))) continue; // 新 key 已有数据，不覆盖
      const legacy = wx.getStorageSync(baseKey);
      if (hasData(legacy)) wx.setStorageSync(envKey, legacy);
    } catch (e) {
      // 忽略单条迁移失败
    }
  }
  try {
    wx.setStorageSync(MIGRATED_FLAG, true);
  } catch (e) {
    // 忽略
  }
})();

export interface OptionalFund {
  code: string;
  name: string;
  addTime: number;
}

export interface HoldingFund {
  code: string;
  name: string;
  shares: number; // 持有份额
  cost: number; // 成本价
  buyRecords: BuyRecord[]; // 购买记录
}

// 一笔待确认加仓（申购确认净值发布前不计任何收益）
export interface PendingAdd {
  amount: number; // 加仓金额（申购金额）
  date: string;   // 申购申请日 YYYY-MM-DD（确认净值即该日净值）
}

// 新增：从截图导入的持仓数据结构
export interface ImportedHolding {
  code: string;
  name: string;
  importTime: number; // 导入时间
  // ===== 已确认部分锚定 =====
  // 之后所有实时计算（持有金额/收益/今日收益）都基于这里
  shares?: number; // 已确认持有份额
  cost?: number; // 已确认成本单价（总成本 / 份额）
  importNetValue?: number; // 锚定时使用的基金单位净值
  // ===== 待确认加仓 =====
  // 申购确认前只显示金额、不算任何收益；确认日（净值日期 ≥ date）按当日净值折份额并入已确认部分
  pendingAdds?: PendingAdd[];
  // ===== 兼容/快照字段（旧数据 + 锚定失败时的兜底显示）=====
  amount?: number; // 导入时刻的持有金额（截图快照）
  profit?: number; // 导入时刻的累计持有收益（截图快照）
  profitRate?: number; // 收益率（截图快照）
  // 旧版整仓待确认标记，仅用于迁移成 pendingAdds，新代码不再写入
  pending?: boolean;
  importDate?: string; // 导入/买入日期 YYYY-MM-DD（旧数据迁移用）
}

export interface BuyRecord {
  date: string;
  shares: number;
  price: number;
  type: 'buy' | 'sell';
}

// 获取自选基金列表
export function getOptionalFunds(): OptionalFund[] {
  try {
    const data = wx.getStorageSync(OPTIONAL_FUNDS_KEY);
    return data || [];
  } catch (e) {
    return [];
  }
}

// 添加自选基金
export function addOptionalFund(code: string, name: string): boolean {
  try {
    const funds = getOptionalFunds();
    if (funds.some(f => f.code === code)) {
      return false; // 已存在
    }
    funds.push({ code, name, addTime: Date.now() });
    wx.setStorageSync(OPTIONAL_FUNDS_KEY, funds);
    return true;
  } catch (e) {
    return false;
  }
}

// 删除自选基金
export function removeOptionalFund(code: string): boolean {
  try {
    const funds = getOptionalFunds();
    const filtered = funds.filter(f => f.code !== code);
    wx.setStorageSync(OPTIONAL_FUNDS_KEY, filtered);
    return true;
  } catch (e) {
    return false;
  }
}

// 获取持仓基金列表
export function getHoldingFunds(): HoldingFund[] {
  try {
    const data = wx.getStorageSync(HOLDING_FUNDS_KEY);
    return data || [];
  } catch (e) {
    return [];
  }
}

// 添加或更新持仓
export function updateHolding(code: string, name: string, shares: number, price: number, type: 'buy' | 'sell'): boolean {
  try {
    const funds = getHoldingFunds();
    const index = funds.findIndex(f => f.code === code);
    
    const record: BuyRecord = {
      date: new Date().toLocaleDateString('zh-CN'),
      shares,
      price,
      type
    };
    
    if (index >= 0) {
      // 更新现有持仓
      const fund = funds[index];
      fund.buyRecords.push(record);
      
      if (type === 'buy') {
        const totalCost = fund.shares * fund.cost + shares * price;
        fund.shares += shares;
        fund.cost = totalCost / fund.shares;
      } else {
        fund.shares -= shares;
        if (fund.shares <= 0) {
          funds.splice(index, 1);
        }
      }
    } else if (type === 'buy') {
      // 新增持仓
      funds.push({
        code,
        name,
        shares,
        cost: price,
        buyRecords: [record]
      });
    }
    
    wx.setStorageSync(HOLDING_FUNDS_KEY, funds);
    return true;
  } catch (e) {
    return false;
  }
}

// 删除持仓
export function removeHolding(code: string): boolean {
  try {
    const funds = getHoldingFunds();
    const filtered = funds.filter(f => f.code !== code);
    wx.setStorageSync(HOLDING_FUNDS_KEY, filtered);
    return true;
  } catch (e) {
    return false;
  }
}

// ========== 导入持仓相关方法 ==========

// 获取导入的持仓列表
export function getImportedHoldings(): ImportedHolding[] {
  try {
    const data = wx.getStorageSync(IMPORTED_HOLDINGS_KEY);
    return data || [];
  } catch (e) {
    return [];
  }
}

// 添加或更新导入的持仓
export function saveImportedHolding(holding: ImportedHolding): boolean {
  try {
    const holdings = getImportedHoldings();
    const index = holdings.findIndex(h => h.code === holding.code);
    
    if (index >= 0) {
      // 更新现有持仓
      holdings[index] = holding;
    } else {
      // 新增持仓
      holdings.push(holding);
    }
    
    wx.setStorageSync(IMPORTED_HOLDINGS_KEY, holdings);
    return true;
  } catch (e) {
    return false;
  }
}

// 批量保存导入的持仓
export function saveImportedHoldings(holdings: ImportedHolding[]): boolean {
  try {
    const existingHoldings = getImportedHoldings();
    
    holdings.forEach(newHolding => {
      const index = existingHoldings.findIndex(h => h.code === newHolding.code);
      if (index >= 0) {
        existingHoldings[index] = newHolding;
      } else {
        existingHoldings.push(newHolding);
      }
    });
    
    wx.setStorageSync(IMPORTED_HOLDINGS_KEY, existingHoldings);
    return true;
  } catch (e) {
    return false;
  }
}

// 删除导入的持仓
export function removeImportedHolding(code: string): boolean {
  try {
    const holdings = getImportedHoldings();
    const filtered = holdings.filter(h => h.code !== code);
    wx.setStorageSync(IMPORTED_HOLDINGS_KEY, filtered);
    return true;
  } catch (e) {
    return false;
  }
}

// 清空所有导入的持仓
export function clearImportedHoldings(): boolean {
  try {
    wx.setStorageSync(IMPORTED_HOLDINGS_KEY, []);
    return true;
  } catch (e) {
    return false;
  }
}
