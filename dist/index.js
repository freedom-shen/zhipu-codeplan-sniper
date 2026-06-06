#!/usr/bin/env node

// src/index.ts
import * as p from "@clack/prompts";
import chalk2 from "chalk";

// src/cookie.ts
import chromeCookies from "chrome-cookies-secure";
async function extractToken() {
  const cookies = await chromeCookies.getCookiesPromised(
    "https://bigmodel.cn",
    "object"
  );
  const token = cookies["bigmodel_token_production"];
  if (!token) {
    throw new Error(
      "\u672A\u627E\u5230 bigmodel_token_production cookie\uFF0C\u8BF7\u5148\u5728 Chrome \u4E2D\u767B\u5F55 bigmodel.cn"
    );
  }
  return token;
}

// src/config.ts
var PLANS = {
  lite: { level: "lite", label: "Lite", monthlyOriginalAmount: 49 },
  pro: { level: "pro", label: "Pro", monthlyOriginalAmount: 149 },
  max: { level: "max", label: "Max", monthlyOriginalAmount: 469 }
};
var DEFAULTS = {
  plan: "pro",
  intervalMin: 150,
  intervalMax: 350,
  intervalDefault: 200,
  requestTimeout: 5e3,
  backoffMax: 8e3,
  backoffInitial: 2e3
};
var SNIPE = {
  /** 冲刺期下单间隔 */
  burstIntervalMs: 200,
  /** 提前起跑量（覆盖时钟误差 + 抢首发） */
  leadTimeMs: 2e3,
  /** 冲刺持续时长，超时回落轮询模式 */
  burstDurationMs: 3e4,
  /** 等待期保活刷新间隔 */
  keepAliveMs: 6e4,
  /** 冲刺期遇限流的固定退避 */
  limitBackoffMs: 1e3,
  /** 开抢前多久做最后一次校时+缓存刷新 */
  finalSyncAheadMs: 5e3,
  /** 默认开抢时间 */
  defaultTime: "10:00"
};
function parseTargetTime(input, now) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(input.trim());
  if (!m) return null;
  const target = new Date(now);
  target.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}
var API_BASE = "https://bigmodel.cn";
var HEADERS = {
  "Content-Type": "application/json",
  "bigmodel-organization": "org-926bfC72DC024473Bc02ECc731A83cf2",
  "bigmodel-project": "proj_4691457280004322950Fb7F3BA54f661"
};
function isQuarterlyDiscount(campaignDetails) {
  return campaignDetails.some((d) => d.campaignName.includes("\u5305\u5B63"));
}

// src/api.ts
var ApiClient = class {
  token;
  constructor(token) {
    this.token = token;
  }
  get headers() {
    return {
      ...HEADERS,
      Authorization: this.token
    };
  }
  async getCustomerInfo() {
    const res = await fetch(`${API_BASE}/api/biz/customer/getCustomerInfo`, {
      method: "GET",
      headers: this.headers,
      signal: AbortSignal.timeout(5e3)
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Token \u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55 Chrome");
    }
    const data = await res.json();
    if (!data.success) {
      throw new Error(`\u9A8C\u8BC1\u5931\u8D25: ${data.msg}`);
    }
    return {
      customerName: data.data.customerName,
      nickName: data.data.nickName,
      customerNumber: data.data.customerNumber
    };
  }
  async batchPreview() {
    const res = await fetch(`${API_BASE}/api/biz/pay/batch-preview`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ invitationCode: "" }),
      signal: AbortSignal.timeout(5e3)
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Token \u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55 Chrome");
    }
    const body = await res.json();
    const dateHeader = res.headers.get("date");
    body.serverDate = dateHeader ? new Date(dateHeader) : null;
    return body;
  }
  async createPreOrder(productId, payPrice) {
    const res = await fetch(`${API_BASE}/api/biz/product/createPreOrder`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        productId,
        payPrice,
        num: 1,
        isMobile: false,
        channelCode: "WEB"
      }),
      signal: AbortSignal.timeout(5e3)
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Token \u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55 Chrome");
    }
    return res.json();
  }
};

