// 云函数:AI 持仓复盘报告。
// 触发:timer 每天 21:00(函数内跳过周末) / 小程序手动调用(可带最新持仓) / action list|get 供报告页读取。
// 流程:持仓 → fetchAllData → computeFacts → buildPrompt → LLM → fund_reports(同 openid+date 覆盖,留 30 份) → 订阅消息(仅 timer)。
// timer 分支按用户并行执行且逐用户 try/catch 隔离:体验版用户量小(2~3 人),并行既避免单用户异常中断整批,又把批次墙钟压到接近单用户耗时,不必额外限并发。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const { fetchAllData } = require('./lib/fetch');
const { computeFacts } = require('./lib/facts');
const { buildPrompt, extractSummary } = require('./lib/prompt');
const { generateReport } = require('./lib/llm');

const TEMPLATE_ID = 'xKSDHWEZPtQaJq_73F5JVQk6UI8T8SlfmkILDfCLV_E';
const KEEP_REPORTS = 30;

function sanitizeHoldings(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const h of input.slice(0, 100)) {
    if (!h || !/^\d{6}$/.test(String(h.code))) continue;
    const shares = Number(h.shares), cost = Number(h.cost);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(cost) || cost <= 0) continue;
    out.push({ code: String(h.code), name: String(h.name || '').slice(0, 40), shares, cost });
  }
  return out.length ? out : null;
}

async function generateForUser(openid, holdings, trigger, dryRun) {
  const tag = `[aiReport ${openid.slice(0, 6)}…]`;
  const t0 = Date.now();
  const codes = holdings.map((h) => h.code);
  console.log(`${tag} start trigger=${trigger} codes=${codes.length}[${codes.join(',')}]`);

  const tFetch = Date.now();
  const { fundData, indexes, today } = await fetchAllData(codes);
  const navOk = Object.values(fundData).filter((d) => Number(d.nav) > 0).length;
  console.log(`${tag} fetchAllData ${Date.now() - tFetch}ms today=${today} funds=${Object.keys(fundData).length} navOk=${navOk} indexes=${indexes.length}`);

  const facts = computeFacts(holdings, fundData, indexes, today);
  if (!facts) {
    console.warn(`${tag} SKIP no-usable-data (每只基金 nav<=0? navOk=${navOk})`);
    return { openid: openid.slice(0, 8) + '…', skip: 'no-usable-data' };
  }
  const prompt = buildPrompt(facts);
  console.log(`${tag} facts.funds=${facts.funds.length} promptLen sys=${prompt.system.length} user=${prompt.user.length}`);
  if (dryRun) return { facts, prompt };

  let content, status = 'ok', errMsg = '';
  const tLLM = Date.now();
  try {
    content = await generateReport(prompt.system, prompt.user);
    console.log(`${tag} LLM ok ${Date.now() - tLLM}ms contentLen=${(content || '').length}`);
  } catch (e) {
    content = '';
    status = 'failed';
    // 保留真实错误(模型ID失效/超时/配额等),供诊断;不吞
    errMsg = (e && (e.message || e.errMsg || e.code)) ? String(e.message || e.errMsg || e.code) : String(e);
    console.error(`${tag} LLM FAIL ${Date.now() - tLLM}ms err=${errMsg} totalElapsed=${Date.now() - t0}ms`, e && e.stack ? e.stack : e);
  }
  const col = db.collection('fund_reports');
  const existed = await col.where({ openid, date: facts.date }).get();
  // 失败不得覆盖同日已成功报告:同日已有 ok 文档时,本次失败直接放弃写库
  if (status === 'failed' && existed.data.length && existed.data[0].status === 'ok') {
    return { openid: openid.slice(0, 8) + '…', status: 'failed-kept-old', date: facts.date };
  }
  const doc = {
    openid, date: facts.date, content, facts,
    summary: status === 'ok' ? extractSummary(content) : '生成失败',
    status, trigger, createdAt: Date.now()
  };
  if (existed.data.length) await col.doc(existed.data[0]._id).update({ data: doc });
  else await col.add({ data: doc });

  // 留存:超 30 份删最旧
  const { total } = await col.where({ openid }).count();
  if (total > KEEP_REPORTS) {
    const old = await col.where({ openid }).orderBy('createdAt', 'asc').limit(total - KEEP_REPORTS).get();
    for (const d of old.data) await col.doc(d._id).remove();
  }
  return { openid: openid.slice(0, 8) + '…', status, date: facts.date, dayProfit: facts.portfolio.dayProfit, summary: doc.summary, errMsg };
}

