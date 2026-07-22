// 云函数：记录/更新用户的基金涨跌提醒订阅
// 前端 wx.requestSubscribeMessage 授权成功后调用；一次授权 = 一次可发额度(quota+1)。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { code, name, upPct, downPct } = event;
  if (!OPENID) return { success: false, error: '无 openid' };
  if (!/^\d{6}$/.test(code || '')) return { success: false, error: '无效基金代码' };

  const col = db.collection('fund_alerts');
  const _id = `${OPENID}_${code}`;
  const up = Number(upPct);
  const down = Number(downPct);

  try {
    const existing = await col.doc(_id).get().catch(() => null);
    if (existing && existing.data) {
      // 已存在：更新阈值，并把可发额度 +1
      await col.doc(_id).update({
        data: {
          name: name || existing.data.name || code,
          upPct: isNaN(up) ? null : up,
          downPct: isNaN(down) ? null : down,
          quota: _.inc(1),
          updatedAt: Date.now()
        }
      });
    } else {
      await col.doc(_id).set({
        data: {
          openid: OPENID,
          code,
          name: name || code,
          upPct: isNaN(up) ? null : up,
          downPct: isNaN(down) ? null : down,
          quota: 1,
          createdAt: Date.now()
        }
      });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: (e && e.message) || String(e) };
  }
};
