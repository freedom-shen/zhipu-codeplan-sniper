import * as p from "@clack/prompts";
import chalk from "chalk";
import { extractToken } from "./cookie.js";
import { ApiClient } from "./api.js";
import { Sniper } from "./sniper.js";
import {
  DEFAULTS,
  SNIPE,
  PLANS,
  type PlanLevel,
  isQuarterlyDiscount,
  parseTargetTime,
} from "./config.js";

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

  // 3. 获取产品列表，展示价格
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
          isQuarterlyDiscount(pr.campaignDiscountDetails)
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
    time: () =>
      p.text({
        message: "开抢时间 (HH:MM，输入 now 立即开始轮询)",
        placeholder: SNIPE.defaultTime,
        defaultValue: SNIPE.defaultTime,
        validate: (v) => {
          const s = (v || SNIPE.defaultTime).trim();
          if (s === "now") return;
          if (!parseTargetTime(s, new Date()))
            return "请输入 HH:MM 格式（如 10:00）或 now";
        },
      }),
    interval: () =>
      p.text({
        message: "轮询间隔 (ms，兜底/轮询模式使用)",
        placeholder: String(DEFAULTS.intervalDefault),
        defaultValue: String(DEFAULTS.intervalDefault),
        validate: (v) => {
          const n = Number(v);
          if (isNaN(n) || n < 100 || n > 1000)
            return "请输入 100-1000 之间的数值";
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
    // 尊重用户输入：以 interval 为下限，避免实际频率比输入更激进而触发限流
    intervalMin: Math.max(100, interval),
    intervalMax: Math.min(1000, interval + 150),
  });

  process.on("SIGINT", () => {
    console.log(chalk.gray("\n\n已停止抢购"));
    sniper.stop();
    process.exit(0);
  });

  const timeInput = String(answers.time || SNIPE.defaultTime).trim();
  if (timeInput === "now") {
    await sniper.run();
    return;
  }

  const now = new Date();
  const target = parseTargetTime(timeInput, now)!;
  if (target.getDate() !== now.getDate()) {
    console.log(chalk.yellow(`   今天 ${timeInput} 已过，顺延至明天`));
  }
  await sniper.snipe(target);
}

main().catch((err) => {
  console.error(chalk.red(`\n✗ ${err.message}`));
  process.exit(1);
});
