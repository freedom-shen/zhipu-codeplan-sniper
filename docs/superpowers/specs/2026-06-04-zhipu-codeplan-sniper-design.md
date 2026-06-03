# zhipu-codeplan-sniper 设计文档

- **仓库**: https://github.com/freedom-shen/zhipu-codeplan-sniper

## 概述

智谱 GLM Coding Plan 抢购 CLI 工具。单命令启动，自动从 Chrome 提取 Cookie，轮询库存，自动下单，打开支付页。仅支持 Mac + Chrome。

## 启动交互

```bash
npx zhipu-codeplan-sniper
```

交互确认，带默认值（回车即确认）：

```
? 目标套餐 (Pro 季付 / ¥402.3) [Pro/Max/Lite] › Pro
? 轮询间隔 ms [100-500] › 200
? 开始抢购? (Y/n) › Y

✓ Cookie 从 Chrome 提取成功
✓ Token 验证通过 (ilfir364)
✓ 目标: product-fef82f Pro 季付 ¥402.3

🚀 抢购中... (0.2s/次, 已请求 15 次)
```

## 项目结构

```
zhipu-codeplan-sniper/
├── src/
│   ├── index.ts           # CLI 入口 + 交互确认
│   ├── cookie.ts          # Chrome cookie 提取 (chrome-cookies-secure)
│   ├── api.ts             # API 客户端 (batch-preview, createPreOrder, getCustomerInfo)
│   ├── sniper.ts          # 抢购引擎 (轮询 → 下单 → 打开支付页)
│   └── config.ts          # 套餐常量 (Lite=49, Pro=149, Max=469) + 默认配置
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## 核心流程

```
启动
 → 从 Chrome 提取 cookie (bigmodel_token_production)
 → 调 getCustomerInfo 验证 token
 → 交互确认（套餐、间隔）
 → 进入抢购循环
   → POST batch-preview
   → 匹配目标套餐：monthlyOriginalAmount 匹配 + 季付折扣标识
   → soldOut=false → POST createPreOrder
   → 下单成功 → open 支付页 → 通知 + 蜂鸣
   → 下单失败 → 继续轮询
   → 无库存 → 随机间隔后重试
 → 用户 Ctrl+C 停止
```

## API 详情

| 步骤 | URL | 方法 | 请求体 |
|------|-----|------|--------|
| 验证 | `open.bigmodel.cn/api/biz/customer/getCustomerInfo` | GET | - |
| 库存 | `open.bigmodel.cn/api/biz/pay/batch-preview` | POST | `{"invitationCode":""}` |
| 下单 | `open.bigmodel.cn/api/biz/product/createPreOrder` | POST | `{"productId":"...","payPrice":...,"num":1,"isMobile":false,"channelCode":"WEB"}` |

共用请求头：
```
Authorization: <从 Chrome cookie 提取的 token>
bigmodel-organization: org-926bfC72DC024473Bc02ECc731A83cf2
bigmodel-project: proj_4691457280004322950Fb7F3BA54f661
Content-Type: application/json
```

## 产品匹配（动态）

不 hardcode 产品 ID，从 batch-preview 响应动态匹配：

- 套餐：`monthlyOriginalAmount`（Lite=49, Pro=149, Max=469）
- 时长：`campaignDiscountDetails` 包含"连续包季 9 折" → 季付
- 首次 batch-preview：列出所有产品供用户确认
- 后续轮询：按 monthlyOriginalAmount + 折扣标识匹配

## 轮询策略

- 间隔：用户指定范围内随机（默认 200ms，范围 100-500ms）
- 持续时间：无上限，Ctrl+C 停止
- 限流（HTTP 555/429）：指数退避 0.5s → 1s → 2s（上限 2s），正常请求后重置
- 成功：打开支付页，输出订单信息，不退出（继续监控）

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| Cookie 提取失败 | 报错退出，提示登录 Chrome |
| Token 过期（401/403） | 报错退出，提示重新登录 |
| 限流（555/429） | 指数退避，上限 2s |
| createPreOrder "资源包类型错误" | 售罄，继续轮询 |
| createPreOrder 其他错误 | 打印错误信息，继续轮询 |
| 网络超时（5s） | 跳过，继续轮询 |
| DNS/连接失败 | 等待 2s 后重试 |

## 成功通知

- `child_process.exec('open https://open.bigmodel.cn/console/overview')` 打开支付页
- 终端输出订单号 + 支付金额
- macOS 系统通知：`osascript -e 'display notification ...'`
- 终端蜂鸣：`\x07`

## 日志

- 每次请求实时输出到终端（序号、耗时、库存状态）
- 不写日志文件

## 技术栈

- 运行时：Node.js >= 18
- 语言：TypeScript
- 构建：tsup（单文件 CLI 打包）
- Cookie 提取：`chrome-cookies-secure`
- 交互：`@clack/prompts`
- 终端输出：`chalk` + `ora`
- HTTP：原生 `fetch`（Node 18+ 内置）
- 打开浏览器：`child_process.exec('open ...')`

## package.json

```json
{
  "name": "zhipu-codeplan-sniper",
  "version": "1.0.0",
  "bin": { "zhipu-sniper": "./dist/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" }
}
```

## 不做的事（YAGNI）

- 多账号支持
- 定时抢购（启动即抢）
- 余额自动支付
- Linux/Windows 兼容
- 日志文件
- 配置文件持久化
