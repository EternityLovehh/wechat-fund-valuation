// 单轮提示词:facts(代码算好的数字) + 四板块写作指令 + 合规约束。
const DISCLAIMER = '> 本报告由 AI 基于公开数据生成，仅供参考，不构成投资建议。';

function buildPrompt(facts) {
  const system = [
    '你是一位基金组合分析助手，为持有人撰写每日持仓复盘报告。',
    '硬性规则：',
    '1. 所有数字必须直接引用输入数据，禁止自行计算或编造数字。',
    '2. 对未来的判断必须明确标注"推测"，不得使用确定性表述。',
    '3. 操作部分只给倾向性参考并说明理由，禁止给出明确的买卖指令与点位承诺。',
    '4. 输出为 markdown，正文开头先用一句话总结当日整体表现，然后依次输出且仅输出以下四个二级标题：',
    '## 当日复盘（组合与单基金盈亏归因，结合重仓股/板块暴露和大盘环境解释涨跌来源）',
    '## 阶段走势（结合各基金近1月/3月/1年阶段涨幅评价组合走势与结构）',
    '## 未来展望（基于持仓板块近期表现做推演，每条标注"推测"）',
    '## 操作参考（集中度/暴露风险提示与倾向性参考，非指令）',
    `5. 报告最后单独一行输出：${DISCLAIMER}`,
    '6. 若输入标注某基金"当日数据缺失"，在当日复盘中说明并跳过其归因。'
  ].join('\n');

  const lines = [
    `日期：${facts.date}`,
    `大盘：${facts.indexes.map((i) => `${i.name} ${fmt(i.chg)}%`).join('，') || '无数据'}`,
    // 金额统一 toFixed(2) 避免长浮点进 prompt；dayProfit 等来自 facts.portfolio 是未取整浮点
    `组合：总市值 ${Number(facts.portfolio.totalValue).toFixed(2)} 元，当日盈亏 ${Number(facts.portfolio.dayProfit).toFixed(2)} 元（${fmt(facts.portfolio.dayProfitRate)}%），累计收益 ${Number(facts.portfolio.totalProfit).toFixed(2)} 元（${fmt(facts.portfolio.totalProfitRate)}%）`,
    facts.portfolio.navMissing.length ? `当日数据缺失基金：${facts.portfolio.navMissing.join('、')}` : '',
    '各基金（按当日贡献从高到低）：',
    ...facts.funds.map((f) =>
      `- ${f.name}(${f.code}) 市值${Number(f.marketValue).toFixed(2)}元 当日${f.dayChg == null ? '数据缺失' : fmt(f.dayChg) + '%（' + (f.chgSource === 'nav' ? '净值' : '估值') + '口径，贡献' + Number(f.dayProfitAmt).toFixed(2) + '元）'} 累计${fmt(f.totalProfitRate)}%` +
      (f.periods.length ? ` 阶段涨幅:${f.periods.map((p) => `${p.label}${fmt(p.syl)}%`).join('/')}` : '')),
    facts.stockExposure.length ? '穿透重仓股暴露（占组合%）：' + facts.stockExposure.map((s) => `${s.name}${s.pct}%${s.chg != null ? '(今日' + fmt(s.chg) + '%)' : ''}`).join('，') : '',
    facts.sectorExposure.length ? '行业暴露（占组合%）：' + facts.sectorExposure.map((s) => `${s.name}${s.pct}%`).join('，') : '',
    '',
    '请根据以上数据撰写报告。'
  ].filter(Boolean);

  return { system, user: lines.join('\n') };
}
function fmt(n) { return n == null ? '--' : (n >= 0 ? '+' : '') + n; }

// 列表页摘要:跳过标题/空行/引用,取首个正文段落截 60 字
function extractSummary(md) {
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('>')) continue;
    return line.slice(0, 60);
  }
  return '';
}
module.exports = { buildPrompt, extractSummary, DISCLAIMER };
