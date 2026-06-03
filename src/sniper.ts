import { exec } from "node:child_process";
import chalk from "chalk";
import { ApiClient, type Product } from "./api.js";
import {
  type PlanLevel,
  PLANS,
  DEFAULTS,
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

    exec("open https://open.bigmodel.cn/console/overview");
    exec(
      `osascript -e 'display notification "订单号 ${bizId}，请扫码支付" with title "抢购成功！"'`
    );
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
