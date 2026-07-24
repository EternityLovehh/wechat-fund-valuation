# AI 基金复盘功能设计（2026-07-24）

## 背景与目标

参考 WorkBuddy 上流行的"基金复盘/走势分析/预测/买卖策略"玩法，在 MyFund 小程序内落地一个 AI 复盘功能。核心思路：**准确的私有数据进、确定性计算打底、LLM 只负责解读与推演、定时自动跑、结构化报告出**。

- 使用范围：体验版，2~3 个有开发权限的用户。合规压力低，但报告措辞仍按"分析参考、非投资建议"口径写。
- 用户已确认的需求：
  - 报告四板块全要：当日复盘归因、阶段走势分析、未来展望/预测（标注为推测）、操作参考（倾向性参考，非指令）。
  - 每个交易日 **21:00** 定时生成并推送（净值基本已公布，数据准），另有手动"立即生成"入口。
  - 接受持仓自动同步快照到云数据库（自有云开发环境）。

## 方案选型

选定 **方案一：云函数生成 + 云端存报告 + 订阅消息通知**。

- 否决"前端直调 `wx.cloud.extend.AI` 流式生成"：定时推送无法在端上做，且要求基础库 ≥3.15.1，数据拼装逻辑会在端/云两处重复。
- "报告页内追问对话（流式）"作为 v2 增量，本期不做。
- 模型：云开发原生大模型接口，`deepseek-v3`（云函数侧 HTTP 调用，不依赖端上基础库版本）。首月免费额度覆盖原型期；之后 2~3 人日报量级月成本约几元。

## 架构总览

```
持仓页 onShow ──(有变更时)──▶ syncHoldings 云函数 ──▶ user_holdings 集合
                                                          │
定时触发器 21:00 (工作日) ──▶ aiReport 云函数 ◀── 手动"立即生成"(wx.cloud.callFunction)
                                │
                                ├─ 1. 读持仓 (timer: 全部用户 / manual: 调用者,请求可直接带持仓)
                                ├─ 2. 拉数据: 东财估值/净值/重仓/行业/阶段涨幅 + 大盘指数
                                ├─ 3. 代码计算 facts (盈亏归因/贡献排序/板块暴露)
                                ├─ 4. 拼 prompt (facts + 四板块指令 + 合规约束)
                                ├─ 5. 调云开发 AI (deepseek-v3, 失败重试1次)
                                ├─ 6. 写 fund_reports (每用户保留30份)
                                └─ 7. 发订阅消息 (复用 alert 的 quota/lastSentDate 模式)
                                                          │
报告页 pages/report ◀── 列表+详情 (markdown→rich-text 简版渲染) ◀──┘
```

## 数据模型（云数据库新增两个集合）

### `user_holdings`（一个用户一条，`_id = openid`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `openid` | string | 同 `_id` |
| `holdings` | array | `{ code, name, shares, cost }`，手动持仓与截图导入**合并后的统一口径**（截图导入取已确认部分 shares/cost；待确认 pendingAdds 不上云） |
| `updatedAt` | number | 毫秒时间戳 |

端上同步时机：持仓页数据加载完成后静默调 `syncHoldings`；对 `holdings` 内容做 hash，与上次同步值一致则不调用（节流）。

### `fund_reports`（`_id` 自动生成）

| 字段 | 类型 | 说明 |
|---|---|---|
| `openid` | string | 归属用户 |
| `date` | string | 报告对应交易日 YYYY-MM-DD |
| `content` | string | 报告全文 markdown |
| `summary` | string | 首段摘要（列表页展示） |
| `facts` | object | 代码算出的结构化归因数据（排查/回溯用） |
| `status` | string | `ok` / `failed` |
| `trigger` | string | `timer` / `manual` |
| `createdAt` | number | 毫秒时间戳 |

留存策略：写入成功后查该用户报告数，>30 则删最旧。同一 `openid+date` 重复生成时覆盖（manual 重新生成当天报告属正常操作）。

## 云函数

### `syncHoldings`（新增，仿 `saveAlert`）

- 入参：`{ holdings: [{code,name,shares,cost}] }`；校验 code 为 6 位数字、数值合法、上限 100 条。
- 逻辑：`_id=openid` upsert 到 `user_holdings`。

### `aiReport`（新增，核心）

