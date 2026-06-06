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
  intervalMin: 150,
  intervalMax: 350,
  intervalDefault: 200,
  requestTimeout: 5000,
  backoffMax: 8000,
  backoffInitial: 2000,
} as const;

export const SNIPE = {
  /** 冲刺期下单间隔 */
  burstIntervalMs: 200,
  /** 提前起跑量（覆盖时钟误差 + 抢首发） */
  leadTimeMs: 2000,
  /** 冲刺持续时长，超时回落轮询模式 */
  burstDurationMs: 30_000,
  /** 等待期保活刷新间隔 */
  keepAliveMs: 60_000,
  /** 冲刺期遇限流的固定退避 */
  limitBackoffMs: 1000,
  /** 开抢前多久做最后一次校时+缓存刷新 */
  finalSyncAheadMs: 5000,
  /** 默认开抢时间 */
  defaultTime: "10:00",
} as const;

/**
 * 解析 "HH:MM" 为下一次该时刻的 Date。
 * 今天已过（或正好等于当前时刻）则顺延到明天；非法输入返回 null。
 */
export function parseTargetTime(input: string, now: Date): Date | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(input.trim());
  if (!m) return null;
  const target = new Date(now);
  target.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

export const API_BASE = "https://bigmodel.cn";

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

export function isQuarterlyDiscount(
  campaignDetails: Array<{ campaignName: string }>
): boolean {
  return campaignDetails.some((d) => d.campaignName.includes("包季"));
}
