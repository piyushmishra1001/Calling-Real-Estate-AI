import type { ImportRow } from "./csv-import";

export type CallableLead = {
  id: string;
  phone: string;
  status: string;
  consent_status: "granted" | "denied" | "unknown";
};

export type Eligibility = { eligible: true } | { eligible: false; reason: string };

const NEVER_CALL = new Set(["do_not_contact", "wrong_number", "not_interested", "visit_attended"]);

/** A number sitting in an uploaded spreadsheet is NOT consent: calling requires granted consent. */
export function leadEligibility(lead: CallableLead, optedOutPhones: Set<string>): Eligibility {
  if (!/^\+[1-9]\d{7,14}$/.test(lead.phone)) return { eligible: false, reason: "invalid_phone" };
  if (optedOutPhones.has(lead.phone)) return { eligible: false, reason: "opted_out" };
  if (NEVER_CALL.has(lead.status)) return { eligible: false, reason: `status_${lead.status}` };
  if (lead.consent_status === "denied") return { eligible: false, reason: "consent_denied" };
  if (lead.consent_status !== "granted") return { eligible: false, reason: "consent_not_recorded" };
  return { eligible: true };
}

/** Indian commercial-calling hours are 09:00-21:00; a campaign window may never exceed that. */
export const LEGAL_WINDOW = { start: "09:00", end: "21:00" } as const;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

export function validateWindow(start: string, end: string): string | null {
  if (!/^\d{2}:\d{2}/.test(start) || !/^\d{2}:\d{2}/.test(end)) return "Calling window must be HH:MM";
  if (toMinutes(start) >= toMinutes(end)) return "Calling window start must be before end";
  if (toMinutes(start) < toMinutes(LEGAL_WINDOW.start) || toMinutes(end) > toMinutes(LEGAL_WINDOW.end)) {
    return `Calling window must fall within ${LEGAL_WINDOW.start}-${LEGAL_WINDOW.end} IST`;
  }
  return null;
}

export function isWithinWindow(now: Date, start: string, end: string, timeZone = "Asia/Kolkata"): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const minutes = h * 60 + m;
  return minutes >= toMinutes(start) && minutes < toMinutes(end);
}

export type CampaignStartInput = {
  /** Result of the can_start_call database function. */
  gate: { allowed: boolean; reason: string };
  hasApprovedKnowledgeBase: boolean;
  window: { start: string; end: string };
  now: Date;
  leads: CallableLead[];
  optedOutPhones: Set<string>;
  concurrency: number;
  maxConcurrency?: number;
};

export type CampaignStartDecision = {
  ok: boolean;
  blockers: string[];
  eligibleLeadIds: string[];
  excluded: Record<string, number>;
};

const GATE_MESSAGES: Record<string, string> = {
  kill_switch: "Calling is paused platform-wide by LeadPilot.",
  organisation_not_active: "Your organisation is not active.",
  no_ai_entitlement: "Your plan has no AI calling minutes.",
  monthly_limit_reached: "Your monthly AI minute limit has been reached.",
  daily_limit_reached: "Today's call limit has been reached.",
};

/** Every precondition from the brief's "Campaign safety" list, in one pure, testable function. */
export function evaluateCampaignStart(input: CampaignStartInput): CampaignStartDecision {
  const blockers: string[] = [];
  const excluded: Record<string, number> = {};

  if (!input.gate.allowed) blockers.push(GATE_MESSAGES[input.gate.reason] ?? `Calling blocked: ${input.gate.reason}`);
  if (!input.hasApprovedKnowledgeBase) blockers.push("This project has no approved knowledge base yet.");
  const windowError = validateWindow(input.window.start, input.window.end);
  if (windowError) blockers.push(windowError);
  else if (!isWithinWindow(input.now, input.window.start, input.window.end)) {
    blockers.push("Outside the campaign's calling window right now; calls will begin when the window opens.");
  }
  if (input.concurrency > (input.maxConcurrency ?? 20)) blockers.push("Concurrency is above the allowed maximum.");

  const eligibleLeadIds: string[] = [];
  for (const lead of input.leads) {
    const e = leadEligibility(lead, input.optedOutPhones);
    if (e.eligible) eligibleLeadIds.push(lead.id);
    else excluded[e.reason] = (excluded[e.reason] ?? 0) + 1;
  }
  if (eligibleLeadIds.length === 0) blockers.push("No leads are eligible to be called.");

  return { ok: blockers.length === 0, blockers, eligibleLeadIds, excluded };
}

export type { ImportRow };
