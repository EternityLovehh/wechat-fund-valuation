// 云开发原生大模型调用(服务端)。失败重试 1 次。
// 超时预算:云函数 config.json 显式设了 60s 执行上限;此处单次调用 timeout 设为 30000ms,
// 使"一次尝试 30s + 一次重试 30s"贴着 60s 预算,为取数等前置步骤留出并行/缓存吸收的余量。
// 最坏情况(两次调用都跑满超时)会被平台强杀,由次日 timer 重跑或用户手动重试兜底。
const tcb = require('@cloudbase/node-sdk');
const MODEL_ID = 'deepseek-v3.2';
let app = null;

async function generateReport(system, user) {
  if (!app) app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, timeout: 30000 });
  const model = app.ai().createModel('cloudbase');
  const call = () =>
    model.generateText({
      model: MODEL_ID,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.5,
      max_tokens: 3000
    });
  try {
    return (await call()).text;
  } catch (e) {
    return (await call()).text; // 重试 1 次,再失败让异常上抛
  }
}
module.exports = { generateReport, MODEL_ID };
