# 定时狙击模式设计

日期：2026-06-07

## 背景

现有工具只有「持续轮询 batch-preview」一种模式，存在两个问题：

1. **轮询频率过高必然触发限流**：用户输入 200ms 间隔，`index.ts` 实际转换为 100-350ms（~3-10 QPS），远超 `/api/biz/pay/batch-preview` 的网关限流阈值。
2. **退避逻辑 bug**：`Sniper.wait()` 在 `backoff.active` 时无条件将 `backoff.current` 翻倍——即使请求成功也翻倍。它与 `decayBackoff()` 的减半互相抵消，导致一旦触发过限流，退避永远卡在 4000ms、`active` 永不解除，工具事实上废掉。

而智谱补货时间是已知的（每天 10:00），抢购本质是定时事件，不需要全天轮询。

## 关键观察

`createPreOrder` 只需要 `productId` + `payAmount`，这两个值在**售罄状态**的 `batch-preview` 响应里就能拿到。因此可以提前缓存目标产品，到点直接打下单接口，跳过 batch-preview 的往返（~300-400ms）和限流。

## 方案

新增「定时狙击模式」，保留现有轮询模式作为兜底。

### 流程

```
启动（任意时间，如 9:40）
  ├─ 提取 Cookie → 验证 Token
  ├─ batch-preview → 缓存目标 productId + payAmount（售罄也能拿到）
  ├─ 交互：套餐 / 目标时间 HH:MM（默认 10:00，输入 now 走纯轮询模式）/ 确认
  │
等待期（每秒刷新倒计时显示）
  ├─ 每 60s 刷一次 batch-preview：更新缓存 productId/payAmount、确认 Token 存活
  ├─ 若提前发现有货（soldOut=false）→ 立即下单（捡漏）
  ├─ Token 失效（401/403）→ 立刻报错退出
  │
T-5s   用 batch-preview 响应的 Date 头校准服务器时钟偏移
       （Date 头秒级精度，±500ms 误差由 2s 提前量覆盖）
  │
T-2s   冲刺期（按校准后的服务器时间 9:59:58 起跑）
  ├─ 每 200ms 一发 createPreOrder（跳过 batch-preview）
  ├─ 成功拿到 bizId → 通知 + 开浏览器 + 响铃 → 停止
  ├─ 「资源包类型错误」→ 售罄空枪，继续
  ├─ 429/555 限流 → 固定退避 1s 再继续（冲刺期不指数退避）
  │
T+30s  仍未成功 → 兜底：回落到现有轮询模式
       （重新 batch-preview，productId 可能已变）
```

### 改动点

| 文件 | 改动 |
|---|---|
| `config.ts` | 新增 `SNIPE` 参数组：`burstInterval: 200`、`leadTimeMs: 2000`、`burstDurationMs: 30000`、`keepAliveMs: 60000`、`defaultTime: "10:00"`；新增 `parseTargetTime(input, now)` 纯函数（HH:MM → 下一次该时刻的 Date，已过则顺延明天） |
| `api.ts` | `batchPreview()` 改为同时返回响应 `Date` 头（`serverDate`），供校时使用 |
| `sniper.ts` | 修复 `wait()` 无条件翻倍 bug（翻倍移入 `handleApiError` 限流分支）；新增 `snipe(targetTime)`：等待循环 → 校时 → 冲刺循环 → 兜底回落 `run()` |
| `index.ts` | 新增时间输入项（HH:MM / now）；时间已过自动顺延明天并提示；路由到 snipe 或 run |

### 边界处理

- 时间解析只接受 `HH:MM`（0-23 / 0-59）或 `now`，非法输入即时校验报错
- 冲刺期 Token 过期：直接报错停止
- 等待期/冲刺期 Ctrl+C：干净退出
- 倒计时显示：`距开抢 00:19:32 | 缓存: Pro 季付 ¥402.3 (售罄中)`

### 测试

- `parseTargetTime` 纯函数单测（今天未到 / 已过顺延 / 非法输入）
- tsup 构建通过
- 端到端：目标时间设为 1-2 分钟后实跑，验证 等待→校时→冲刺→空枪→兜底 全链路

## 不做的事（YAGNI）

- 不做多套餐同时抢
- 不做服务器时间高精度校准（NTP 级别）——2s 提前量足够覆盖 Date 头的秒级误差
- 不做 cron/常驻守护，单次运行单次抢购
