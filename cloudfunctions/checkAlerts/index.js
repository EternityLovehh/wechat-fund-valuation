// 云函数(定时触发)：检查基金涨跌是否达到用户设定阈值，命中则发订阅消息。
// 触发器建议：交易时段每 5 分钟(见 config.json)。一次订阅授权只能发一条，发后 quota-1。
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

// 拉官方估值排行，构建 code -> { gszzl(%), gsz, name }
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
  // 仅工作日执行(周末直接跳过；节假日未做精确排除，靠 quota 兜底)
  const bjDay = new Date(Date.now() + 8 * 3600 * 1000).getUTCDay();
  if (bjDay === 0 || bjDay === 6) return { skipped: 'weekend' };

  const alerts = await db.collection('fund_alerts').where({ quota: _.gt(0) }).get();
  if (!alerts.data.length) return { sent: 0, reason: 'no-active-alerts' };

  let gz;
  try {
    gz = await loadGZMap();
  } catch (e) {
    return { sent: 0, error: 'gz-fetch-failed' };
  }

  const time = beijingNow();
  let sent = 0;
  for (const a of alerts.data) {
    const est = gz.map[a.code];
    if (!est || est.gszzl == null) continue;
    const g = est.gszzl; // 当日估算涨跌 %
    const hitUp = a.upPct != null && g >= a.upPct;
    const hitDown = a.downPct != null && g <= -Math.abs(a.downPct);
    if (!hitUp && !hitDown) continue;

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: a.openid,
        templateId: TEMPLATE_ID,
        page: 'pages/holding/holding',
        miniprogramState: 'formal',
        data: {
          thing6: { value: String(a.name || a.code).slice(0, 20) },
          character_string8: { value: `${g >= 0 ? '+' : ''}${g.toFixed(2)}%` },
          time9: { value: time },
          amount12: { value: (est.gsz || 0).toFixed(2) },
          thing10: { value: hitUp ? '涨幅达到提醒线' : '跌幅达到提醒线' }
        }
      });
      await db.collection('fund_alerts').doc(a._id).update({ data: { quota: _.inc(-1), lastSentAt: Date.now() } });
      sent++;
    } catch (e) {
      // 单条失败不影响其他
    }
  }
  return { sent, total: alerts.data.length, gzrq: gz.gzrq };
};
