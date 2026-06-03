# zhipu-codeplan-sniper Design Spec

## Summary

CLI tool to snipe GLM Coding Plan subscriptions on bigmodel.cn. Single command, auto-extract Chrome cookie, poll inventory, auto-order, open payment page. Mac + Chrome only.

## Startup Interaction

```bash
npx zhipu-codeplan-sniper
```

Interactive confirmation with defaults (press Enter to accept):

```
? 目标套餐 (Pro 季付 / ¥402.3) [Pro/Max/Lite] › Pro
? 轮询间隔 ms [100-500] › 200
? 开始抢购? (Y/n) › Y

✓ Cookie 从 Chrome 提取成功
✓ Token 验证通过 (ilfir364)
✓ 目标: product-fef82f Pro 季付 ¥402.3

🚀 抢购中... (0.2s/次, 已请求 15 次)
```

## Project Structure

```
zhipu-codeplan-sniper/
├── src/
│   ├── index.ts           # CLI entry + interactive confirmation
│   ├── cookie.ts          # Chrome cookie extraction (chrome-cookies-secure)
│   ├── api.ts             # API client (batch-preview, createPreOrder, getCustomerInfo)
│   ├── sniper.ts          # Sniper engine (poll → order → open)
│   └── config.ts          # Plan constants (Lite=49, Pro=149, Max=469) + defaults
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## Core Flow

```
Start
 → Extract Chrome cookie (bigmodel_token_production)
 → GET getCustomerInfo → verify token
 → Interactive confirm (plan, interval)
 → Enter sniper loop
   → POST batch-preview
   → Find target plan: monthlyOriginalAmount matches + 季付 discount
   → soldOut=false → POST createPreOrder
   → Order created → open payment URL → notify + beep
   → Order failed → continue polling
   → No stock → random interval, retry
 → User Ctrl+C to stop
```

## API Details

| Step | URL | Method | Body |
|------|-----|--------|------|
| Verify | `open.bigmodel.cn/api/biz/customer/getCustomerInfo` | GET | - |
| Inventory | `open.bigmodel.cn/api/biz/pay/batch-preview` | POST | `{"invitationCode":""}` |
| Order | `open.bigmodel.cn/api/biz/product/createPreOrder` | POST | `{"productId":"...","payPrice":...,"num":1,"isMobile":false,"channelCode":"WEB"}` |

Shared headers:
```
Authorization: <token from chrome cookie>
bigmodel-organization: org-926bfC72DC024473Bc02ECc731A83cf2
bigmodel-project: proj_4691457280004322950Fb7F3BA54f661
Content-Type: application/json
```

## Product Matching (Dynamic)

Do NOT hardcode product IDs. Match dynamically from batch-preview response:

- Plan: `monthlyOriginalAmount` (Lite=49, Pro=149, Max=469)
- Duration: `campaignDiscountDetails` contains "连续包季 9 折" → quarterly
- First batch-preview: list all products for user confirmation
- Subsequent polls: match by monthlyOriginalAmount + discount identifier

## Polling Strategy

- Interval: random within user-specified range (default 200ms, range 100-500ms)
- Duration: unlimited, Ctrl+C to stop
- Rate limit (HTTP 555/429): exponential backoff 0.5s → 1s → 2s (max 2s), reset on success
- Success: open payment page, print order info, don't exit (keep monitoring)

## Error Handling

| Case | Action |
|------|--------|
| Cookie extraction fails | Error exit, prompt to login Chrome |
| Token expired (401/403) | Error exit, prompt to re-login |
| Rate limit (555/429) | Exponential backoff, max 2s |
| createPreOrder "资源包类型错误" | Sold out, continue polling |
| createPreOrder other error | Print error, continue polling |
| Network timeout (5s) | Skip, continue |
| DNS/connection failure | Wait 2s, retry |

## Success Notification

- `child_process.exec('open https://open.bigmodel.cn/console/overview')`
- Terminal: order number + payment amount
- macOS notification: `osascript -e 'display notification ...'`
- Terminal beep: `\x07`

## Logging

- Real-time terminal output per request (sequence, latency, stock status)
- No log files

## Tech Stack

- Runtime: Node.js >= 18
- Language: TypeScript
- Build: tsup (single-file CLI bundle)
- Cookie: `chrome-cookies-secure`
- Prompts: `@clack/prompts`
- Output: `chalk` + `ora`
- HTTP: native `fetch` (Node 18+)
- Open browser: `child_process.exec('open ...')`

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

## Out of Scope (YAGNI)

- Multi-account support
- Scheduled start (launch = start)
- Auto-pay with balance
- Linux/Windows compatibility
- Log files
- Config file persistence
