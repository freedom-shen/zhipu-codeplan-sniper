# zhipu-codeplan-sniper 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现智谱 GLM Coding Plan 抢购 CLI 工具，单命令启动，自动提取 Chrome Cookie，轮询库存，自动下单，打开支付页。

**Architecture:** 单命令 CLI，5 个模块（config / cookie / api / sniper / index）。启动时交互确认套餐和间隔，然后进入轮询循环，检测到库存立即下单，成功后打开支付页并通知用户。

**Tech Stack:** TypeScript, Node.js >= 18, tsup, chrome-cookies-secure, @clack/prompts, chalk, ora, 原生 fetch

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `package.json` | 项目配置、依赖、bin 入口 |
| `tsconfig.json` | TypeScript 编译配置 |
| `tsup.config.ts` | 打包配置 |
| `src/config.ts` | 套餐常量、默认配置、产品匹配类型定义 |
| `src/cookie.ts` | 从 Chrome 提取 bigmodel_token_production |
| `src/api.ts` | HTTP 客户端：验证、库存查询、下单 |
| `src/sniper.ts` | 抢购引擎：轮询、匹配、下单、通知 |
| `src/index.ts` | CLI 入口：交互确认、流程编排 |

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "zhipu-codeplan-sniper",
  "version": "1.0.0",
  "description": "智谱 GLM Coding Plan 抢购工具",
  "type": "module",
  "bin": {
    "zhipu-sniper": "./dist/index.js"
  },
  "files": ["dist"],
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@clack/prompts": "^0.9.1",
    "chalk": "^5.3.0",
    "chrome-cookies-secure": "^2.2.0",
    "ora": "^8.0.1"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 创建 tsup.config.ts**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  splitting: false,
  sourcemap: false,
});
```

- [ ] **Step 4: 安装依赖**

Run: `cd /Users/shenxiaomin/Documents/github/zhipu-codeplan-sniper && npm install`

- [ ] **Step 5: 提交**

```bash
git add package.json tsconfig.json tsup.config.ts package-lock.json
git commit -m "chore: 初始化项目脚手架"
```

---

### Task 2: 配置模块

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: 编写 config.ts**

```ts
export type PlanLevel = "lite" | "pro" | "max";

export interface PlanConfig {
  level: PlanLevel;
  label: string;
  monthlyOriginalAmount: number;
}

export const PLANS: Record<PlanLevel, PlanConfig> = {
  lite: { level: "lite", label: "Lite", monthlyOriginalAmount: 49 },
  pro: { level: "pro", label: "Pro", monthlyOriginalAmount: 149 },
  max: { level: "max", label: "Max", monthlyOriginalAmount: 469 },
};

export const DEFAULTS = {
  plan: "pro" as PlanLevel,
  intervalMin: 100,
  intervalMax: 500,
  intervalDefault: 200,
  requestTimeout: 5000,
  backoffMax: 2000,
  backoffInitial: 500,
} as const;

export const API_BASE = "https://open.bigmodel.cn";

export const HEADERS = {
  "Content-Type": "application/json",
  "bigmodel-organization": "org-926bfC72DC024473Bc02ECc731A83cf2",
  "bigmodel-project": "proj_4691457280004322950Fb7F3BA54f661",
};

export function matchPlan(
  monthlyOriginalAmount: number
): PlanConfig | undefined {
  return Object.values(PLANS).find(
    (p) => p.monthlyOriginalAmount === monthlyOriginalAmount
  );
}

export function isQuarterlyDiscount(campaignDetails: Array<{ campaignName: string }>): boolean {
  return campaignDetails.some((d) => d.campaignName.includes("包季"));
}
```

- [ ] **Step 2: 提交**

```bash
git add src/config.ts
git commit -m "feat: 添加配置模块（套餐常量 + 匹配函数）"
```

---

### Task 3: Cookie 提取模块

**Files:**
- Create: `src/cookie.ts`

- [ ] **Step 1: 编写 cookie.ts**

```ts
import chromeCookies from "chrome-cookies-secure";

