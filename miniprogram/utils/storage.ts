// 本地存储工具类
const OPTIONAL_FUNDS_KEY = 'optional_funds';
const HOLDING_FUNDS_KEY = 'holding_funds';
const IMPORTED_HOLDINGS_KEY = 'imported_holdings'; // 新增：从截图导入的持仓

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

// 新增：从截图导入的持仓数据结构
export interface ImportedHolding {
  code: string;
  name: string;
  amount: number; // 导入时刻的持有金额（截图快照，不再用于实时计算）
  profit: number; // 导入时刻的累计持有收益（截图快照）
  profitRate: number; // 收益率（截图快照）
  importTime: number; // 导入时间
  // 锚定字段：导入时一次性计算并保存，之后所有实时计算都基于这里
  shares?: number; // 持有份额（amount / importNetValue），导入时锚定
  importNetValue?: number; // 导入瞬间的基金单位净值
  cost?: number; // 持仓成本单价 = (amount - profit) / shares
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