- 触发：timer `0 0 21 * * * *`（每天 21:00，函数内判断周末跳过，与 `checkAlerts` 一致）；或小程序端 `wx.cloud.callFunction` 手动调用。
- 入参（manual 模式）：`{ holdings?, state? }` — `holdings` 可选，带上则用请求内持仓（保证最新），否则读云端快照；`state` 同 checkAlerts 用于订阅消息 miniprogramState。
- 支持 `event.dryRun: true`：只返回 facts 与拼好的 prompt，不调 LLM、不落库、不推送（测试用）。
- 数据获取（全部复用/参照现有接口，单项失败不阻断，缺失项在 prompt 中标注）：
  - 估值兜底：`api.fund.eastmoney.com/FundGuZhi/GetFundGZList`（照抄 `checkAlerts.loadGZMap`）
  - 最新净值：`fundmobapi.eastmoney.com/.../FundMNFInfo`（照抄 `getFund` 的兜底逻辑）
  - 前十大重仓：`fund.eastmoney.com/pingzhongdata/{code}.js`
  - 行业配置：`fundmobapi` 行业配置接口（同 `fundApi.ts` 现有调用）
  - 阶段涨幅（近1月/3月/1年）：`fundmobapi` 阶段涨幅接口（同 `fundApi.ts` 现有调用）
  - 大盘指数（上证/深证/创业板当日涨跌）：`push2.eastmoney.com`
- facts 计算（纯代码，不交给模型算数）：
  - 组合：总市值、总成本、当日盈亏额与盈亏率（净值口径，净值未出的基金用估值并标注）、累计收益与收益率
  - 单基金：当日贡献额排序（拖累/贡献 Top）、各自当日涨跌与所用口径
  - 穿透：重仓股与行业按市值加权合并的暴露 Top10（参照 penetration 页穿透思路，在云函数内独立实现）
- prompt 结构（单轮，非多轮链——报告规模不需要）：
  - system：角色（基金组合分析助手）+ 合规约束（推测必须标注"推测"；操作部分只给倾向性参考并说明理由；不承诺收益；结尾固定风险提示行）+ 输出格式（markdown，四个二级标题固定顺序）
  - user：facts JSON + 大盘环境 + 四板块写作指令
- LLM 调用：云开发 AI HTTP 接口，模型 `deepseek-v3`，temperature 0.5，max_tokens 3000，超时 60s，失败重试 1 次；再失败则落 `status: failed` 记录，不推送。
- 订阅消息：复用 `fund_alerts` 的既有模板与 quota 机制。**注意这意味着涨跌提醒与复盘推送共用同一额度池**（微信订阅消息一次授权只能发一条，先到先得）——体验版 2~3 人可接受；报告推送用独立的 `lastReportDate` 字段去重（不与提醒的 `lastSentDate` 混用）。额度不足或当日已推则只落库不推送。

### 触发器配置

`aiReport/config.json`：`{ "triggers": [{ "name": "dailyReport", "type": "timer", "config": "0 0 21 * * * *" }] }`；权限含 `openapi.subscribeMessage.send`。

## 前端改动

1. **新页面 `pages/report/report`**（注册进 app.json，非 tab）：
   - 列表态：按日期倒序展示（日期 + summary + trigger 标签），下拉刷新。
   - 详情态：markdown 渲染 —— 自写 ≤100 行简版解析器（支持 `##` 标题、`**加粗**`、`- 列表`、段落），转 rich-text 节点；不引入 towxml。
   - "立即生成"按钮：调 `aiReport`（带上端上最新持仓），loading 提示"生成中，约需 30 秒"，云函数侧超时 60s。
   - "订阅每日推送"按钮：`wx.requestSubscribeMessage` 授权后调 `saveAlert` 加 quota（复用现有授权链路）。
2. **持仓页**：`onShow` 数据就绪后合并三类持仓为统一口径，hash 变更时调 `syncHoldings`。
3. **入口**：「我的」页加"AI 复盘"入口行。

## 错误处理

| 故障 | 行为 |
|---|---|
| 单个东财接口失败 | 该维度缺失，prompt 标注"数据缺失"，模型跳过该维度分析 |
| 估值+净值全部失败 | 当天跳过该用户，返回值记录原因（同 checkAlerts 的 debug 风格） |
| LLM 超时/报错 | 重试 1 次；仍失败落 `status:failed`，不推送；manual 模式向前端返回错误文案 |
| 用户无持仓快照 | timer 跳过；manual 提示"请先在持仓页添加持仓" |
| 订阅额度不足 | 报告正常落库，仅不推送 |

## 测试计划

1. `aiReport` 带 `dryRun:true` 在云开发测试面板跑，核对 facts 数字与持仓页/穿透页一致。
2. manual 模式全链路（真实 LLM 调用），检查 markdown 结构与合规措辞。
3. 前端：同步节流（重复 onShow 不重复调 syncHoldings）、报告渲染、生成 loading、订阅授权。
4. timer：临时把 cron 改到最近时间点验证自动生成+推送，验证后改回 21:00。
5. 留存：人工造 >30 份记录验证删旧。

## 本期不做（YAGNI）

- 报告页内追问对话（流式）
- 自选基金异动纳入报告
- 新闻资讯纳入 prompt
- 正式版发布的类目/合规适配
