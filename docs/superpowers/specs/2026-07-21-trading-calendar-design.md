# 交易日历（节假日休市）设计

日期：2026-07-21
子项目：#1（功能规划第一档）

## 背景与问题

`getMarketStatus(now)`（`miniprogram/utils/fundApi.ts`）目前只识别周末（周六/周日 → `'weekend'`），
**不识别 A 股法定节假日**。因此在节假日的工作日（如国庆、春节期间的周一至周五）：

- 状态被错误判为 `'trading' / 'pre-open' / 'lunch' / 'post-close'`，顶部状态栏可能显示"交易中"。
- `isMarketActive()` 返回 `true`，从而启动 30 秒自动刷新——节假日行情不变，纯属空跑。

目标：让 `getMarketStatus` 在 A 股节假日返回"休市"，停止自动刷新与错误标签。

## 范围（YAGNI）

**做**：节假日判定 + 状态"休市" + 停止节假日自动刷新。
**不做**：调休上班日处理（A 股周末恒定休市，调休上班日股市照样不开，无需处理）；
盘中分时/估值时效（属其他子项目）；估值计算逻辑不变（节假日仍显示最近可得的官方/自算估值）。

## 数据源

内置 JSON、每年手动更新（个人项目最稳、零依赖）。

- 只登记**落在工作日的 A 股休市日**（节假日）；周末不登记（已由 `getDay()` 处理）。
- 调休上班日（把某个周末算作工作日）**不登记**——股市周末照常休市。
- 日期以官方《国务院办公厅节假日安排》+ 交易所休市公告为准。
  **实现时先查当年官方公布的准确休市安排再填，不凭记忆填写。**

## 组件设计

### 新增 `miniprogram/utils/tradingCalendar.ts`

单一职责：交易日/节假日判定。对外接口：

```ts
// 按年份登记的 A 股节假日休市日（YYYY-MM-DD，仅工作日节假日）
// 维护：每年国务院放假安排公布后补充下一年；数据以官方休市公告为准。
const MARKET_HOLIDAYS: Record<string, string[]>

// 某天是否为 A 股节假日休市（周末不在此列，返回 false）
export function isMarketHoliday(date?: Date): boolean

// 某天是否为交易日：非周末 且 非节假日
export function isTradingDay(date?: Date): boolean
```

行为约定：

- 日期归一化为 `YYYY-MM-DD`（复用与 `appDate.getTodayStr` 一致的本地日期格式）。
- **未覆盖年份优雅降级**：若 `date` 所在年份不在 `MARKET_HOLIDAYS` 中，`isMarketHoliday` 返回 `false`
  （退回"仅周末+时间窗"判定，与现状一致），绝不因数据未更新而误判为休市。

### 修改 `miniprogram/utils/fundApi.ts`

1. `MarketStatus` 类型新增成员 `'holiday'`。
2. `getMarketStatus(now)` 判定顺序：
   1. 周末 → `'weekend'`
   2. **节假日（`isMarketHoliday(now)`）→ `'holiday'`**（新增，在时间窗判定之前）
   3. 否则按现有时间窗：`pre-open / trading / lunch / trading / post-close`
3. `isMarketActive()` 不变：仍只在 `'trading'` 时返回 `true` → 节假日自动为 `false`。

### 修改 `index.ts` / `holding.ts`

`STATUS_LABELS: Record<MarketStatus, string>` 新增 `'holiday': '休市'`
（`MarketStatus` 加成员后，TS 的 `Record` 会强制补全，不会漏改）。顶部状态栏显示"休市"。

## 数据流

`页面 onShow / 自动刷新` → `getMarketStatus(now)` → 先查 `isMarketHoliday` → 返回状态
→ 页面据此渲染状态标签 + 决定是否 `startAutoRefresh`（`isMarketActive`）。

## 边界与错误处理

- 年份未覆盖：降级为非休市（见上）。
- `MARKET_HOLIDAYS` 缺失/格式异常：`isMarketHoliday` 内部 try/查表失败即返回 `false`，不抛错。
- 时区：使用设备本地日期（与 `appDate.getTodayStr` 一致）；A 股用户默认 UTC+8，符合预期。

## 测试

`tradingCalendar` 为纯函数、不依赖 `wx`，可独立单测：

- 周末 → `isTradingDay=false`、`isMarketHoliday=false`。
- 已登记的节假日（工作日）→ `isMarketHoliday=true`、`isTradingDay=false`。
- 普通工作日 → `isTradingDay=true`。
- 未覆盖年份的工作日 → `isMarketHoliday=false`（降级）。
- `getMarketStatus` 在节假日工作日返回 `'holiday'`；`isMarketActive` 返回 `false`。

## 验收标准

- 节假日工作日：状态栏显示"休市"，不启动 30s 自动刷新。
- 普通交易日：行为与现状完全一致。
- 数据未更新到某年时：该年退回现状行为，不误判休市。
