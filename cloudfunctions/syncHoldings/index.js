// 云函数:持仓快照上云(一个用户一条,_id=openid),供 aiReport 定时生成时读取。
// event.clear === true 时清空该用户持仓快照(清仓场景),供小程序端清仓后同步。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { sanitizeHoldings } = require('./lib/sanitize');

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { success: false, error: '无 openid' };
  const col = db.collection('user_holdings');
  if (event.clear === true) {
    try {
      await col.doc(OPENID).set({ data: { openid: OPENID, holdings: [], updatedAt: Date.now() } });
      return { success: true, count: 0 };
    } catch (e) {
      return { success: false, error: (e && e.message) || String(e) };
    }
  }
  const holdings = sanitizeHoldings(event.holdings);
  if (!holdings) return { success: false, error: '持仓为空或非法' };
  const data = { openid: OPENID, holdings, updatedAt: Date.now() };
  try {
    const existing = await col.doc(OPENID).get().catch(() => null);
    if (existing && existing.data) await col.doc(OPENID).update({ data });
    else await col.doc(OPENID).set({ data });
    return { success: true, count: holdings.length };
  } catch (e) {
    return { success: false, error: (e && e.message) || String(e) };
  }
};