// src/sniper.ts
import { exec } from "child_process";
import chalk from "chalk";
var Sniper = class {
  client;
  options;
  requestCount = 0;
  backoff = {
    current: DEFAULTS.backoffInitial,
    active: false
  };
  running = false;
  constructor(client, options) {
    this.client = client;
    this.options = options;
  }
  async run() {
    this.running = true;
    const planConfig = PLANS[this.options.plan];
    console.log(chalk.cyan(`
\u{1F680} \u5F00\u59CB\u62A2\u8D2D ${planConfig.label} \u5B63\u4ED8...`));
    console.log(
      chalk.gray(
        `   \u95F4\u9694: ${this.options.intervalMin}-${this.options.intervalMax}ms | Ctrl+C \u505C\u6B62
`
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
          const elapsed2 = Date.now() - start;
          this.logStatus(elapsed2, "\u65E0\u76EE\u6807\u4EA7\u54C1");
          this.decayBackoff();
          await this.wait();
          continue;
        }
        if (target.soldOut) {
          const elapsed2 = Date.now() - start;
          this.logStatus(elapsed2, "\u552E\u7F44\u4E2D...");
          this.decayBackoff();
          await this.wait();
          continue;
        }
        const elapsed = Date.now() - start;
        this.logStatus(elapsed, chalk.green.bold("\u6709\u5E93\u5B58\uFF01\u5C1D\u8BD5\u4E0B\u5355..."));
        const order = await this.client.createPreOrder(
          target.productId,
          target.payAmount
        );
        if (order.success && order.data?.bizId) {
          await this.onSuccess(target, order.data.bizId);
          await this.wait();
        } else {
          const msg = order.msg || "\u672A\u77E5\u9519\u8BEF";
          if (msg.includes("\u8D44\u6E90\u5305\u7C7B\u578B\u9519\u8BEF")) {
            this.logStatus(elapsed, "\u552E\u7F44\uFF08\u4E0B\u5355\u88AB\u62D2\uFF09");
          } else {
            console.log(chalk.yellow(`   \u4E0B\u5355\u5931\u8D25: ${msg}`));
          }
          await this.wait();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("Token \u5DF2\u8FC7\u671F")) {
          console.log(chalk.red(`
\u2717 ${message}`));
          this.running = false;
          break;
        }
        if (message.includes("AbortError") || message.includes("timeout")) {
          console.log(
            chalk.gray(`   \u8BF7\u6C42 #${this.requestCount}: \u8D85\u65F6\uFF0C\u8DF3\u8FC7`)
          );
        } else {
          console.log(
            chalk.yellow(`   \u8BF7\u6C42 #${this.requestCount}: ${message}`)
          );
          await this.sleep(2e3);
        }
        await this.wait();
      }
    }
  }
  stop() {
    this.running = false;
  }
  /**
   * 定时狙击：提前缓存 productId，到点直接打 createPreOrder，跳过 batch-preview。
   * 等待期 → 校时 → 冲刺期 → 超时回落轮询模式。
   */
  async snipe(target) {
    this.running = true;
    const planConfig = PLANS[this.options.plan];
    const clock = `${String(target.getMonth() + 1).padStart(2, "0")}-${String(
      target.getDate()
    ).padStart(2, "0")} ${String(target.getHours()).padStart(2, "0")}:${String(
      target.getMinutes()
    ).padStart(2, "0")}`;
    console.log(
      chalk.cyan(`
\u{1F3AF} \u5B9A\u65F6\u72D9\u51FB ${planConfig.label} \u5B63\u4ED8 | \u5F00\u62A2 ${clock} | Ctrl+C \u505C\u6B62`)
    );
    let cached = null;
    let clockOffset = 0;
    const serverNow = () => Date.now() + clockOffset;
    const refresh = async () => {
      const result = await this.client.batchPreview();
      if (result.serverDate && !isNaN(result.serverDate.getTime())) {
        clockOffset = result.serverDate.getTime() - Date.now();
      }
      if (result.success) {
        return this.findTargetProduct(
          result.data.productList,
          this.options.plan
        );
      }
      return null;
    };
    try {
      cached = await refresh() ?? cached;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Token \u5DF2\u8FC7\u671F")) {
        console.log(chalk.red(`\u2717 ${message}`));
        return;
      }
      console.log(chalk.yellow(`   \u521D\u59CB\u4EA7\u54C1\u83B7\u53D6\u5931\u8D25: ${message}\uFF0C\u7B49\u5F85\u671F\u4F1A\u91CD\u8BD5`));
    }
    if (cached) {
      console.log(
        chalk.gray(`   \u5DF2\u7F13\u5B58: \xA5${cached.payAmount} (productId: ${cached.productId})`)
      );
    }
    console.log(
      chalk.gray(
        `   \u65F6\u949F\u504F\u79FB: ${clockOffset >= 0 ? "+" : ""}${clockOffset}ms (\u670D\u52A1\u5668-\u672C\u5730)
`
      )
    );
    let lastRefresh = Date.now();
    let finalSyncDone = false;
    while (this.running) {
      const remain = target.getTime() - serverNow();
      if (remain <= SNIPE.leadTimeMs) break;
      if (cached && !cached.soldOut) {
        process.stdout.write("\n");
        console.log(chalk.green.bold("   \u63D0\u524D\u53D1\u73B0\u6709\u5E93\u5B58\uFF01\u7ACB\u5373\u5F00\u62A2"));
        break;
      }
      const finalSyncWindow = SNIPE.finalSyncAheadMs + SNIPE.leadTimeMs;
      const needFinalSync = !finalSyncDone && remain <= finalSyncWindow;
      const needKeepAlive = Date.now() - lastRefresh >= SNIPE.keepAliveMs && remain > finalSyncWindow + 2e3;
      const needRetry = !cached && Date.now() - lastRefresh >= 5e3;
      if (needFinalSync || needKeepAlive || needRetry) {
        try {
          cached = await refresh() ?? cached;
          lastRefresh = Date.now();
          if (needFinalSync) finalSyncDone = true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("Token \u5DF2\u8FC7\u671F")) {
            process.stdout.write("\n");
            console.log(chalk.red(`\u2717 ${message}`));
            this.running = false;
            return;
          }
        }
      }
      const status = cached ? `\xA5${cached.payAmount} (${cached.soldOut ? "\u552E\u7F44\u4E2D" : "\u6709\u8D27"})` : "\u672A\u53D6\u5230\u4EA7\u54C1\uFF0C\u91CD\u8BD5\u4E2D";
      process.stdout.write(
        `\r   ${chalk.gray(
          `\u8DDD\u5F00\u62A2 ${this.formatRemain(remain)} | \u7F13\u5B58: ${planConfig.label} \u5B63\u4ED8 ${status}`
        )}  `
      );
      await this.sleep(Math.min(1e3, Math.max(50, remain - SNIPE.leadTimeMs)));
    }
    if (!this.running) return;
    process.stdout.write("\n");
    if (!cached) {
      console.log(chalk.yellow("   \u65E0\u7F13\u5B58\u4EA7\u54C1\uFF0C\u76F4\u63A5\u56DE\u843D\u8F6E\u8BE2\u6A21\u5F0F"));
      await this.run();
      return;
    }
    console.log(
      chalk.cyan.bold(`
\u26A1 \u51B2\u523A\u5F00\u59CB\uFF01\u6BCF ${SNIPE.burstIntervalMs}ms \u4E00\u53D1\uFF0C\u76F4\u63A5\u4E0B\u5355
`)
    );
    const burstEnd = target.getTime() + SNIPE.burstDurationMs;
    while (this.running && serverNow() < burstEnd) {
      this.requestCount++;
      const start = Date.now();
      try {
        const order = await this.client.createPreOrder(
          cached.productId,
          cached.payAmount
        );
        const elapsed = Date.now() - start;
        if (order.success && order.data?.bizId) {
          await this.onSuccess(cached, order.data.bizId);
          this.running = false;
          return;
        }
        if (order.code === 429 || order.code === 555) {
          this.logStatus(elapsed, `\u9650\u6D41\uFF0C\u9000\u907F ${SNIPE.limitBackoffMs}ms`);
          await this.sleep(SNIPE.limitBackoffMs);
          continue;
        }
        const msg = order.msg || "\u672A\u77E5\u9519\u8BEF";
        if (msg.includes("\u8D44\u6E90\u5305\u7C7B\u578B\u9519\u8BEF")) {
          this.logStatus(elapsed, "\u7A7A\u67AA\uFF08\u672A\u653E\u8D27\uFF09");
        } else {
          this.logStatus(elapsed, `\u4E0B\u5355\u5931\u8D25: ${msg}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("Token \u5DF2\u8FC7\u671F")) {
          console.log(chalk.red(`
\u2717 ${message}`));
          this.running = false;
          return;
        }
        const label = message.includes("AbortError") || message.includes("timeout") ? "\u8D85\u65F6" : message;
        this.logStatus(Date.now() - start, label);
      }
      await this.sleep(SNIPE.burstIntervalMs);
    }
    if (!this.running) return;
    console.log(
      chalk.yellow(
        `
   \u51B2\u523A ${SNIPE.burstDurationMs / 1e3}s \u672A\u6210\u529F\uFF0C\u56DE\u843D\u8F6E\u8BE2\u6A21\u5F0F`
      )
    );
    await this.run();
  }
  formatRemain(ms) {
    const s = Math.max(0, Math.floor(ms / 1e3));
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor(s % 3600 / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${sec}`;
  }
  findTargetProduct(products, plan) {
    const planConfig = PLANS[plan];
    return products.find(
      (p2) => p2.monthlyOriginalAmount === planConfig.monthlyOriginalAmount && isQuarterlyDiscount(p2.campaignDiscountDetails) && !p2.soldOut
    ) || // 没库存的也返回（用于展示状态）
    products.find(
      (p2) => p2.monthlyOriginalAmount === planConfig.monthlyOriginalAmount && isQuarterlyDiscount(p2.campaignDiscountDetails)
    ) || null;
  }
  async onSuccess(product, bizId) {
    const planConfig = PLANS[this.options.plan];
    console.log(chalk.green.bold(`
\u{1F389} \u4E0B\u5355\u6210\u529F\uFF01`));
    console.log(
      chalk.white(
        `   \u5957\u9910: ${planConfig.label} \u5B63\u4ED8 | \u91D1\u989D: \xA5${product.payAmount} | \u8BA2\u5355\u53F7: ${bizId}`
      )
    );
    console.log(chalk.white(`   \u8BF7\u5728\u6D4F\u89C8\u5668\u4E2D\u626B\u7801\u652F\u4ED8`));
    exec("open https://bigmodel.cn/console/overview");
    exec(
      `osascript -e 'display notification "\u8BA2\u5355\u53F7 ${bizId}\uFF0C\u8BF7\u626B\u7801\u652F\u4ED8" with title "\u62A2\u8D2D\u6210\u529F\uFF01"'`
    );
    process.stdout.write("\x07");
  }
  handleApiError(code, msg) {
    if (code === 555 || code === 429) {
      if (this.backoff.active) {
        this.backoff.current = Math.min(
          this.backoff.current * 2,
          DEFAULTS.backoffMax
        );
      }
      this.activateBackoff();
      console.log(
        chalk.yellow(
          `   \u8BF7\u6C42 #${this.requestCount}: \u9650\u6D41\uFF0C\u9000\u907F ${this.backoff.current}ms`
        )
      );
    } else {
      this.backoff.active = true;
      this.backoff.current = Math.max(this.backoff.current, 1e3);
      console.log(
        chalk.yellow(
          `   \u8BF7\u6C42 #${this.requestCount}: API \u9519\u8BEF ${code} - ${msg}`
        )
      );
    }
  }
  logStatus(elapsed, status) {
    console.log(
      chalk.gray(`   \u8BF7\u6C42 #${this.requestCount} (${elapsed}ms): ${status}`)
    );
  }
  activateBackoff() {
    this.backoff.active = true;
  }
  decayBackoff() {
    if (!this.backoff.active) return;
    this.backoff.current = Math.max(
      Math.floor(this.backoff.current / 2),
      this.options.intervalMax
    );
    if (this.backoff.current <= this.options.intervalMax) {
      this.backoff.active = false;
    }
  }
  async wait() {
    if (this.backoff.active) {
      await this.sleep(this.backoff.current);
      return;
    }
    const { intervalMin, intervalMax } = this.options;
    const delay = intervalMin + Math.random() * (intervalMax - intervalMin);
    await this.sleep(delay);
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
};

// src/index.ts
async function main() {
  console.log(chalk2.bold.cyan("\n\u26A1 \u667A\u8C31 GLM Coding Plan \u62A2\u8D2D\u5DE5\u5177\n"));
  const s = p.spinner();
  s.start("\u4ECE Chrome \u63D0\u53D6 Cookie...");
  let token;
  try {
    token = await extractToken();
    s.stop("Cookie \u63D0\u53D6\u6210\u529F");
  } catch (err) {
    s.stop("Cookie \u63D0\u53D6\u5931\u8D25");
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk2.red(`\u2717 ${message}`));
    process.exit(1);
  }
  const client = new ApiClient(token);
  s.start("\u9A8C\u8BC1\u767B\u5F55\u72B6\u6001...");
  try {
    const info = await client.getCustomerInfo();
    s.stop(`Token \u9A8C\u8BC1\u901A\u8FC7 (${info.nickName})`);
  } catch (err) {
    s.stop("Token \u9A8C\u8BC1\u5931\u8D25");
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk2.red(`\u2717 ${message}`));
    process.exit(1);
  }
  s.start("\u83B7\u53D6\u4EA7\u54C1\u4FE1\u606F...");
  let targetLabel = "";
  try {
    const preview = await client.batchPreview();
    if (preview.success) {
      const products = preview.data.productList;
      const target2 = products.find(
        (pr) => pr.monthlyOriginalAmount === PLANS[DEFAULTS.plan].monthlyOriginalAmount && isQuarterlyDiscount(pr.campaignDiscountDetails)
      );
      if (target2) {
        targetLabel = `\xA5${target2.payAmount}`;
      }
    }
    s.stop("\u4EA7\u54C1\u4FE1\u606F\u83B7\u53D6\u5B8C\u6210");
  } catch {
    s.stop("\u4EA7\u54C1\u4FE1\u606F\u83B7\u53D6\u5931\u8D25\uFF0C\u7EE7\u7EED...");
  }
  const answers = await p.group({
    plan: () => p.select({
      message: "\u76EE\u6807\u5957\u9910",
      options: [
        {
          value: "pro",
          label: `Pro \u5B63\u4ED8 ${targetLabel || "\xA5402.3"}`,
          hint: "\u63A8\u8350\uFF0C5\u500D\u7528\u91CF"
        },
        {
          value: "max",
          label: "Max \u5B63\u4ED8 \xA51266.3",
          hint: "\u9AD8\u7EA7\u5957\u9910"
        },
        {
          value: "lite",
          label: "Lite \u5B63\u4ED8 \xA5132.3",
          hint: "\u57FA\u7840\u5957\u9910"
        }
      ]
    }),
    time: () => p.text({
      message: "\u5F00\u62A2\u65F6\u95F4 (HH:MM\uFF0C\u8F93\u5165 now \u7ACB\u5373\u5F00\u59CB\u8F6E\u8BE2)",
      placeholder: SNIPE.defaultTime,
      defaultValue: SNIPE.defaultTime,
      validate: (v) => {
        const s2 = (v || SNIPE.defaultTime).trim();
        if (s2 === "now") return;
        if (!parseTargetTime(s2, /* @__PURE__ */ new Date()))
          return "\u8BF7\u8F93\u5165 HH:MM \u683C\u5F0F\uFF08\u5982 10:00\uFF09\u6216 now";
      }
    }),
    interval: () => p.text({
      message: "\u8F6E\u8BE2\u95F4\u9694 (ms\uFF0C\u515C\u5E95/\u8F6E\u8BE2\u6A21\u5F0F\u4F7F\u7528)",
      placeholder: String(DEFAULTS.intervalDefault),
      defaultValue: String(DEFAULTS.intervalDefault),
      validate: (v) => {
        const n = Number(v);
        if (isNaN(n) || n < 100 || n > 1e3)
          return "\u8BF7\u8F93\u5165 100-1000 \u4E4B\u95F4\u7684\u6570\u503C";
      }
    }),
    confirm: () => p.confirm({
      message: "\u5F00\u59CB\u62A2\u8D2D\uFF1F",
      initialValue: true
    })
  });
  if (!answers.confirm) {
    console.log(chalk2.gray("\u5DF2\u53D6\u6D88"));
    process.exit(0);
  }
  const interval = Number(answers.interval) || DEFAULTS.intervalDefault;
  const sniper = new Sniper(client, {
    plan: answers.plan,
    // 尊重用户输入：以 interval 为下限，避免实际频率比输入更激进而触发限流
    intervalMin: Math.max(100, interval),
    intervalMax: Math.min(1e3, interval + 150)
  });
  process.on("SIGINT", () => {
    console.log(chalk2.gray("\n\n\u5DF2\u505C\u6B62\u62A2\u8D2D"));
    sniper.stop();
    process.exit(0);
  });
  const timeInput = String(answers.time || SNIPE.defaultTime).trim();
  if (timeInput === "now") {
    await sniper.run();
    return;
  }
  const now = /* @__PURE__ */ new Date();
  const target = parseTargetTime(timeInput, now);
  if (target.getDate() !== now.getDate()) {
    console.log(chalk2.yellow(`   \u4ECA\u5929 ${timeInput} \u5DF2\u8FC7\uFF0C\u987A\u5EF6\u81F3\u660E\u5929`));
  }
  await sniper.snipe(target);
}
main().catch((err) => {
  console.error(chalk2.red(`
\u2717 ${err.message}`));
  process.exit(1);
});
