import type { RiyaContext } from "./context";

/**
 * Riya's conversation engine: a small deterministic state machine.
 * Safety-critical behaviour (opt-outs, wrong numbers, AI disclosure, never inventing project
 * facts, never claiming a booking) is rule-based and runs BEFORE any language model, so it
 * cannot be talked out of it and costs nothing per turn.
 */

export type Intent =
  | "opt_out"
  | "wrong_number"
  | "not_interested"
  | "busy"
  | "ask_identity"
  | "price_objection"
  | "question"
  | "yes"
  | "no"
  | "unclear";

const has = (s: string, patterns: RegExp[]) => patterns.some((p) => p.test(s));

export function classifyUtterance(raw: string): Intent {
  const s = raw.toLowerCase().trim();
  if (!s) return "unclear";

  if (
    has(s, [
      /(do not|don'?t|dont|never|stop|no more)\s+(call|calling|phone|contact|disturb)/,
      /remove (my|this) (number|name)/,
      /(call|phone|contact)\s+(mat|na)\s*(karo|kijiye|kare)?/,
      /(mat|na)\s+(call|phone)\s*(karo|kijiye)?/,
      /band\s+karo/,
      /(dobara|phir se|again)\s+(call|phone)?\s*(nahi|nahin|mat|not)/,
      /\bdnd\b/,
      /take me off/,
    ])
  ) return "opt_out";

  if (has(s, [/wrong number/, /galat number/, /\bnot (me|my number)\b/, /no one by that name/])) return "wrong_number";

  if (
    has(s, [
      /not interested/,
      /no interest/,
      /interested nahi/,
      /nahi chahiye/,
      /don'?t need/,
      /not looking/,
      /already (bought|purchased|booked)/,
    ])
  ) return "not_interested";

  if (has(s, [/\bbusy\b/, /\bdriving\b/, /in a meeting/, /call (me )?(back )?later/, /baad mein/, /abhi nahi/, /not a good time/, /bad time/])) return "busy";

  if (has(s, [/are you (a )?(human|robot|bot|real|ai|machine|person)/, /who (is this|are you)/, /kaun (bol|ho)/, /real person/])) return "ask_identity";

  if (has(s, [/too (high|expensive)/, /\bexpensive\b/, /budget (is )?(low|less|tight)/, /costly/, /bahut (zyada|mehenga)/, /\bmehenga\b/, /out of (my )?budget/])) return "price_objection";

  if (s.includes("?") || has(s, [/^(what|when|where|which|how|who|is|are|do|does|can|could|will|tell me|kya|kab|kahan|kitna|kitne|batao)\b/, /\b(price|cost|rate|possession|amenit|payment|emi|location|connectivity)\b/])) return "question";

  if (has(s, [/\b(yes|yeah|yep|yup|sure|ok|okay|haan|han|ji|theek hai|go ahead|please|of course|definitely)\b/])) return "yes";
  if (has(s, [/^(no|nope|nahi|nahin|nah)\b/])) return "no";
  return "unclear";
}

type FactKey = keyof RiyaContext["facts"];
const TOPICS: { key: FactKey; patterns: RegExp[]; lead: string }[] = [
  { key: "pricing", patterns: [/price|pricing|cost|rate|kitna|how much|budget/], lead: "On pricing" },
  { key: "possession", patterns: [/possession|ready|handover|completion|delivery/], lead: "On possession" },
  { key: "paymentPlans", patterns: [/payment|emi|loan|instalment|installment|plan/], lead: "On payment plans" },
  { key: "configurations", patterns: [/bhk|configuration|size|carpet|area|sq\.? ?ft|unit/], lead: "On configurations" },
  { key: "amenities", patterns: [/amenit|gym|pool|club|park|facility|facilities/], lead: "On amenities" },
  { key: "connectivity", patterns: [/connect|metro|station|highway|airport|distance|nearby|transport/], lead: "On connectivity" },
  { key: "location", patterns: [/location|where|address|situated|kahan|locality/], lead: "On location" },
  { key: "siteVisitAddress", patterns: [/visit address|site address|where is the site/], lead: "The site address is" },
];

/** Answers only from approved facts or approved FAQs; returns null when it cannot verify. */
export function answerFromApprovedFacts(question: string, ctx: RiyaContext): string | null {
  const q = question.toLowerCase();
  for (const faq of ctx.faqs) {
    const words = faq.q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const hits = words.filter((w) => q.includes(w)).length;
    if (words.length > 0 && hits >= Math.max(2, Math.ceil(words.length * 0.6))) return faq.a;
  }
  for (const t of TOPICS) {
    if (t.patterns.some((p) => p.test(q))) {
      const fact = ctx.facts[t.key];
      return fact ? `${t.lead}: ${fact}` : null;
    }
  }
  return null;
}

export function parseTimeline(s: string): string | null {
  const t = s.toLowerCase();
  if (/(immediate|asap|right away|jaldi|this week|next week|\bnow\b)/.test(t)) return "immediate";
  if (/(this|next|agle|is)\s+(month|mahine|mahina)/.test(t) || /(couple|few) (of )?months/.test(t)) return "within_3_months";
  const m = t.match(/(\d+)\s*(month|mahine|mahina)/);
  if (m) {
    const n = Number(m[1]);
    return n <= 3 ? "within_3_months" : n <= 6 ? "within_6_months" : "later";
  }
  if (/(year|saal|varsh)/.test(t)) return "later";
  if (/(explor|just looking|browsing|dekh raha|dekh rahe|not sure)/.test(t)) return "exploring";
  return null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Returns YYYY-MM-DD for the date the customer named, relative to `today` (IST date, YYYY-MM-DD). */
export function parseVisitDate(s: string, today: string): string | null {
  const t = s.toLowerCase();
  const base = new Date(today + "T00:00:00Z");
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const add = (n: number) => fmt(new Date(base.getTime() + n * 86_400_000));
  if (/day after tomorrow|parso/.test(t)) return add(2);
  if (/tomorrow|kal\b/.test(t)) return add(1);
  if (/\btoday\b|\baaj\b/.test(t)) return add(0);
  for (let i = 0; i < 7; i++) {
    if (t.includes(WEEKDAYS[i])) {
      const diff = (i - base.getUTCDay() + 7) % 7 || 7;
      return add(diff);
    }
  }
  const m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  if (m) {
    const day = Number(m[1]);
    const month = MONTHS.indexOf(m[2]);
    let year = base.getUTCFullYear();
    let d = new Date(Date.UTC(year, month, day));
    if (d.getTime() < base.getTime()) d = new Date(Date.UTC(++year, month, day));
    if (d.getUTCMonth() !== month) return null;
    return fmt(d);
  }
  return null;
}

export function parseVisitTime(s: string): string | null {
  const t = s.toLowerCase();
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ?? "00";
    if (h < 1 || h > 12) return null;
    if (m[3] === "pm" && h < 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${min}`;
  }
  const m24 = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m24) return `${m24[1].padStart(2, "0")}:${m24[2]}`;
  if (/morning/.test(t)) return "10:00";
  if (/afternoon/.test(t)) return "14:00";
  if (/evening/.test(t)) return "17:00";
  return null;
}

export type Action =
  | { type: "reserve_visit"; date: string; time: string }
  | { type: "create_callback_task"; reason: string; preferredTime: string | null }
  | { type: "record_opt_out" }
  | { type: "end_call"; reason: string };

export type TurnResult = { say: string; actions: Action[]; ended: boolean };

export type CallOutcome = {
  lead_id: string;
  project_id: string;
  call_outcome: "interested" | "callback_requested" | "not_interested" | "wrong_number" | "do_not_contact" | "no_response" | "connected";
  property_type: "residential" | "commercial" | null;
  configuration: string | null;
  purchase_timeline: string | null;
  budget: number | null;
  callback_requested: boolean;
  site_visit_requested: boolean;
  preferred_visit_date: string | null;
  preferred_visit_time: string | null;
  /** True only when the scheduling system actually reserved the slot. */
  visit_confirmed: boolean;
  do_not_contact: boolean;
  human_followup_required: boolean;
};

type State = "opening" | "qualifying" | "offering_visit" | "capturing_slot" | "capturing_callback" | "ended";

const MAX_TURNS = 14;

export class RiyaEngine {
  private state: State = "opening";
  private turns = 0;
  private silences = 0;
  private ended = false;
  private endReason = "";

  private propertyType: CallOutcome["property_type"];
  private configuration: string | null;
  private timeline: string | null = null;
  private budget: number | null = null;
  private callbackRequested = false;
  private callbackTime: string | null = null;
  private visitRequested = false;
  private visitDate: string | null = null;
  private visitTime: string | null = null;
  private visitConfirmed = false;
  private optedOut = false;
  private notInterested = false;
  private wrongNumber = false;
  private humanFollowup = false;
  private spoke = false; // the customer has said something

  constructor(
    private readonly ctx: RiyaContext,
    private readonly ids: { leadId: string; projectId: string },
    private readonly today: string, // IST date, YYYY-MM-DD
  ) {
    this.propertyType = ctx.enquiryType;
    this.configuration = ctx.configuration;
  }

  /** Riya always discloses that she is an AI assistant and names who she represents. */
  start(): TurnResult {
    return {
      say: `Hello, I'm Riya, an AI calling assistant from ${this.ctx.companyName}. I'm calling regarding your enquiry about ${this.ctx.projectName}. Is this a good time to speak?`,
      actions: [],
      ended: false,
    };
  }

  get isEnded() {
    return this.ended;
  }

  handleSilence(): TurnResult {
    this.silences++;
    if (this.silences >= 2) return this.end("Sorry, I can't hear you. I'll try again another time. Goodbye.", "no_response");
    return { say: "Hello, are you still there?", actions: [], ended: false };
  }

  handle(utterance: string): TurnResult {
    if (this.ended) return { say: "", actions: [], ended: true };
    this.spoke = true;
    this.silences = 0;
    this.turns++;
    const intent = classifyUtterance(utterance);

    // Rule-based, always first.
    if (intent === "opt_out") {
      this.optedOut = true;
      const r = this.end("Understood. I won't call you again, and I'm sorry for the disturbance. Goodbye.", "opt_out");
      r.actions.unshift({ type: "record_opt_out" });
      return r;
    }
    if (intent === "wrong_number") {
      this.wrongNumber = true;
      return this.end("Sorry about that, I'll update our records. Have a good day.", "wrong_number");
    }
    if (intent === "not_interested") {
      this.notInterested = true;
      return this.end("No problem at all, thank you for your time. Have a good day.", "not_interested");
    }
    if (intent === "ask_identity") {
      return this.say(`I'm Riya, an AI calling assistant from ${this.ctx.companyName}. I'm not a human. ${this.reprompt()}`);
    }
    if (this.turns >= MAX_TURNS) {
      this.humanFollowup = true;
      return this.end("I'll have a colleague follow up with you so we don't take more of your time. Thank you!", "max_turns", [
        { type: "create_callback_task", reason: "conversation_too_long", preferredTime: this.callbackTime },
      ]);
    }

    if (this.state === "capturing_callback") return this.captureCallback(utterance);

    if (intent === "busy") {
      this.state = "capturing_callback";
      return this.say("No problem. When would be a good time for me to call you back?");
    }

    if (intent === "price_objection") {
      this.humanFollowup = true;
      return this.say(`I understand, price matters. I can arrange a discussion with a property consultant who can walk you through the options. ${this.reprompt(true)}`, [
        { type: "create_callback_task", reason: "price_objection", preferredTime: this.callbackTime },
      ]);
    }

    if (intent === "question") {
      const answer = answerFromApprovedFacts(utterance, this.ctx);
      if (answer) return this.say(`${answer} ${this.reprompt()}`);
      // Cannot verify: never guess.
      this.humanFollowup = true;
      this.callbackRequested = true;
      return this.say(`I don't want to give you wrong information on that, so I'll have a colleague call you back with the exact details. ${this.reprompt()}`, [
        { type: "create_callback_task", reason: "unverified_question", preferredTime: this.callbackTime },
      ]);
    }

    switch (this.state) {
      case "opening":
        this.state = "qualifying";
        return this.nextQualification();
      case "qualifying":
        this.absorbQualification(utterance);
        return this.nextQualification();
      case "offering_visit":
        if (intent === "yes") {
          this.state = "capturing_slot";
          return this.say(this.slotPrompt());
        }
        if (intent === "no") return this.end("Alright, thank you for your time. We'll stay in touch.", "declined_visit");
        return this.say("Would you like to visit the site? I can note a convenient day and time for you.");
      case "capturing_slot":
        return this.captureSlot(utterance);
      default:
        return this.end("Thank you, goodbye.", "done");
    }
  }

  /** The orchestrator calls this with the scheduling system's real answer. */
  onReservationResult(result: { ok: true } | { ok: false; reason: string }): TurnResult {
    if (result.ok) {
      this.visitConfirmed = true;
      return this.end(`Your site visit is confirmed for ${this.visitDate} at ${this.visitTime}. Thank you!`, "visit_confirmed");
    }
    this.humanFollowup = true;
    return this.end(
      "I couldn't lock that slot just now, so a coordinator will call you to confirm a time. Thank you!",
      "visit_pending_human",
      [{ type: "create_callback_task", reason: "visit_slot_unavailable", preferredTime: `${this.visitDate} ${this.visitTime}` }],
    );
  }

  outcome(): CallOutcome {
    let call_outcome: CallOutcome["call_outcome"] = "connected";
    if (this.optedOut) call_outcome = "do_not_contact";
    else if (this.wrongNumber) call_outcome = "wrong_number";
    else if (this.notInterested) call_outcome = "not_interested";
    else if (!this.spoke) call_outcome = "no_response";
    else if (this.visitRequested || this.propertyType || this.configuration || this.timeline) call_outcome = "interested";
    else if (this.callbackRequested) call_outcome = "callback_requested";
    if (this.callbackRequested && call_outcome === "connected") call_outcome = "callback_requested";

    return {
      lead_id: this.ids.leadId,
      project_id: this.ids.projectId,
      call_outcome,
      property_type: this.propertyType,
      configuration: this.configuration,
      purchase_timeline: this.timeline,
      budget: this.budget,
      callback_requested: this.callbackRequested,
      site_visit_requested: this.visitRequested,
      preferred_visit_date: this.visitDate,
      preferred_visit_time: this.visitTime,
      visit_confirmed: this.visitConfirmed,
      do_not_contact: this.optedOut,
      human_followup_required: this.humanFollowup || this.visitRequested || this.callbackRequested,
    };
  }

  // ---------------------------------------------------------------- internals
  private say(say: string, actions: Action[] = []): TurnResult {
    return { say, actions, ended: false };
  }

  private end(say: string, reason: string, actions: Action[] = []): TurnResult {
    this.ended = true;
    this.state = "ended";
    this.endReason = reason;
    return { say, actions: [...actions, { type: "end_call", reason }], ended: true };
  }

  private reprompt(softly = false): string {
    switch (this.state) {
      case "qualifying":
        return softly ? "" : this.pendingQuestion() ?? "";
      case "offering_visit":
        return "Would you like to visit the site?";
      case "capturing_slot":
        return "What day and time suits you for a visit?";
      default:
        return "Is this a good time to talk?";
    }
  }

  /** Each qualifying question is asked at most twice; after that Riya moves on rather than looping. */
  private asks: Record<string, number> = {};

  private pendingQuestion(): string | null {
    const candidates: [string, boolean, string][] = [
      ["type", !this.propertyType, "Are you looking for a residential or a commercial property?"],
      ["config", this.propertyType === "residential" && !this.configuration, "Which configuration are you looking for, like 2 BHK or 3 BHK?"],
      ["timeline", !this.timeline, "When are you planning to buy?"],
    ];
    for (const [key, missing, text] of candidates) {
      if (missing && (this.asks[key] ?? 0) < 2) return text;
    }
    return null;
  }

  private markAsked(question: string) {
    const key = question.startsWith("Are you looking") ? "type" : question.startsWith("Which config") ? "config" : "timeline";
    this.asks[key] = (this.asks[key] ?? 0) + 1;
  }

  private absorbQualification(text: string) {
    const t = text.toLowerCase();
    if (!this.propertyType) {
      if (/(resi|home|flat|apartment|house|bhk|self use|living)/.test(t)) this.propertyType = "residential";
      else if (/(commercial|office|shop|retail|business)/.test(t)) this.propertyType = "commercial";
    }
    const cfg = t.match(/\b([1-5])\s*-?\s*bhk\b/);
    if (cfg && !this.configuration) {
      this.configuration = `${cfg[1]} BHK`;
      if (!this.propertyType) this.propertyType = "residential";
    }
    const tl = parseTimeline(t);
    if (tl && !this.timeline) this.timeline = tl;
  }

  private nextQualification(): TurnResult {
    const q = this.pendingQuestion();
    if (q) {
      this.state = "qualifying";
      this.markAsked(q);
      return this.say(q);
    }
    this.state = "offering_visit";
    return this.say(`Thank you. Would you like to visit ${this.ctx.projectName} to see it in person?`);
  }

  private slotPrompt(): string {
    if (this.ctx.schedulingAvailable && this.ctx.slots.length > 0) {
      return "Great. What day and time works best for you?";
    }
    return "Great. What day and time would suit you? A coordinator will confirm the exact slot.";
  }

  private captureSlot(text: string): TurnResult {
    const date = parseVisitDate(text, this.today) ?? this.visitDate;
    const time = parseVisitTime(text) ?? this.visitTime;
    this.visitDate = date;
    this.visitTime = time;
    if (!date) return this.say("Which day would suit you?");
    if (!time) return this.say("And around what time?");

    this.visitRequested = true;
    if (this.ctx.schedulingAvailable) {
      // The engine does not know the result yet: the orchestrator must call onReservationResult().
      return this.say("Let me check that slot for you.", [{ type: "reserve_visit", date, time }]);
    }
    this.humanFollowup = true;
    return this.end(
      `I've noted ${date} around ${time} as your preferred time. A coordinator will call you to confirm the visit. Thank you!`,
      "visit_requested_pending_human",
      [{ type: "create_callback_task", reason: "confirm_site_visit", preferredTime: `${date} ${time}` }],
    );
  }

  private captureCallback(text: string): TurnResult {
    this.callbackRequested = true;
    this.callbackTime = text.trim().slice(0, 120) || this.ctx.preferredCallbackTime;
    return this.end("Thank you, I'll call you back then. Goodbye.", "callback_scheduled", [
      { type: "create_callback_task", reason: "customer_requested_callback", preferredTime: this.callbackTime },
    ]);
  }

  get reasonEnded() {
    return this.endReason;
  }
}

/** Maps a call outcome to a lead status. Returns null when the status should not change. */
export function leadStatusForOutcome(o: CallOutcome): string | null {
  if (o.do_not_contact) return "do_not_contact";
  if (o.call_outcome === "wrong_number") return "wrong_number";
  if (o.call_outcome === "not_interested") return "not_interested";
  if (o.visit_confirmed) return "visit_confirmed"; // only ever set after the scheduling system said yes
  if (o.site_visit_requested) return "visit_requested";
  if (o.callback_requested || o.call_outcome === "callback_requested") return "callback_requested";
  if (o.call_outcome === "interested") return "interested";
  if (o.call_outcome === "connected") return "connected";
  return null;
}