// 仅 timer:发订阅消息(与涨跌提醒共池 quota;lastReportDate 独立去重)
async function pushReport(openid, result, state) {
  if (result.status !== 'ok') return 'not-ok';
  const alertDoc = await db.collection('fund_alerts').doc(openid).get().catch(() => null);
  const a = alertDoc && alertDoc.data;
  if (!a || !(a.quota > 0)) return 'no-quota';
  if (a.lastReportDate === result.date) return 'already-pushed';
  try {
    const r = await cloud.openapi.subscribeMessage.send({
      touser: openid, templateId: TEMPLATE_ID, page: 'pages/report/report',
      miniprogramState: state,
      data: {
        thing6: { value: 'AI持仓复盘' },
        character_string8: { value: `${result.dayProfit >= 0 ? '+' : '-'}${Math.abs(result.dayProfit).toFixed(2)}` },
        time9: { value: `${result.date} 21:00` },
        amount12: { value: Math.abs(result.dayProfit).toFixed(2) },
        thing10: { value: (result.summary || '今日复盘已生成').slice(0, 20) }
      }
    });
    if (!r || r.errCode === 0 || r.errCode == null) {
      await db.collection('fund_alerts').doc(openid).update({ data: { quota: _.inc(-1), lastReportDate: result.date } });
      return 'sent';
    }
    return `err:${r.errCode}`;
  } catch (e) {
    return `exception:${(e && (e.errMsg || e.message)) || e}`;
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();

  if (event.action === 'list') {
    if (!OPENID) return { success: false, error: '无 openid' };
    const r = await db.collection('fund_reports').where({ openid: OPENID })
      .orderBy('date', 'desc').limit(KEEP_REPORTS)
      .field({ date: true, summary: true, status: true, trigger: true }).get();
    return { success: true, list: r.data };
  }
  if (event.action === 'get') {
    if (!OPENID || !event.id) return { success: false, error: '参数缺失' };
    const r = await db.collection('fund_reports').doc(String(event.id)).get().catch(() => null);
    if (!r || !r.data || r.data.openid !== OPENID) return { success: false, error: '报告不存在' };
    return { success: true, report: r.data };
  }

  if (OPENID) {
    // 手动模式:优先用请求带来的最新持仓,否则读云端快照
    let holdings = sanitizeHoldings(event.holdings);
    if (!holdings) {
      const snap = await db.collection('user_holdings').doc(OPENID).get().catch(() => null);
      holdings = snap && snap.data && sanitizeHoldings(snap.data.holdings);
    }
    if (!holdings) return { success: false, error: '请先在持仓页添加持仓' };
    try {
      const result = await generateForUser(OPENID, holdings, 'manual', !!event.dryRun);
      if (event.dryRun) return { success: true, dryRun: result };
      if (result.skip) return { success: false, error: '行情数据获取失败,请稍后重试', diag: result.skip };
      return { success: result.status === 'ok', result, error: result.status === 'ok' ? undefined : `报告生成失败：${result.errMsg || '请稍后重试'}` };
    } catch (e) {
      // 取数/落库等阶段抛错也要带回原因(而非让 callFunction 抛→客户端只显示"超时")
      const msg = (e && (e.message || e.errMsg)) ? String(e.message || e.errMsg) : String(e);
      console.error('[aiReport] manual 未捕获异常:', msg, e && e.stack ? e.stack : e);
      return { success: false, error: `生成失败：${msg}` };
    }
  }

  // 定时模式:遍历全部用户,隔离错误(见文件头注释)。
  // CloudBase AI 环境级并发上限默认 10,21:00 定时若把全部用户一次性 Promise.all 会撞 429,
  // 故按 LLM_CONCURRENCY 分批(留余量给取数并发),批内并行、批间串行。
  const bjDay = new Date(Date.now() + 8 * 3600 * 1000).getUTCDay();
  if (bjDay === 0 || bjDay === 6) return { skipped: 'weekend' };
  const users = await db.collection('user_holdings').get();
  const state = (event && event.state) || 'trial';
  const runUser = async (u) => {
    try {
      const holdings = sanitizeHoldings(u.holdings);
      if (!holdings) return { openid: String(u._id).slice(0, 8) + '…', skip: 'no-holdings' };
      const result = await generateForUser(u._id, holdings, 'timer', false);
      result.push = result.status ? await pushReport(u._id, result, state) : 'skipped';
      return result;
    } catch (e) {
      return { openid: String(u._id).slice(0, 8) + '…', skip: 'error', message: (e && e.message) || String(e) };
    }
  };
  const LLM_CONCURRENCY = 4;
  const debug = [];
  for (let i = 0; i < users.data.length; i += LLM_CONCURRENCY) {
    const batch = users.data.slice(i, i + LLM_CONCURRENCY);
    debug.push(...(await Promise.all(batch.map(runUser))));
  }
  return { users: users.data.length, state, debug };
};
