# zhipu-codeplan-sniper

智谱 GLM Coding Plan 抢购工具。自动从 Chrome 提取 Cookie，轮询库存，检测到有货立即下单，打开支付页等待扫码。

## 安装

```bash
npx zhipu-codeplan-sniper
```

## 使用

```bash
npx zhipu-codeplan-sniper
```

启动后交互确认套餐和轮询间隔，回车即开始抢购：

```
? 目标套餐 [Pro/Max/Lite] › Pro
? 轮询间隔 ms [100-500] › 200
? 开始抢购? (Y/n) › Y

✓ Cookie 从 Chrome 提取成功
✓ Token 验证通过 (ilfir364)
✓ 目标: Pro 季付 ¥402.3

🚀 抢购中... (0.2s/次, 已请求 15 次)
```

Ctrl+C 停止。

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
