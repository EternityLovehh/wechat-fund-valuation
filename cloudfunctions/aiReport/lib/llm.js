// 云开发原生大模型调用(服务端)。失败重试 1 次。
const tcb = require('@cloudbase/node-sdk');
const MODEL_ID = 'deepseek-v3.2';
let app = null;

async function generateReport(system, user) {
  if (!app) app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, timeout: 60000 });
  const model = app.ai().createModel('cloudbase');
  const call = () =>
    model.generateText({
      model: MODEL_ID,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    });
  try {
    return (await call()).text;
  } catch (e) {
    return (await call()).text; // 重试 1 次,再失败让异常上抛
  }
}
module.exports = { generateReport, MODEL_ID };
