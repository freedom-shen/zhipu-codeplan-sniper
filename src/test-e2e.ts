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
    const soldOutLabel = target.soldOut
      ? chalk.yellow("售罄")
      : chalk.green("有库存");
    console.log(
      chalk.green(
        `✓ 通过 (共 ${products.length} 个产品, Pro 季付 ${soldOutLabel}, ID: ${targetProductId})`
      )
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

  console.log(
    chalk.bold.green("\n✅ 全链路测试通过！所有模块正常工作。\n")
  );
}

test().catch((err) => {
  console.error(chalk.red(`\n✗ 测试异常: ${err.message}`));
  process.exit(1);
});
