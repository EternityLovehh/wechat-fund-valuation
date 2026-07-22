// 云函数(定时触发):检查用户持仓是否达到「全局涨跌提醒」阈值,命中则发订阅消息。
// 触发器:交易时段每 30 分钟(见 config.json)。
// 数据模型:fund_alerts 一个用户一条(_id=openid),字段 enabled/upPct/downPct/codes[]/names{}/quota/lastSentDate。
// 策略:每个用户每天最多推一条(lastSentDate 去重),取当日涨跌最猛的一只作为主体,多只命中则标注「等N只」。
//       一次订阅授权只能发一条,发后 quota-1。
const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const TEMPLATE_ID = 'xKSDHWEZPtQaJq_73F5JVQk6UI8T8SlfmkILDfCLV_E';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36';

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, ...headers }, timeout: 25000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// 拉官方估值排行,构建 code -> { gszzl(%), gsz, name }
async function loadGZMap() {
  const url =
    'https://api.fund.eastmoney.com/FundGuZhi/GetFundGZList' +
    '?type=1&sort=3&orderType=desc&canbuy=0&pageIndex=1&pageSize=30000';
  const body = await httpGet(url, { Referer: 'https://fund.eastmoney.com/' });
  const j = JSON.parse(body);
  const list = (j && j.Data && j.Data.list) || [];
  const map = Object.create(null);
  for (const it of list) {
    const gszzl = parseFloat(String(it.gszzl).replace('%', ''));
    map[it.bzdm] = { gszzl: isNaN(gszzl) ? null : gszzl, gsz: parseFloat(it.gsz) || 0, name: it.jjjc };
  }
  return { map, gzrq: (j.Data && j.Data.gzrq) || '' };
}

// 北京时间 "YYYY-MM-DD HH:mm"
function beijingNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => `${n}`.padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

exports.main = async () => {
  // 仅工作日执行(周末跳过;节假日未精确排除,靠 quota/估值兜底)
  const bjDay = new Date(Date.now() + 8 * 3600 * 1000).getUTCDay();
  if (bjDay === 0 || bjDay === 6) return { skipped: 'weekend' };

  const users = await db.collection('fund_alerts').where({ enabled: true, quota: _.gt(0) }).get();
  if (!users.data.length) return { sent: 0, reason: 'no-active-users' };

  let gz;
  try {
    gz = await loadGZMap();
  } catch (e) {
    return { sent: 0, error: 'gz-fetch-failed' };
  }

  const time = beijingNow();
  const today = time.slice(0, 10);
  let sent = 0;

  for (const u of users.data) {
    if (u.lastSentDate === today) continue; // 当日已推,去重
    const codes = Array.isArray(u.codes) ? u.codes : [];
    if (!codes.length) continue;
    const up = u.upPct;
    const down = u.downPct;

    // 收集命中项
    const hits = [];
    for (const code of codes) {
      const est = gz.map[code];
      if (!est || est.gszzl == null) continue;
      const g = est.gszzl;
      const hitUp = up != null && up > 0 && g >= up;
      const hitDown = down != null && down > 0 && g <= -Math.abs(down);
      if (hitUp || hitDown) {
        const nm = (u.names && u.names[code]) || est.name || code;
        hits.push({ code, g, gsz: est.gsz, name: nm, dir: hitUp ? 'up' : 'down' });
      }
    }
    if (!hits.length) continue;

    // 取涨跌幅度最大的一只作为主体
    hits.sort((a, b) => Math.abs(b.g) - Math.abs(a.g));
    const top = hits[0];
    const desc = hits.length > 1
      ? `${hits.length}只基金达到提醒线`
      : (top.dir === 'up' ? '涨幅达到提醒线' : '跌幅达到提醒线');

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: u.openid,
        templateId: TEMPLATE_ID,
        page: 'pages/holding/holding',
        miniprogramState: 'formal',
        data: {
          thing6: { value: String(top.name).slice(0, 20) },
          character_string8: { value: `${top.g >= 0 ? '+' : ''}${top.g.toFixed(2)}%` },
          time9: { value: time },
          amount12: { value: (top.gsz || 0).toFixed(2) },
          thing10: { value: desc.slice(0, 20) }
        }
      });
      await db.collection('fund_alerts').doc(u._id).update({
        data: { quota: _.inc(-1), lastSentAt: Date.now(), lastSentDate: today }
      });
      sent++;
    } catch (e) {
      // 单个用户失败不影响其他
    }
  }
  return { sent, users: users.data.length, gzrq: gz.gzrq };
};
