import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Same scheme as voice-worker/app/events.py: HMAC-SHA256 over `${timestamp}.${rawBody}`, hex, 5 minute window. */
export function verifySignature(secret: string, timestamp: string, rawBody: string, signature: string, nowSeconds = Date.now() / 1000, maxAgeSeconds = 300): boolean {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > maxAgeSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signForTest(secret: string, timestamp: string, rawBody: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

const ids = { call_id: z.string().uuid(), org_id: z.string().uuid(), lead_id: z.string().uuid(), project_id: z.string().uuid() };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const workerEvent = z.discriminatedUnion("type", [
  z.object({ ...ids, type: z.literal("opt_out"), source: z.string().max(40).optional() }),
  z.object({ ...ids, type: z.literal("callback_requested"), reason: z.string().max(300), preferred_time: z.string().max(120).nullable().optional() }),
  z.object({ ...ids, type: z.literal("visit_requested"), date: z.string().regex(DATE), time: z.string().regex(TIME) }),
  z.object({
    ...ids,
    type: z.literal("call_ended"),
    outcome: z.enum(["interested", "callback_requested", "not_interested", "wrong_number", "do_not_contact", "no_response", "connected"]),
    end_reason: z.string().max(60).nullable().optional(),
    duration_seconds: z.number().int().min(0).max(7200),
    duration_source: z.string().max(30),
    qualification: z.record(z.string(), z.unknown()).default({}),
    visit_requested: z.object({ date: z.string(), time: z.string() }).nullable().optional(),
    callback_requested: z.object({ reason: z.string(), preferred_time: z.string().nullable().optional() }).nullable().optional(),
    transcript: z.array(z.object({ speaker: z.enum(["riya", "customer"]), text: z.string().max(2000) })).max(400),
  }),
]);

export type WorkerEvent = z.infer<typeof workerEvent>;

/** Lead statuses a call outcome may NOT overwrite: they were set by a person, the opt-out record, or the scheduler. */
export const PROTECTED_LEAD_STATUSES = ["visit_confirmed", "visit_attended", "do_not_contact"];

export function leadStatusForCallEnd(outcome: WorkerEvent & { type: "call_ended" }): string | null {
  if (outcome.visit_requested) return "visit_requested";
  switch (outcome.outcome) {
    case "wrong_number": return "wrong_number";
    case "not_interested": return "not_interested";
    case "callback_requested": return "callback_requested";
    case "interested": return "interested";
    case "connected": return "connected";
    default: return null; // no_response and do_not_contact never change the status here
  }
}

/** Visit time is spoken in India: interpret the date and time as IST. */
export function istToIso(date: string, time: string): string | null {
  const d = new Date(`${date}T${time}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
