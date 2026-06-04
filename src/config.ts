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
