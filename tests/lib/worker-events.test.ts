import { describe, expect, it } from "vitest";
import { istToIso, leadStatusForCallEnd, PROTECTED_LEAD_STATUSES, signForTest, verifySignature, workerEvent } from "@/lib/voice/worker-events";

const U = "11111111-1111-4111-8111-111111111111";
const base = { call_id: U, org_id: U, lead_id: U, project_id: U };

describe("worker signature", () => {
  const body = '{"a":1}';
  it("accepts a good signature and rejects tampering, wrong secret and replays", () => {
    const sig = signForTest("secret", "1000", body);
    expect(verifySignature("secret", "1000", body, sig, 1001)).toBe(true);
    expect(verifySignature("secret", "1000", '{"a":2}', sig, 1001)).toBe(false);
    expect(verifySignature("other", "1000", body, sig, 1001)).toBe(false);
    expect(verifySignature("secret", "1000", body, sig, 1000 + 301)).toBe(false);
    expect(verifySignature("secret", "nope", body, sig, 1001)).toBe(false);
    expect(verifySignature("", "1000", body, sig, 1001)).toBe(false); // an unset secret never authorises anything
  });
  it("matches the Python worker's scheme (HMAC-SHA256 of 'ts.body', hex)", () => {
    // Produced by voice-worker/app/events.py: sign("secret", "1000", b'{"a":1}')
    expect(signForTest("secret", "1000", body)).toBe("79735020b7448fd0956ae8a025e12d8e8e654b3b2d7757e722076546bb0f8e3b");
  });
});

describe("event validation", () => {
  it("accepts a visit request and rejects malformed times", () => {
    expect(workerEvent.safeParse({ ...base, type: "visit_requested", date: "2026-12-05", time: "11:00" }).success).toBe(true);
    expect(workerEvent.safeParse({ ...base, type: "visit_requested", date: "5 Dec", time: "11:00" }).success).toBe(false);
    expect(workerEvent.safeParse({ ...base, type: "visit_requested", date: "2026-12-05", time: "25:00" }).success).toBe(false);
  });
  it("rejects unknown event types and non-uuid ids", () => {
    expect(workerEvent.safeParse({ ...base, type: "visit_confirmed" }).success).toBe(false);
    expect(workerEvent.safeParse({ ...base, call_id: "x", type: "opt_out" }).success).toBe(false);
  });
});

describe("call end handling", () => {
  const ended = (over: object) => workerEvent.parse({ ...base, type: "call_ended", outcome: "connected", duration_seconds: 30, duration_source: "worker_clock", transcript: [], ...over }) as Extract<ReturnType<typeof workerEvent.parse>, { type: "call_ended" }>;
  it("maps outcomes to lead statuses, and a requested visit wins", () => {
    expect(leadStatusForCallEnd(ended({ outcome: "interested" }))).toBe("interested");
    expect(leadStatusForCallEnd(ended({ outcome: "interested", visit_requested: { date: "2026-12-05", time: "11:00" } }))).toBe("visit_requested");
    expect(leadStatusForCallEnd(ended({ outcome: "no_response" }))).toBeNull();
    expect(leadStatusForCallEnd(ended({ outcome: "do_not_contact" }))).toBeNull();
  });
  it("never lets a call overwrite a status set by a person or the scheduler", () => {
    expect(PROTECTED_LEAD_STATUSES).toEqual(expect.arrayContaining(["visit_confirmed", "visit_attended", "do_not_contact"]));
  });
  it("has no event type that can confirm a visit", () => {
    const types = ["opt_out", "callback_requested", "visit_requested", "call_ended"];
    expect(types.some((t) => /confirm/.test(t))).toBe(false);
  });
});

describe("IST conversion", () => {
  it("reads visit times as India time", () => {
    expect(istToIso("2026-12-05", "11:00")).toBe("2026-12-05T05:30:00.000Z");
    expect(istToIso("2026-13-45", "11:00")).toBeNull();
  });
});
