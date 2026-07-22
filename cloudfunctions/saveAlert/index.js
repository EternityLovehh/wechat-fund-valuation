// 云函数:保存用户的「全局涨跌提醒」设置(一个用户一条文档,_id = openid)
// 前端调用场景:
//  - 开启/关闭开关、修改阈值:更新 enabled/upPct/downPct/codes/names
//  - 用户点击授权成功(grantOne=true):额度 quota +1(封顶 15,避免无限累积)
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const QUOTA_CAP = 15;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { success: false, error: '无 openid' };

  const { enabled, upPct, downPct, codes, names, grantOne } = event;
  const col = db.collection('fund_alerts');
  const _id = OPENID;
  const up = Number(upPct);
  const down = Number(downPct);
  const cleanCodes = Array.isArray(codes)
    ? codes.filter((c) => /^\d{6}$/.test(c)).slice(0, 100)
    : undefined;

  try {
    const existing = await col.doc(_id).get().catch(() => null);

    const data = { openid: OPENID, enabled: enabled !== false, updatedAt: Date.now() };
    if (!isNaN(up)) data.upPct = up;
    if (!isNaN(down)) data.downPct = down;
    if (cleanCodes) data.codes = cleanCodes;
    if (names && typeof names === 'object') data.names = names;

    if (existing && existing.data) {
      const upd = Object.assign({}, data);
      const cur = existing.data.quota || 0;
      if (grantOne && cur < QUOTA_CAP) upd.quota = _.inc(1);
      await col.doc(_id).update({ data: upd });
    } else {
      await col.doc(_id).set({
        data: Object.assign({}, data, { quota: grantOne ? 1 : 0, createdAt: Date.now() })
      });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: (e && e.message) || String(e) };
  }
};