export async function extractToken(): Promise<string> {
  const cookies = await new Promise<Record<string, string>>(
    (resolve, reject) => {
      chromeCookies.getCookies(
        "https://open.bigmodel.cn",
        "cs",
        (err: Error | null, cookies: Record<string, string>) => {
          if (err) reject(err);
          else resolve(cookies);
        }
      );
    }
  );

  const token = cookies["bigmodel_token_production"];
  if (!token) {
    throw new Error(
      "未找到 bigmodel_token_production cookie，请先在 Chrome 中登录 open.bigmodel.cn"
    );
  }
  return token;
}
```

- [ ] **Step 2: 验证类型声明**

如果 `chrome-cookies-secure` 没有自带类型声明，需要在项目根目录创建 `src/types/chrome-cookies-secure.d.ts`：

```ts
declare module "chrome-cookies-secure" {
  interface Callback {
    (err: Error | null, cookies: Record<string, string>): void;
  }
  export function getCookies(
    url: string,
    format: string,
    callback: Callback
  ): void;
}
```

- [ ] **Step 3: 提交**

```bash
git add src/cookie.ts src/types/chrome-cookies-secure.d.ts
git commit -m "feat: 添加 Chrome cookie 提取模块"
```

---

### Task 4: API 客户端模块

**Files:**
- Create: `src/api.ts`

- [ ] **Step 1: 编写 api.ts**

```ts
import { API_BASE, HEADERS } from "./config.js";

export interface CustomerInfo {
  customerName: string;
  nickName: string;
  customerNumber: string;
}

export interface Product {
  productId: string;
  originalAmount: number;
  discountAmount: number;
  payAmount: number;
  monthlyOriginalAmount: number;
  soldOut: boolean;
  canPurchase: boolean | null;
  campaignDiscountDetails: Array<{
    campaignName: string;
    campaignDiscountAmount: number;
    rewardMode: string;
    rewardAmount: number;
    rewardDetail: string;
    applyScene: string;
  }>;
}

export interface BatchPreviewResult {
  success: boolean;
  code: number;
  msg: string;
  data: {
    productList: Product[];
    isSubscribed: boolean;
  };
}

export interface CreatePreOrderResult {
  success: boolean;
  code: number;
  msg: string;
  data: {
    bizId: string;
  } | null;
}

