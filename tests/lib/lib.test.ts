import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";
import { parseBudget, parseLeadCsv } from "@/lib/csv-import";
import { evaluateCampaignStart, isWithinWindow, leadEligibility, validateWindow } from "@/lib/campaign-safety";
import {
  PUBLISHED_SARVAM_PRICING, costOfCall, costPerAttendedVisit, speechCostPerMinute, summarizeCosts, targetInrPerMinute, type CallUsage,
} from "@/lib/voice/cost";
import { buildRiyaContext, KnowledgeBaseNotApprovedError } from "@/lib/voice/context";
import { classifyUtterance, leadStatusForOutcome, parseVisitDate, parseVisitTime, RiyaEngine } from "@/lib/voice/riya";
import { runCall } from "@/lib/voice/orchestrator";
import { MockCalendar, MockStt, MockTts, say } from "@/lib/voice/mocks";

describe("normalizePhone", () => {
  it.each([
    ["98765 43210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["+91-98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091 98765 43210", "+919876543210"],
    ["+14155552671", "+14155552671"],
  ])("%s -> %s", (raw, want) => expect(normalizePhone(raw)).toBe(want));

  it.each(["", "12345", "5876543210", "9.8765E+9", "abc", "+9198765", null, undefined])("rejects %s", (raw) =>
    expect(normalizePhone(raw as string)).toBeNull());
});

describe("parseBudget", () => {
  it.each([["1.2 Cr", 12_000_000], ["85 lakh", 8_500_000], ["₹90,00,000", 9_000_000], ["50L", 5_000_000], ["abc", null]])(
    "%s", (raw, want) => expect(parseBudget(raw)).toBe(want));
});

describe("parseLeadCsv", () => {
  const csv = [
    "Name,Mobile,Email,Source,Type,Config,Consent",
    "Asha Rao,98765 43210,asha@x.com,99acres,Residential,3 BHK,yes",
    "Bad Phone,12345,,web,,,",
    ",9876543211,,,,,",
    "Dup,+919876543210,,,,,",
    "Opted,9876543212,,web,,,yes",
    "Exists,9876543213,,web,,,yes",
    "Bad Mail,9876543214,not-an-email,,,,",
    "No Consent,9876543215,,web,,,",
  ].join("\n");

  const r = parseLeadCsv(csv, {
    optedOutPhones: new Set(["+919876543212"]),
    existingPhones: new Set(["+919876543213"]),
  });

  it("accepts good rows and reports every rejection with its row number", () => {
    expect(r.fatal).toBeNull();
    expect(r.valid.map((v) => v.name)).toEqual(["Asha Rao", "Opted", "No Consent"]);
    expect(r.rejected.map((x) => [x.row, x.reason.split(" ")[0]])).toEqual([
      [3, "Invalid"], [4, "Missing"], [5, "Duplicate"], [7, "Lead"], [8, "Invalid"],
    ]);
  });
  it("marks previously opted-out numbers do_not_contact with denied consent", () => {
    const o = r.valid.find((v) => v.name === "Opted")!;
    expect(o.status).toBe("do_not_contact");
    expect(o.consent_status).toBe("denied");
  });
  it("never assumes consent from a spreadsheet", () => {
    expect(r.valid.find((v) => v.name === "No Consent")!.consent_status).toBe("unknown");
    expect(r.summary.consentUnknown).toBe(1);
  });
  it("normalises phones, types and configuration", () => {
    const a = r.valid[0];
    expect([a.phone, a.enquiry_type, a.preferred_config, a.consent_status]).toEqual(["+919876543210", "residential", "3 BHK", "granted"]);
  });
  it("fails clearly with no phone column or no rows", () => {
    expect(parseLeadCsv("Name,City\nA,B").fatal).toMatch(/phone/);
    expect(parseLeadCsv("Name,Phone\n").fatal).toMatch(/no data/);
  });
});

describe("campaign safety", () => {
  const lead = (o = {}) => ({ id: "l", phone: "+919876543210", status: "new", consent_status: "granted" as const, ...o });
  it("calls only leads with granted consent", () => {
    expect(leadEligibility(lead(), new Set())).toEqual({ eligible: true });
    expect(leadEligibility(lead({ consent_status: "unknown" }), new Set())).toMatchObject({ reason: "consent_not_recorded" });
    expect(leadEligibility(lead({ consent_status: "denied" }), new Set())).toMatchObject({ reason: "consent_denied" });
    expect(leadEligibility(lead(), new Set(["+919876543210"]))).toMatchObject({ reason: "opted_out" });
    expect(leadEligibility(lead({ status: "do_not_contact" }), new Set())).toMatchObject({ eligible: false });
    expect(leadEligibility(lead({ phone: "98" }), new Set())).toMatchObject({ reason: "invalid_phone" });
  });
  it("enforces the 09:00-21:00 calling window", () => {
    expect(validateWindow("10:00", "19:00")).toBeNull();
    expect(validateWindow("08:00", "19:00")).toMatch(/within/);
    expect(validateWindow("10:00", "22:00")).toMatch(/within/);
    expect(validateWindow("19:00", "10:00")).toMatch(/before/);
    // 10:00 UTC = 15:30 IST
    expect(isWithinWindow(new Date("2026-12-01T10:00:00Z"), "10:00", "19:00")).toBe(true);
    // 17:00 UTC = 22:30 IST
    expect(isWithinWindow(new Date("2026-12-01T17:00:00Z"), "10:00", "19:00")).toBe(false);
  });
  const base = () => ({
    gate: { allowed: true, reason: "ok" }, hasApprovedKnowledgeBase: true, window: { start: "10:00", end: "19:00" },
    now: new Date("2026-12-01T10:00:00Z"), leads: [lead({ id: "a" }), lead({ id: "b", consent_status: "unknown" as const })],
    optedOutPhones: new Set<string>(), concurrency: 2,
  });
  it("allows a clean campaign and reports exclusions", () => {
    const d = evaluateCampaignStart(base());
    expect(d.ok).toBe(true);
    expect(d.eligibleLeadIds).toEqual(["a"]);
    expect(d.excluded).toEqual({ consent_not_recorded: 1 });
  });
  it.each([
    ["kill switch", { gate: { allowed: false, reason: "kill_switch" } }, /paused platform-wide/],
    ["limit reached", { gate: { allowed: false, reason: "monthly_limit_reached" } }, /monthly/],
    ["no approved KB", { hasApprovedKnowledgeBase: false }, /knowledge base/],
    ["outside window", { now: new Date("2026-12-01T17:00:00Z") }, /calling window/],
    ["no eligible leads", { leads: [] }, /No leads are eligible/],
  ])("blocks: %s", (_n, patch, msg) => {
    const d = evaluateCampaignStart({ ...base(), ...patch });
    expect(d.ok).toBe(false);
    expect(d.blockers.join(" ")).toMatch(msg as RegExp);
  });
});

describe("voice cost accounting", () => {
  it("matches the brief's worked examples (Rs 0.89 and Rs 1.29 at 400 and 800 chars/min)", () => {
    expect(speechCostPerMinute(400)).toBe(0.89);
    expect(speechCostPerMinute(800)).toBe(1.29);
    expect(targetInrPerMinute(PUBLISHED_SARVAM_PRICING)).toBeCloseTo(1.7);
  });
  it("prices STT, TTS and LLM tokens separately", () => {
    const c = costOfCall({ connected: true, sttBilledSeconds: 60, ttsCharacters: 400, llmInputTokens: 1_000_000, llmOutputTokens: 0, connectedSeconds: 60, telephonyInr: 0.5 });
    expect([c.stt, c.tts, c.llm]).toEqual([0.49, 0.4, 29.28]);
    expect(c.total).toBeCloseTo(c.ai + 0.5, 3);
  });
  const call = (o: Partial<CallUsage> = {}): CallUsage => ({ connected: true, sttBilledSeconds: 60, ttsCharacters: 400, llmInputTokens: 0, llmOutputTokens: 0, connectedSeconds: 60, ...o });
  it("refuses to claim the target on a small sample", () => {
    const s = summarizeCosts(Array.from({ length: 10 }, () => call()));
    expect(s.targetStatus).toBe("insufficient_sample");
  });
  it("includes failed calls and retries in cost but not in connected minutes", () => {
    const calls = [call(), call({ connected: false, connectedSeconds: 0, sttBilledSeconds: 0, ttsCharacters: 100, isRetry: true })];
    const s = summarizeCosts(calls, undefined, 2);
    expect(s.failedCalls).toBe(1);
    expect(s.retries).toBe(1);
    expect(s.connectedMinutes).toBe(1);
    expect(s.aiInr).toBeCloseTo(0.89 + 0.1, 3);
  });
  it("reports met / not met only once the sample is large enough", () => {
    expect(summarizeCosts(Array.from({ length: 100 }, () => call())).targetStatus).toBe("met");
    expect(summarizeCosts(Array.from({ length: 100 }, () => call({ ttsCharacters: 2000 }))).targetStatus).toBe("not_met");
  });
  it("cost per attended visit is null until there is a visit", () => {
    expect(costPerAttendedVisit(5000, 0)).toBeNull();
    expect(costPerAttendedVisit(5000, 4)).toBe(1250);
  });
});

const kb = { status: "approved", facts: { pricing: "Starts at Rs 85 lakh", possession: "December 2028", location: "Kharghar" }, faqs: [{ q: "Is there a swimming pool?", a: "Yes, there is a swimming pool." }] };
const mkCtx = (over: { schedulingAvailable?: boolean } = {}) => buildRiyaContext({
  companyName: "Acme Realty", lead: { name: "Asha", enquiry_type: null }, project: { name: "Skyline Heights", location: "Kharghar" }, kb, ...over,
});
const IDS = { leadId: "lead_1", projectId: "proj_1" };
const TODAY = "2026-12-01"; // a Tuesday

describe("knowledge base gate", () => {
  it("refuses unapproved or missing knowledge bases", () => {
    const args = { companyName: "A", lead: { name: "x" }, project: { name: "P" } };
    expect(() => buildRiyaContext({ ...args, kb: null })).toThrow(KnowledgeBaseNotApprovedError);
    expect(() => buildRiyaContext({ ...args, kb: { ...kb, status: "pending_review" } })).toThrow(KnowledgeBaseNotApprovedError);
  });
  it("passes only the minimum lead fields to the model", () => {
    const ctx = buildRiyaContext({ companyName: "A", lead: { name: "x", phone: "+919800000000", budget: 1, notes: "secret" }, project: { name: "P" }, kb });
    expect(JSON.stringify(ctx)).not.toMatch(/9800000000|secret/);
  });
});

describe("utterance understanding", () => {
  it.each([
    ["please don't call me again", "opt_out"], ["mujhe call mat karo", "opt_out"], ["take me off your list", "opt_out"],
    ["wrong number", "wrong_number"], ["I'm not interested", "not_interested"], ["I'm driving, call later", "busy"],
    ["are you a robot?", "ask_identity"], ["it's too expensive", "price_objection"], ["what is the price", "question"],
    ["yes sure", "yes"], ["nahi", "no"],
  ])("%s -> %s", (t, i) => expect(classifyUtterance(t)).toBe(i));
  it("parses dates and times", () => {
    expect(parseVisitDate("tomorrow", TODAY)).toBe("2026-12-02");
    expect(parseVisitDate("this saturday", TODAY)).toBe("2026-12-05");
    expect(parseVisitDate("5th dec", TODAY)).toBe("2026-12-05");
    expect(parseVisitTime("around 11 am")).toBe("11:00");
    expect(parseVisitTime("4:30 pm")).toBe("16:30");
    expect(parseVisitTime("in the evening")).toBe("17:00");
  });
});

describe("Riya conversations", () => {
  const talk = async (turns: (string | null)[], opts: { calendar?: MockCalendar; scheduling?: boolean } = {}) => {
    const tts = new MockTts();
    const stt = new MockStt();
    const run = await runCall({
      ctx: mkCtx({ schedulingAvailable: opts.scheduling ?? false }), ids: IDS, today: TODAY, stt, tts, calendar: opts.calendar,
      customerTurns: turns.map((t) => (t === null ? null : say(t))),
    });
    return { run, stt, tts };
  };

  it("discloses she is an AI and names the company in the opening line", async () => {
    const { run } = await talk([]);
    expect(run.transcript[0].text).toMatch(/Riya, an AI calling assistant from Acme Realty/);
    expect(run.transcript[0].text).toMatch(/Skyline Heights/);
  });

  it("admits she is not human when asked", async () => {
    const { run } = await talk(["yes", "are you a real person?"]);
    expect(run.transcript.map((l) => l.text).join(" ")).toMatch(/I'm not a human/);
  });

  it("an opt-out ends the call at once, records the opt-out, and stops all further STT/TTS", async () => {
    const { run, stt, tts } = await talk(["yes", "please do not call me again", "this should never be processed", "nor this"]);
    expect(run.actions.some((a) => a.type === "record_opt_out")).toBe(true);
    expect(run.outcome.do_not_contact).toBe(true);
    expect(leadStatusForOutcome(run.outcome)).toBe("do_not_contact");
    expect(stt.calls).toBe(2); // the two later turns were never transcribed
    expect(tts.spoken.join(" ")).not.toMatch(/never be processed/);
  });

  it("never invents a fact: unverified questions become a human callback", async () => {
    const { run } = await talk(["yes", "how many floors does the tower have?"]);
    expect(run.transcript.map((l) => l.text).join(" ")).toMatch(/colleague call you back/);
    expect(run.actions.some((a) => a.type === "create_callback_task" && a.reason === "unverified_question")).toBe(true);
    expect(run.outcome.human_followup_required).toBe(true);
  });

  it("answers from approved facts and FAQs", async () => {
    const { run } = await talk(["yes", "what is the price?", "is there a swimming pool?", "when is possession?"]);
    const said = run.transcript.filter((l) => l.speaker === "riya").map((l) => l.text).join(" ");
    expect(said).toMatch(/Rs 85 lakh/);
    expect(said).toMatch(/swimming pool/);
    expect(said).toMatch(/December 2028/);
  });

  it("with no calendar, captures a preferred slot and NEVER says the visit is confirmed", async () => {
    const { run } = await talk(["yes", "residential", "3 bhk", "within 3 months", "yes please", "tomorrow at 11 am"]);
    const last = run.transcript[run.transcript.length - 1].text;
    expect(last).toMatch(/coordinator will call you to confirm/);
    expect(last).not.toMatch(/is confirmed|booked/i);
    expect(run.outcome).toMatchObject({
      property_type: "residential", configuration: "3 BHK", purchase_timeline: "within_3_months", site_visit_requested: true,
      preferred_visit_date: "2026-12-02", preferred_visit_time: "11:00", visit_confirmed: false, human_followup_required: true,
    });
    expect(run.actions.some((a) => a.type === "create_callback_task" && a.reason === "confirm_site_visit")).toBe(true);
    expect(leadStatusForOutcome(run.outcome)).toBe("visit_requested");
  });

  it("confirms only after the scheduling system reserves the slot", async () => {
    const cal = new MockCalendar(true);
    const { run } = await talk(["yes", "residential", "2 bhk", "next month", "yes", "5th dec at 4 pm"], { calendar: cal, scheduling: true });
    expect(cal.reservations).toHaveLength(1);
    expect(run.transcript[run.transcript.length - 1].text).toMatch(/confirmed for 2026-12-05 at 16:00/);
    expect(run.outcome.visit_confirmed).toBe(true);
    expect(leadStatusForOutcome(run.outcome)).toBe("visit_confirmed");
  });

  it("does NOT claim a booking when the scheduling system rejects the slot", async () => {
    const cal = new MockCalendar(false);
    const { run } = await talk(["yes", "residential", "2 bhk", "next month", "yes", "5th dec at 4 pm"], { calendar: cal, scheduling: true });
    const said = run.transcript.filter((l) => l.speaker === "riya").map((l) => l.text).join(" ");
    expect(said).toMatch(/coordinator will call you/);
    expect(said).not.toMatch(/is confirmed/);
    expect(run.outcome.visit_confirmed).toBe(false);
    expect(leadStatusForOutcome(run.outcome)).toBe("visit_requested");
  });

  it("never asks the same qualifying question more than twice", async () => {
    const { run } = await talk(["yes", "residential", "2 bhk", "mumble", "mumble", "mumble", "mumble"]);
    const asked = run.transcript.filter((l) => l.text === "When are you planning to buy?").length;
    expect(asked).toBeLessThanOrEqual(2);
  });

  it("captures a callback time when the customer is busy", async () => {
    const { run } = await talk(["I'm in a meeting", "after 6 pm today"]);
    expect(run.outcome.callback_requested).toBe(true);
    expect(run.actions.some((a) => a.type === "create_callback_task" && a.reason === "customer_requested_callback")).toBe(true);
    expect(leadStatusForOutcome(run.outcome)).toBe("callback_requested");
  });

  it("handles price objections by offering a human consultant", async () => {
    const { run } = await talk(["yes", "it's too expensive"]);
    expect(run.actions.some((a) => a.type === "create_callback_task" && a.reason === "price_objection")).toBe(true);
  });

  it("ends politely on not-interested and on wrong number", async () => {
    expect(leadStatusForOutcome((await talk(["no thanks, not interested"])).run.outcome)).toBe("not_interested");
    expect(leadStatusForOutcome((await talk(["wrong number"])).run.outcome)).toBe("wrong_number");
  });

  it("hangs up after repeated silence and reports no response", async () => {
    const { run } = await talk([null, null, null]);
    expect(run.outcome.call_outcome).toBe("no_response");
    expect(run.usage.connected).toBe(false);
  });

  it("uses nulls, not invented values, for information the customer never gave", async () => {
    const { run } = await talk(["yes"]);
    expect(run.outcome).toMatchObject({ budget: null, configuration: null, purchase_timeline: null, preferred_visit_date: null });
  });

  it("caps conversation length and escalates to a human", () => {
    const e = new RiyaEngine(mkCtx(), IDS, TODAY);
    e.start();
    let last = e.handle("hmm");
    for (let i = 0; i < 20 && !e.isEnded; i++) last = e.handle("hmm");
    expect(e.isEnded).toBe(true);
    expect(last.actions.some((a) => a.type === "create_callback_task" && a.reason === "conversation_too_long")).toBe(true);
  });

  it("records usage so cost can be measured per call", async () => {
    const { run } = await talk(["yes", "what is the price?"]);
    expect(run.usage.sttBilledSeconds).toBe(8);
    expect(run.usage.ttsCharacters).toBeGreaterThan(100);
  });
});
