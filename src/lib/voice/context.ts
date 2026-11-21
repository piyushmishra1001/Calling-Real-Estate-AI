/** The minimum context Riya needs for one call. The whole CRM is never sent to the model. */
export type ApprovedFacts = {
  location?: string;
  configurations?: string;
  pricing?: string;
  paymentPlans?: string;
  possession?: string;
  amenities?: string;
  connectivity?: string;
  siteVisitAddress?: string;
};

export type RiyaContext = {
  companyName: string;
  customerName: string;
  projectName: string;
  projectLocation: string | null;
  enquirySource: string | null;
  enquiryType: "residential" | "commercial" | null;
  configuration: string | null;
  previousOutcome: string | null;
  preferredCallbackTime: string | null;
  facts: ApprovedFacts;
  faqs: { q: string; a: string }[];
  /** ISO start times offered to the customer. Empty when no calendar is connected. */
  slots: string[];
  schedulingAvailable: boolean;
};

export class KnowledgeBaseNotApprovedError extends Error {
  constructor(projectName: string) {
    super(`Project "${projectName}" has no approved knowledge base. Riya cannot call about it.`);
    this.name = "KnowledgeBaseNotApprovedError";
  }
}

type LeadInput = {
  name: string;
  enquiry_type?: "residential" | "commercial" | null;
  preferred_config?: string | null;
  source?: string | null;
  last_call_outcome?: string | null;
  preferred_callback_time?: string | null;
  // Anything else on the lead is deliberately ignored.
  [k: string]: unknown;
};

type KbInput = { status: string; facts: ApprovedFacts; faqs?: { q: string; a: string }[] } | null;

/** Refuses to build a context from anything but an APPROVED knowledge-base version. */
export function buildRiyaContext(args: {
  companyName: string;
  lead: LeadInput;
  project: { name: string; location?: string | null };
  kb: KbInput;
  slots?: string[];
  schedulingAvailable?: boolean;
}): RiyaContext {
  if (!args.kb || args.kb.status !== "approved") throw new KnowledgeBaseNotApprovedError(args.project.name);
  return {
    companyName: args.companyName,
    customerName: args.lead.name,
    projectName: args.project.name,
    projectLocation: args.project.location ?? args.kb.facts.location ?? null,
    enquirySource: args.lead.source ?? null,
    enquiryType: args.lead.enquiry_type ?? null,
    configuration: args.lead.preferred_config ?? null,
    previousOutcome: args.lead.last_call_outcome ?? null,
    preferredCallbackTime: args.lead.preferred_callback_time ?? null,
    facts: { ...args.kb.facts },
    faqs: (args.kb.faqs ?? []).map((f) => ({ q: f.q, a: f.a })),
    slots: args.slots ?? [],
    schedulingAvailable: args.schedulingAvailable ?? false,
  };
}