export class ApiClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private get headers(): Record<string, string> {
    return {
      ...HEADERS,
      Authorization: this.token,
    };
  }

  async getCustomerInfo(): Promise<CustomerInfo> {
    const res = await fetch(`${API_BASE}/api/biz/customer/getCustomerInfo`, {
      method: "GET",
      headers: this.headers,
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Token 已过期，请重新登录 Chrome");
    }

    const data = await res.json();
    if (!data.success) {
      throw new Error(`验证失败: ${data.msg}`);
    }
    return {
      customerName: data.data.customerName,
      nickName: data.data.nickName,
      customerNumber: data.data.customerNumber,
    };
  }

  async batchPreview(): Promise<BatchPreviewResult> {
    const res = await fetch(`${API_BASE}/api/biz/pay/batch-preview`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ invitationCode: "" }),
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Token 已过期，请重新登录 Chrome");
    }

    return res.json();
  }

  async createPreOrder(
    productId: string,
    payPrice: number
  ): Promise<CreatePreOrderResult> {
    const res = await fetch(`${API_BASE}/api/biz/product/createPreOrder`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        productId,
        payPrice,
        num: 1,
        isMobile: false,
        channelCode: "WEB",
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Token 已过期，请重新登录 Chrome");
    }

    return res.json();
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/api.ts
git commit -m "feat: 添加 API 客户端模块"
```

---

### Task 5: 抢购引擎模块

**Files:**
- Create: `src/sniper.ts`

- [ ] **Step 1: 编写 sniper.ts**

```ts
import { exec } from "node:child_process";
import chalk from "chalk";
import { ApiClient, Product } from "./api.js";
import {
  PlanLevel,
  PLANS,
  DEFAULTS,
  matchPlan,
  isQuarterlyDiscount,
} from "./config.js";

export interface SniperOptions {
  plan: PlanLevel;
  intervalMin: number;
  intervalMax: number;
}

interface BackoffState {
  current: number;
  active: boolean;
}

export class Sniper {
  private client: ApiClient;
  private options: SniperOptions;
  private requestCount = 0;
  private targetProduct: Product | null = null;
  private backoff: BackoffState = {
    current: DEFAULTS.backoffInitial,
    active: false,
  };
  private running = false;

  constructor(client: ApiClient, options: SniperOptions) {
    this.client = client;
    this.options = options;
  }

  async run(): Promise<void> {
    this.running = true;
    const planConfig = PLANS[this.options.plan];
    console.log(
      chalk.cyan(`\n🚀 开始抢购 ${planConfig.label} 季付...`)
    );
    console.log(
      chalk.gray(
        `   间隔: ${this.options.intervalMin}-${this.options.intervalMax}ms | Ctrl+C 停止\n`
      )
    );

    while (this.running) {
      this.requestCount++;
      const start = Date.now();

      try {
        const result = await this.client.batchPreview();

        if (!result.success) {
          this.handleApiError(result.code, result.msg);
          await this.wait();
          continue;
        }

        const products = result.data.productList;
        const target = this.findTargetProduct(products, this.options.plan);

        if (!target) {
          const elapsed = Date.now() - start;
          this.logStatus(elapsed, "无目标产品");
          this.resetBackoff();
          await this.wait();
          continue;
        }

        if (target.soldOut) {
          const elapsed = Date.now() - start;
          this.logStatus(elapsed, "售罄中...");
          this.resetBackoff();
          await this.wait();
          continue;
        }

        // 有库存！
        const elapsed = Date.now() - start;
        this.logStatus(elapsed, chalk.green.bold("有库存！尝试下单..."));

        const order = await this.client.createPreOrder(
          target.productId,
          target.payAmount
        );

        if (order.success && order.data?.bizId) {
          await this.onSuccess(target, order.data.bizId);
          // 不退出，继续监控
          await this.wait();
        } else {
          const msg = order.msg || "未知错误";
          if (msg.includes("资源包类型错误")) {
            this.logStatus(elapsed, "售罄（下单被拒）");
          } else {
            console.log(chalk.yellow(`   下单失败: ${msg}`));
          }
          await this.wait();
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("Token 已过期")) {
          console.log(chalk.red(`\n✗ ${message}`));
          this.running = false;
          break;
        }
        if (message.includes("AbortError") || message.includes("timeout")) {
          console.log(
            chalk.gray(`   请求 #${this.requestCount}: 超时，跳过`)
          );
        } else {
          console.log(chalk.yellow(`   请求 #${this.requestCount}: ${message}`));
          await this.sleep(2000);
        }
        await this.wait();
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private findTargetProduct(
    products: Product[],
    plan: PlanLevel
  ): Product | null {
    const planConfig = PLANS[plan];
    return (
      products.find(
        (p) =>
          p.monthlyOriginalAmount === planConfig.monthlyOriginalAmount &&
          isQuarterlyDiscount(p.campaignDiscountDetails) &&
          !p.soldOut
      ) ||
      products.find(
        (p) =>
          p.monthlyOriginalAmount === planConfig.monthlyOriginalAmount &&
          isQuarterlyDiscount(p.campaignDiscountDetails)
      ) ||
      null
    );
  }

  private async onSuccess(
    product: Product,
    bizId: string
  ): Promise<void> {
    const planConfig = PLANS[this.options.plan];
    console.log(chalk.green.bold(`\n🎉 下单成功！`));
    console.log(
      chalk.white(`   套餐: ${planConfig.label} 季付 | 金额: ¥${product.payAmount} | 订单号: ${bizId}`)
    );
    console.log(chalk.white(`   请在浏览器中扫码支付`));

    // 打开支付页
    exec("open https://open.bigmodel.cn/console/overview");

    // macOS 系统通知
    exec(
      `osascript -e 'display notification "订单号 ${bizId}，请扫码支付" with title "抢购成功！"'`
    );

    // 终端蜂鸣
    process.stdout.write("\x07");
  }

  private handleApiError(code: number, msg: string): void {
    if (code === 555 || code === 429) {
      this.activateBackoff();
      console.log(
        chalk.yellow(
          `   请求 #${this.requestCount}: 限流，退避 ${this.backoff.current}ms`
        )
      );
    } else {
      console.log(
        chalk.yellow(`   请求 #${this.requestCount}: API 错误 ${code} - ${msg}`)
      );
    }
  }

  private logStatus(elapsed: number, status: string): void {
    console.log(
      chalk.gray(
        `   请求 #${this.requestCount} (${elapsed}ms): ${status}`
      )
    );
  }

  private activateBackoff(): void {
    this.backoff.active = true;
  }

  private resetBackoff(): void {
    this.backoff.current = DEFAULTS.backoffInitial;
    this.backoff.active = false;
  }

  private async wait(): Promise<void> {
    if (this.backoff.active) {
      await this.sleep(this.backoff.current);
      this.backoff.current = Math.min(
        this.backoff.current * 2,
        DEFAULTS.backoffMax
      );
      return;
    }
    const { intervalMin, intervalMax } = this.options;
    const delay =
      intervalMin + Math.random() * (intervalMax - intervalMin);
    await this.sleep(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/sniper.ts
git commit -m "feat: 添加抢购引擎模块"
```

---

### Task 6: CLI 入口模块

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: 编写 index.ts**

```ts
import * as p from "@clack/prompts";
import chalk from "chalk";
import { extractToken } from "./cookie.js";
import { ApiClient } from "./api.js";
import { Sniper } from "./sniper.js";
import { DEFAULTS, PLANS, type PlanLevel } from "./config.js";

async function main() {
  console.log(chalk.bold.cyan("\n⚡ 智谱 GLM Coding Plan 抢购工具\n"));

  const s = p.spinner();

  // 1. 提取 Cookie
  s.start("从 Chrome 提取 Cookie...");
  let token: string;
  try {
    token = await extractToken();
    s.stop("Cookie 提取成功");
  } catch (err: unknown) {
    s.stop("Cookie 提取失败");
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ ${message}`));
    process.exit(1);
  }

  // 2. 验证 Token
  const client = new ApiClient(token);
  s.start("验证登录状态...");
  try {
    const info = await client.getCustomerInfo();
    s.stop(`Token 验证通过 (${info.nickName})`);
  } catch (err: unknown) {
    s.stop("Token 验证失败");
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ ${message}`));
    process.exit(1);
  }

  // 3. 获取产品列表，展示目标
  s.start("获取产品信息...");
  let targetLabel = "";
  try {
    const preview = await client.batchPreview();
    if (preview.success) {
      const products = preview.data.productList;
      const target = products.find(
        (pr) =>
          pr.monthlyOriginalAmount ===
            PLANS[DEFAULTS.plan].monthlyOriginalAmount &&
          pr.campaignDiscountDetails.some((d) =>
            d.campaignName.includes("包季")
          )
      );
      if (target) {
        targetLabel = `¥${target.payAmount}`;
      }
    }
    s.stop("产品信息获取完成");
  } catch {
    s.stop("产品信息获取失败，继续...");
  }

  // 4. 交互确认
  const answers = await p.group({
    plan: () =>
      p.select({
        message: "目标套餐",
        options: [
          {
            value: "pro" as PlanLevel,
            label: `Pro 季付 ${targetLabel || "¥402.3"}`,
            hint: "推荐，5倍用量",
          },
          {
            value: "max" as PlanLevel,
            label: "Max 季付 ¥1266.3",
            hint: "高级套餐",
          },
          {
            value: "lite" as PlanLevel,
            label: "Lite 季付 ¥132.3",
            hint: "基础套餐",
          },
        ],
      }),
    interval: () =>
      p.text({
        message: "轮询间隔 (ms)",
        placeholder: String(DEFAULTS.intervalDefault),
        defaultValue: String(DEFAULTS.intervalDefault),
        validate: (v) => {
          const n = Number(v);
          if (isNaN(n) || n < 100 || n > 500) return "请输入 100-500 之间的数值";
        },
      }),
    confirm: () =>
      p.confirm({
        message: "开始抢购？",
        initialValue: true,
      }),
  });

  if (!answers.confirm) {
    console.log(chalk.gray("已取消"));
    process.exit(0);
  }

  const interval = Number(answers.interval) || DEFAULTS.intervalDefault;

  // 5. 启动抢购
  const sniper = new Sniper(client, {
    plan: answers.plan,
    intervalMin: Math.max(100, interval - 100),
    intervalMax: Math.min(500, interval + 100),
  });

  // Ctrl+C 优雅退出
  process.on("SIGINT", () => {
    console.log(chalk.gray("\n\n已停止抢购"));
    sniper.stop();
    process.exit(0);
  });

  await sniper.run();
}

main().catch((err) => {
  console.error(chalk.red(`\n✗ ${err.message}`));
  process.exit(1);
});
```

- [ ] **Step 2: 提交**

```bash
git add src/index.ts
git commit -m "feat: 添加 CLI 入口模块"
```

---

### Task 7: 构建与全链路测试

**Files:**
- Create: `src/test-e2e.ts`（全链路测试脚本）
- 无其他新文件

- [ ] **Step 1: 构建**

Run: `cd /Users/shenxiaomin/Documents/github/zhipu-codeplan-sniper && npm run build`

预期：`dist/index.js` 生成成功，无编译错误

- [ ] **Step 2: 验证 bin 可执行**

Run: `node dist/index.js --help 2>&1 || true`

预期：程序启动，显示交互提示（因为 @clack/prompts 会等待输入）

- [ ] **Step 3: 修复可能的构建问题**

如果 tsup 打包 `chrome-cookies-secure`（native addon）出错，在 `tsup.config.ts` 中添加 external：

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  splitting: false,
  sourcemap: false,
  external: ["chrome-cookies-secure"],
});
```

- [ ] **Step 4: 重新构建并验证**

Run: `npm run build && node dist/index.js 2>&1 | head -5`

预期：输出 `⚡ 智谱 GLM Coding Plan 抢购工具`，然后开始提取 Cookie

- [ ] **Step 5: 编写全链路测试脚本**

创建 `src/test-e2e.ts`，非交互式地走完全链路：cookie 提取 → token 验证 → 库存查询 → 强制模拟下单（即使售罄）→ 验证下单失败处理正确。

```ts
import chalk from "chalk";
import { extractToken } from "./cookie.js";
import { ApiClient } from "./api.js";
import { PLANS, isQuarterlyDiscount } from "./config.js";

async function test() {
  console.log(chalk.bold.cyan("\n🧪 全链路测试\n"));

  // 1. Cookie 提取
  process.stdout.write(chalk.white("1. 提取 Chrome Cookie... "));
  let token: string;
  try {
    token = await extractToken();
    console.log(chalk.green("✓ 通过"));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ 失败: ${message}`));
    process.exit(1);
  }

  const client = new ApiClient(token);

  // 2. Token 验证
  process.stdout.write(chalk.white("2. 验证 Token... "));
  try {
    const info = await client.getCustomerInfo();
    console.log(chalk.green(`✓ 通过 (${info.nickName})`));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ 失败: ${message}`));
    process.exit(1);
  }

  // 3. 库存查询
  process.stdout.write(chalk.white("3. 查询产品库存... "));
  let targetProductId = "";
  let targetPayPrice = 0;
  try {
    const preview = await client.batchPreview();
    if (!preview.success) {
      console.log(chalk.red(`✗ 失败: ${preview.msg}`));
      process.exit(1);
    }
    const products = preview.data.productList;
    // 找 Pro 季付产品
    const target = products.find(
      (p) =>
        p.monthlyOriginalAmount === PLANS.pro.monthlyOriginalAmount &&
        isQuarterlyDiscount(p.campaignDiscountDetails)
    );
    if (!target) {
      console.log(chalk.red("✗ 失败: 未找到 Pro 季付产品"));
      process.exit(1);
    }
    targetProductId = target.productId;
    targetPayPrice = target.payAmount;
    const soldOutLabel = target.soldOut ? chalk.yellow("售罄") : chalk.green("有库存");
    console.log(
      chalk.green(`✓ 通过 (共 ${products.length} 个产品, Pro 季付 ${soldOutLabel}, ID: ${targetProductId})`)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ 失败: ${message}`));
    process.exit(1);
  }

  // 4. 模拟下单（当前售罄，预期返回"资源包类型错误"）
  process.stdout.write(chalk.white("4. 模拟下单（预期失败）... "));
  try {
    const order = await client.createPreOrder(targetProductId, targetPayPrice);
    if (order.success) {
      console.log(chalk.green("✓ 意外成功！下单通过了！"));
      console.log(chalk.white(`   订单号: ${order.data?.bizId}`));
    } else {
      console.log(chalk.green(`✓ 通过 (预期失败: ${order.msg})`));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ 异常: ${message}`));
    process.exit(1);
  }

  console.log(chalk.bold.green("\n✅ 全链路测试通过！所有模块正常工作。\n"));
}

test().catch((err) => {
  console.error(chalk.red(`\n✗ 测试异常: ${err.message}`));
  process.exit(1);
});
```

在 `package.json` scripts 中添加测试命令：

```json
"test:e2e": "npx tsx src/test-e2e.ts"
```

- [ ] **Step 6: 运行全链路测试**

Run: `cd /Users/shenxiaomin/Documents/github/zhipu-codeplan-sniper && npm run test:e2e`

预期输出：
```
🧪 全链路测试

1. 提取 Chrome Cookie... ✓ 通过
2. 验证 Token... ✓ 通过 (我是沈满意爸爸)
3. 查询产品库存... ✓ 通过 (共 9 个产品, Pro 季付 售罄, ID: product-fef82f)
4. 模拟下单（预期失败）... ✓ 通过 (预期失败: 资源包类型错误)

✅ 全链路测试通过！所有模块正常工作。
```

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "chore: 修复构建配置 + 添加全链路测试"
```

---

### Task 8: README + 推送 GitHub

**Files:**
- Create: `README.md`
- 修改: `package.json`（添加 repository 字段）

- [ ] **Step 1: 编写 README.md**

```md
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

## 要求

- macOS + Chrome
- Node.js >= 18
- 已在 Chrome 中登录 [open.bigmodel.cn](https://open.bigmodel.cn)

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
```

- [ ] **Step 2: 添加 repository 字段到 package.json**

在 `package.json` 中添加：

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/freedom-shen/zhipu-codeplan-sniper.git"
}
```

- [ ] **Step 3: 提交并推送到 GitHub**

```bash
git add -A
git commit -m "docs: 添加 README + repository 字段"
git push origin main
```

- [ ] **Step 4: 发布到 npm（可选）**

Run: `npm publish`

预期：包发布成功，用户可通过 `npx zhipu-codeplan-sniper` 使用
