import { exec } from "node:child_process";
import chalk from "chalk";
import { ApiClient, type Product } from "./api.js";
import {
  type PlanLevel,
  PLANS,
  DEFAULTS,
  SNIPE,
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
    console.log(chalk.cyan(`\n🚀 开始抢购 ${planConfig.label} 季付...`));
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
          this.decayBackoff();
          await this.wait();
          continue;
        }

        if (target.soldOut) {
          const elapsed = Date.now() - start;
          this.logStatus(elapsed, "售罄中...");
          this.decayBackoff();
          await this.wait();
          continue;
        }

        const elapsed = Date.now() - start;
        this.logStatus(elapsed, chalk.green.bold("有库存！尝试下单..."));

        const order = await this.client.createPreOrder(
          target.productId,
          target.payAmount
        );

        if (order.success && order.data?.bizId) {
          await this.onSuccess(target, order.data.bizId);
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
          console.log(
            chalk.yellow(`   请求 #${this.requestCount}: ${message}`)
          );
          await this.sleep(2000);
        }
        await this.wait();
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  /**
   * 定时狙击：提前缓存 productId，到点直接打 createPreOrder，跳过 batch-preview。
   * 等待期 → 校时 → 冲刺期 → 超时回落轮询模式。
   */
  async snipe(target: Date): Promise<void> {
    this.running = true;
    const planConfig = PLANS[this.options.plan];
    const clock = `${String(target.getMonth() + 1).padStart(2, "0")}-${String(
      target.getDate()
    ).padStart(2, "0")} ${String(target.getHours()).padStart(2, "0")}:${String(
      target.getMinutes()
    ).padStart(2, "0")}`;
    console.log(
      chalk.cyan(`\n🎯 定时狙击 ${planConfig.label} 季付 | 开抢 ${clock} | Ctrl+C 停止`)
    );

    let cached: Product | null = null;
    let clockOffset = 0; // 服务器时间 - 本地时间 (ms)
    const serverNow = () => Date.now() + clockOffset;

    const refresh = async (): Promise<Product | null> => {
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

    // 初始缓存
    try {
      cached = (await refresh()) ?? cached;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Token 已过期")) {
        console.log(chalk.red(`✗ ${message}`));
        return;
      }
      console.log(chalk.yellow(`   初始产品获取失败: ${message}，等待期会重试`));
    }

    if (cached) {
      console.log(
        chalk.gray(`   已缓存: ¥${cached.payAmount} (productId: ${cached.productId})`)
      );
    }
    console.log(
      chalk.gray(
        `   时钟偏移: ${clockOffset >= 0 ? "+" : ""}${clockOffset}ms (服务器-本地)\n`
      )
    );

    // ── 等待期：倒计时 + 低频保活刷新 ──
    let lastRefresh = Date.now();
    let finalSyncDone = false;

    while (this.running) {
      const remain = target.getTime() - serverNow();
      if (remain <= SNIPE.leadTimeMs) break;

      // 捡漏：等待期就发现有货，立即进冲刺
      if (cached && !cached.soldOut) {
        process.stdout.write("\n");
        console.log(chalk.green.bold("   提前发现有库存！立即开抢"));
        break;
      }

      const finalSyncWindow = SNIPE.finalSyncAheadMs + SNIPE.leadTimeMs;
      const needFinalSync = !finalSyncDone && remain <= finalSyncWindow;
      const needKeepAlive =
        Date.now() - lastRefresh >= SNIPE.keepAliveMs &&
        remain > finalSyncWindow + 2000;
      const needRetry = !cached && Date.now() - lastRefresh >= 5000;

      if (needFinalSync || needKeepAlive || needRetry) {
        try {
          cached = (await refresh()) ?? cached;
          lastRefresh = Date.now();
          if (needFinalSync) finalSyncDone = true;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("Token 已过期")) {
            process.stdout.write("\n");
            console.log(chalk.red(`✗ ${message}`));
            this.running = false;
            return;
          }
          // 网络抖动等，下一轮再试
        }
      }

      const status = cached
        ? `¥${cached.payAmount} (${cached.soldOut ? "售罄中" : "有货"})`
        : "未取到产品，重试中";
      process.stdout.write(
        `\r   ${chalk.gray(
          `距开抢 ${this.formatRemain(remain)} | 缓存: ${planConfig.label} 季付 ${status}`
        )}  `
      );
      await this.sleep(Math.min(1000, Math.max(50, remain - SNIPE.leadTimeMs)));
    }

    if (!this.running) return;
    process.stdout.write("\n");

    // ── 冲刺期：跳过 batch-preview，直接连发下单 ──
    if (!cached) {
      console.log(chalk.yellow("   无缓存产品，直接回落轮询模式"));
      await this.run();
      return;
    }

    console.log(
      chalk.cyan.bold(`\n⚡ 冲刺开始！每 ${SNIPE.burstIntervalMs}ms 一发，直接下单\n`)
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
          this.logStatus(elapsed, `限流，退避 ${SNIPE.limitBackoffMs}ms`);
          await this.sleep(SNIPE.limitBackoffMs);
          continue;
        }

        const msg = order.msg || "未知错误";
        if (msg.includes("资源包类型错误")) {
          this.logStatus(elapsed, "空枪（未放货）");
        } else {
          this.logStatus(elapsed, `下单失败: ${msg}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("Token 已过期")) {
          console.log(chalk.red(`\n✗ ${message}`));
          this.running = false;
          return;
        }
        const label =
          message.includes("AbortError") || message.includes("timeout")
            ? "超时"
            : message;
        this.logStatus(Date.now() - start, label);
      }
      await this.sleep(SNIPE.burstIntervalMs);
    }

    if (!this.running) return;

    // ── 兜底：productId 可能已变，回落轮询模式重新发现 ──
    console.log(
      chalk.yellow(
        `\n   冲刺 ${SNIPE.burstDurationMs / 1000}s 未成功，回落轮询模式`
      )
    );
    await this.run();
  }

  private formatRemain(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${sec}`;
  }

  private findTargetProduct(
    products: Product[],
    plan: PlanLevel
  ): Product | null {
    const planConfig = PLANS[plan];
    // 优先找有库存的
    return (
      products.find(
        (p) =>
          p.monthlyOriginalAmount === planConfig.monthlyOriginalAmount &&
          isQuarterlyDiscount(p.campaignDiscountDetails) &&
          !p.soldOut
      ) ||
      // 没库存的也返回（用于展示状态）
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
      chalk.white(
        `   套餐: ${planConfig.label} 季付 | 金额: ¥${product.payAmount} | 订单号: ${bizId}`
      )
    );
    console.log(chalk.white(`   请在浏览器中扫码支付`));

    exec("open https://bigmodel.cn/console/overview");
    exec(
      `osascript -e 'display notification "订单号 ${bizId}，请扫码支付" with title "抢购成功！"'`
    );
    process.stdout.write("\x07");
  }

  private handleApiError(code: number, msg: string): void {
    if (code === 555 || code === 429) {
      // 连续限流才升级退避；翻倍只发生在这里，成功请求绝不升级
      if (this.backoff.active) {
        this.backoff.current = Math.min(
          this.backoff.current * 2,
          DEFAULTS.backoffMax
        );
      }
      this.activateBackoff();
      console.log(
        chalk.yellow(
          `   请求 #${this.requestCount}: 限流，退避 ${this.backoff.current}ms`
        )
      );
    } else {
      // 非限流错误也触发退避，但幅度小
      this.backoff.active = true;
      this.backoff.current = Math.max(this.backoff.current, 1000);
      console.log(
        chalk.yellow(
          `   请求 #${this.requestCount}: API 错误 ${code} - ${msg}`
        )
      );
    }
  }

  private logStatus(elapsed: number, status: string): void {
    console.log(
      chalk.gray(`   请求 #${this.requestCount} (${elapsed}ms): ${status}`)
    );
  }

  private activateBackoff(): void {
    this.backoff.active = true;
  }

  private decayBackoff(): void {
    // 逐步恢复：每次成功请求将退避时间减半
    if (!this.backoff.active) return;
    this.backoff.current = Math.max(
      Math.floor(this.backoff.current / 2),
      this.options.intervalMax
    );
    if (this.backoff.current <= this.options.intervalMax) {
      this.backoff.active = false;
    }
  }

  private async wait(): Promise<void> {
    if (this.backoff.active) {
      await this.sleep(this.backoff.current);
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
