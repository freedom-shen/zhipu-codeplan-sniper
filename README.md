# zhipu-codeplan-sniper

智谱 GLM Coding Plan 抢购工具。自动从 Chrome 提取 Cookie，支持**定时狙击**（提前缓存产品、到点直接下单）和**持续轮询**两种模式，抢到后打开支付页等待扫码。

## 安装

```bash
npx zhipu-codeplan-sniper
```

## 使用

```bash
npx zhipu-codeplan-sniper
```

启动后交互确认套餐、开抢时间和轮询间隔，回车即开始：

```
? 目标套餐 [Pro/Max/Lite] › Pro
? 开抢时间 (HH:MM，输入 now 立即开始轮询) › 10:00
? 轮询间隔 (ms，兜底/轮询模式使用) › 200
? 开始抢购? (Y/n) › Y

🎯 定时狙击 Pro 季付 | 开抢 06-08 10:00 | Ctrl+C 停止
   已缓存: ¥402.3 (productId: xxx)
   时钟偏移: +320ms (服务器-本地)

   距开抢 00:19:32 | 缓存: Pro 季付 ¥402.3 (售罄中)
   ...
⚡ 冲刺开始！每 200ms 一发，直接下单
   请求 #1 (81ms): 空枪（未放货）
   请求 #2 (65ms): 有库存！下单成功 🎉
```

Ctrl+C 停止。

### 两种模式

- **定时狙击（默认）**：输入开抢时间（如 `10:00`），工具提前缓存目标 productId，等待期每 60s 低频保活刷新，开抢前 5s 用服务器 Date 头校时，**提前 2s 起跑、每 200ms 直接打下单接口**（跳过查库存的往返，单发只需 ~60-100ms）。冲刺 30s 未成功自动回落轮询模式兜底。时间已过自动顺延到明天。
- **持续轮询**：开抢时间输入 `now`，按设定间隔轮询库存，检测到有货立即下单。

## 系统和环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | macOS（依赖 macOS 钥匙串解密 Chrome Cookie） |
| 浏览器 | Google Chrome（需已登录 [open.bigmodel.cn](https://open.bigmodel.cn)） |
| Node.js | >= 18（使用原生 fetch） |
| npm | >= 7（npx 支持） |
| 钥匙串权限 | 首次运行时 macOS 会弹出钥匙串授权，需点击"允许" |

> 注意：首次运行时 Chrome 需处于关闭或至少已登录 open.bigmodel.cn 状态。终端需要钥匙串访问权限来解密 Cookie。

## 套餐

| 套餐 | 月原价 | 季付实付 | 折扣 |
|------|--------|----------|------|
| Lite | ¥49/月 | ¥132.3/季 | 连续包季 9 折 |
| Pro  | ¥149/月 | ¥402.3/季 | 连续包季 9 折 |
| Max  | ¥469/月 | ¥1266.3/季 | 连续包季 9 折 |

## 开发

```bash
npm install
npm run build
npm run test:e2e   # 全链路测试
npm start           # 运行
```

## License

MIT
