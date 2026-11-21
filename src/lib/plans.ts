/**
 * Launch pricing HYPOTHESES from the product brief, not validated commercial prices. Daily call limits
 * are conservative placeholders for the Super Admin to adjust. Validate margin against measured voice costs before selling.
 */
export const PLAN_PRESETS: Record<string, { label: string; priceInr: number | null; minutes: number; seats: number; dailyCalls: number }> = {
  crm: { label: "CRM", priceInr: 6999, minutes: 0, seats: 5, dailyCalls: 0 },
  growth: { label: "Growth", priceInr: 14999, minutes: 3000, seats: 10, dailyCalls: 150 },
  scale: { label: "Scale", priceInr: 24999, minutes: 11000, seats: 20, dailyCalls: 500 },
  enterprise: { label: "Enterprise", priceInr: null, minutes: 0, seats: 50, dailyCalls: 0 },
};
