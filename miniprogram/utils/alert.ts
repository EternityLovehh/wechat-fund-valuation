// 基金涨跌提醒：一次性订阅消息授权 + 记录阈值到云端。
// 微信限制：一次授权只能发一条；用户需再次点开启才能续订。
const ALERT_TEMPLATE_ID = 'xKSDHWEZPtQaJq_73F5JVQk6UI8T8SlfmkILDfCLV_E';

// 请求订阅并记录阈值。upPct/downPct 为百分比正数(如 3 表示涨/跌 3%)，传 0 表示不设该方向。
export function enableFundAlert(
  code: string,
  name: string,
  upPct: number,
  downPct: number
): Promise<'ok' | 'rejected' | 'fail'> {
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [ALERT_TEMPLATE_ID],
      success: (res: any) => {
        if (res[ALERT_TEMPLATE_ID] !== 'accept') {
          resolve('rejected');
          return;
        }
        wx.cloud
          .callFunction({ name: 'saveAlert', data: { code, name, upPct, downPct } })
          .then((r: any) => resolve(r && r.result && r.result.success ? 'ok' : 'fail'))
          .catch(() => resolve('fail'));
      },
      fail: () => resolve('fail')
    });
  });
}
