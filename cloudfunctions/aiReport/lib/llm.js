// 大模型调用：直连智谱 GLM 的 OpenAI 兼容端点（绕开 CloudBase 内置模型计费）。
// 默认 glm-4-flash：永久免费、只限并发不限 Token。可用环境变量覆盖端点/模型。
// API Key 必须放云函数环境变量 ZHIPU_API_KEY（控制台 → 云函数 → 配置），不写进代码/不进 git。
//
// 为什么用流式(stream)：免费 GLM-4-Flash 高峰期很慢，非流式要等整篇生成完(可能 >50s)必超时。
//   流式边生成边收：①连接持续有数据流，不会因"单次长等待"被 socket 超时；
//   ②到 deadline 仍没写完，就把【已生成的部分】当报告返回(部分报告 > 彻底失败)。
// 超时预算：云函数上限 60s，取数用几秒 → LLM 软预算默认 50s(留余量落库)。
const https = require('https');

const API_URL = process.env.LLM_API_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const MODEL_ID = process.env.LLM_MODEL || 'glm-4-flash';
const API_KEY = process.env.ZHIPU_API_KEY || process.env.LLM_API_KEY || '';
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS) || 1600;
const TOTAL_BUDGET_MS = Number(process.env.LLM_BUDGET_MS) || 50000;
// 生成有效内容达到此长度后，即使到 deadline 被中断也接受为"部分报告"
const MIN_USABLE_LEN = Number(process.env.LLM_MIN_USABLE_LEN) || 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 流式 POST。resolve({ content, finished, status })；
//   - 正常收完 → finished=true
//   - 到 deadlineMs 仍未收完但已有内容 → 中断并 finished=false 返回部分内容
//   - 非 200 / 无任何内容 → reject(带 status 便于分类)
function streamChat(url, body, apiKey, deadlineMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(Object.assign({}, body, { stream: true }));
    const u = new URL(url);
    let content = '';
    let settled = false;
    let sawDone = false;

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status !== 200) {
          // 错误响应是普通 JSON，不是 SSE：收全再 reject
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            let msg = d;
            try { const j = JSON.parse(d); msg = (j.error && (j.error.message || j.error.code)) || j.msg || d; } catch (e) { /* 原文 */ }
            const err = new Error(`LLM ${status}: ${String(msg).slice(0, 200)}`);
            err.status = status;
            reject(err);
          });
          return;
        }
        // SSE：逐行解析 data: {json}
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString('utf8');
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') { sawDone = true; continue; }
            try {
              const j = JSON.parse(data);
              const delta = j.choices && j.choices[0] && j.choices[0].delta;
              if (delta && delta.content) content += delta.content;
            } catch (e) { /* 跳过不完整片段 */ }
          }
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ content, finished: true, status: 200, sawDone });
        });
      }
    );

    // 到 deadline：有内容就返回部分，否则当超时
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      if (content.length >= MIN_USABLE_LEN) resolve({ content, finished: false, status: 200 });
      else reject(new Error('llm-timeout'));
    }, deadlineMs);

    req.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (content.length >= MIN_USABLE_LEN) resolve({ content, finished: false, status: 200 });
      else reject(e);
    });
    req.write(payload);
    req.end();
  });
}

function maskKey(k) {
  if (!k) return '(空)';
  return k.length <= 8 ? '****' : `${k.slice(0, 4)}…${k.slice(-2)}(len${k.length})`;
}
function isQuotaExhausted(e) {
  return /EXCEED_TOKEN_QUOTA|quota|额度不足|余额不足|欠费/i.test(String((e && e.message) || e || ''));
}
function isRateLimited(status, e) {
  if (status === 429) return true;
  return /\b429\b|too many requests|concurren|rate.?limit|限流|频繁|1302|1301/i.test(String((e && e.message) || e || ''));
}
function isTimeout(e) {
  return /llm-timeout|timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(String((e && e.message) || e || ''));
}

async function generateReport(system, user) {
  console.log(`[llm] cfg url=${API_URL} model=${MODEL_ID} key=${maskKey(API_KEY)} maxTokens=${MAX_TOKENS} budget=${TOTAL_BUDGET_MS}ms(stream)`);
  if (!API_KEY) throw new Error('未配置 ZHIPU_API_KEY（云函数环境变量），无法调用模型');
  const body = {
    model: MODEL_ID,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.5,
    max_tokens: MAX_TOKENS
  };

  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const budget = remaining();
    if (budget < 4000) { console.warn(`[llm] budget用尽(${budget}ms),停止重试`); break; }
    const tReq = Date.now();
    try {
      console.log(`[llm] attempt#${attempt} stream POST deadline=${budget}ms`);
      const { content, finished } = await streamChat(API_URL, body, API_KEY, budget);
      console.log(`[llm] attempt#${attempt} ok ${Date.now() - tReq}ms finished=${finished} len=${content.length}`);
      if (content && content.trim()) {
        // 未写完的部分报告：补一句说明，避免读者以为内容完整
        return finished ? content : content + '\n\n> （生成超时，以上为部分内容，可稍后重新生成获取完整报告）';
      }
      throw new Error('模型返回空内容');
    } catch (e) {
      lastErr = e;
      console.error(`[llm] attempt#${attempt} 异常 ${Date.now() - tReq}ms: ${(e && e.message) || e}`);
      if (isQuotaExhausted(e)) throw e;   // 额度耗尽：重试无用
      if (isTimeout(e)) throw e;          // 超时且无内容：预算已耗尽，重试只会再超时
      if (isRateLimited(e && e.status, e)) await sleep(Math.max(0, Math.min(800 * (attempt + 1), remaining() - 1000)));
      else await sleep(300);
    }
  }
  throw lastErr;
}
module.exports = { generateReport, MODEL_ID, isQuotaExhausted, isRateLimited, isTimeout };
