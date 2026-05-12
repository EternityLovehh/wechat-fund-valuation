// 基金API工具类 - 云函数版本
export interface FundInfo {
  code: string;
  name: string;
  type: string;
  netValue: number;
  estimatedValue: number;
  estimatedGrowth: number;
  dayGrowth: number;
  updateTime: string;
}

// 使用云函数获取基金实时估值
export async function getFundEstimate(code: string): Promise<FundInfo> {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'getFund',
      data: { code }
    }).then((res: any) => {
      if (res.result.success) {
        const data = res.result.data;
        resolve({
          ...data,
          type: getFundType(data.code),
          dayGrowth: data.estimatedGrowth
        });
      } else {
        reject(new Error(res.result.error));
      }
    }).catch(reject);
  });
}

// 批量获取基金估值
export async function getBatchFundEstimate(codes: string[]): Promise<FundInfo[]> {
  const results = await Promise.allSettled(codes.map(code => getFundEstimate(code)));
  return results
    .filter((r): r is PromiseFulfilledResult<FundInfo> => r.status === 'fulfilled')
    .map(r => r.value);
}

// 使用云函数搜索基金
export async function searchFund(keyword: string): Promise<FundInfo[]> {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'searchFund',
      data: { keyword }
    }).then((res: any) => {
      if (res.result.success) {
        const funds = res.result.data.map((f: any) => ({
          ...f,
          type: getFundType(f.code),
          dayGrowth: f.estimatedGrowth
        }));
        resolve(funds);
      } else {
        reject(new Error(res.result.error));
      }
    }).catch(reject);
  });
}

// 根据基金代码判断基金类型
function getFundType(code: string): string {
  const firstChar = code.charAt(0);
  switch (firstChar) {
    case '0':
    case '1':
      return '股票型';
    case '2':
      return '债券型';
    case '3':
      return '混合型';
    case '4':
      return '指数型';
    case '5':
      return 'QDII';
    case '6':
      return 'LOF';
    default:
      return '其他';
  }
}
