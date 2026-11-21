import Papa from "papaparse";
import { normalizePhone } from "./phone";

export const MAX_IMPORT_ROWS = 5000;

export type ImportRow = {
  name: string;
  phone: string;
  email: string | null;
  source: string | null;
  enquiry_type: "residential" | "commercial" | null;
  preferred_config: string | null;
  preferred_location: string | null;
  budget: number | null;
  purchase_timeline: string | null;
  consent_status: "granted" | "denied" | "unknown";
  /** 'do_not_contact' when the number is already on the organisation's opt-out list. */
  status: "new" | "do_not_contact";
};

export type RejectedRow = { row: number; reason: string; raw: Record<string, string> };

export type ImportResult = {
  fatal: string | null;
  valid: ImportRow[];
  rejected: RejectedRow[];
  summary: { total: number; valid: number; rejected: number; optedOut: number; consentUnknown: number };
};

const ALIASES: Record<string, string[]> = {
  name: ["name", "customername", "fullname", "leadname", "client", "clientname"],
  phone: ["phone", "mobile", "mobilenumber", "phonenumber", "contact", "contactnumber", "whatsapp", "cell"],
  email: ["email", "emailid", "emailaddress"],
  source: ["source", "leadsource", "enquirysource"],
  enquiry_type: ["enquirytype", "propertytype", "type", "category"],
  preferred_config: ["configuration", "config", "bhk", "preferredconfiguration", "unittype"],
  preferred_location: ["location", "preferredlocation", "area", "city"],
  budget: ["budget", "budgetinr", "pricerange"],
  purchase_timeline: ["timeline", "purchasetimeline", "buyingtimeline", "when"],
  consent: ["consent", "consentstatus", "optin", "permission"],
};

const squash = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function mapHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const key = squash(h);
    for (const [field, names] of Object.entries(ALIASES)) {
      if (names.includes(key) && !(field in map)) map[field] = h;
    }
  }
  return map;
}

export function parseBudget(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/[₹,\s]|rs\.?|inr/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)(cr|crore|crores|l|lac|lacs|lakh|lakhs|k)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2];
  if (!unit) return Math.round(n);
  if (unit.startsWith("cr")) return Math.round(n * 10_000_000);
  if (unit === "k") return Math.round(n * 1_000);
  return Math.round(n * 100_000); // l, lac, lakh
}

function parseEnquiryType(raw: string | undefined): ImportRow["enquiry_type"] {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/(resi|home|flat|apartment|villa|bhk|house)/.test(s)) return "residential";
  if (/(comm|office|shop|retail|showroom|warehouse)/.test(s)) return "commercial";
  return null;
}

function parseConsent(raw: string | undefined): ImportRow["consent_status"] {
  if (!raw) return "unknown";
  const s = raw.trim().toLowerCase();
  if (["yes", "y", "true", "1", "granted", "opted in", "opt-in", "optin"].includes(s)) return "granted";
  if (["no", "n", "false", "0", "denied", "opted out", "opt-out", "dnd"].includes(s)) return "denied";
  return "unknown";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates an uploaded lead CSV. Nothing is inserted here: the caller decides what to do with
 * the valid rows. Every rejected row carries its row number and a human-readable reason.
 */
export function parseLeadCsv(
  text: string,
  opts: { existingPhones?: Set<string>; optedOutPhones?: Set<string> } = {},
): ImportResult {
  const existing = opts.existingPhones ?? new Set<string>();
  const optedOut = opts.optedOutPhones ?? new Set<string>();
  const empty = (fatal: string): ImportResult => ({
    fatal,
    valid: [],
    rejected: [],
    summary: { total: 0, valid: 0, rejected: 0, optedOut: 0, consentUnknown: 0 },
  });

  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const cols = mapHeaders(headers);
  if (!cols.name || !cols.phone) {
    return empty(
      `Could not find ${!cols.name ? "a name" : "a phone"} column. Expected headers like "Name" and "Phone". Found: ${headers.join(", ") || "none"}.`,
    );
  }
  if (parsed.data.length === 0) return empty("The file has no data rows.");
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    return empty(`The file has ${parsed.data.length} rows. The limit is ${MAX_IMPORT_ROWS} per import; please split it.`);
  }

  const valid: ImportRow[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Map<string, number>();
  let optedOutCount = 0;
  let consentUnknown = 0;

  parsed.data.forEach((raw, i) => {
    const rowNo = i + 2; // header is row 1
    const get = (field: string) => (cols[field] ? (raw[cols[field]] ?? "").trim() : "");
    const reject = (reason: string) => rejected.push({ row: rowNo, reason, raw });

    const name = get("name");
    if (!name) return reject("Missing name");
    const phone = normalizePhone(get("phone"));
    if (!phone) return reject(`Invalid phone number "${get("phone")}"`);
    const email = get("email");
    if (email && !EMAIL.test(email)) return reject(`Invalid email "${email}"`);
    const firstSeen = seen.get(phone);
    if (firstSeen) return reject(`Duplicate of row ${firstSeen} in this file`);
    if (existing.has(phone)) return reject("Lead with this phone already exists for this project");
    seen.set(phone, rowNo);

    const isOptedOut = optedOut.has(phone);
    if (isOptedOut) optedOutCount++;
    const consent = isOptedOut ? "denied" : parseConsent(get("consent"));
    if (consent === "unknown") consentUnknown++;

    valid.push({
      name,
      phone,
      email: email || null,
      source: get("source") || null,
      enquiry_type: parseEnquiryType(get("enquiry_type")),
      preferred_config: get("preferred_config") || null,
      preferred_location: get("preferred_location") || null,
      budget: parseBudget(get("budget")),
      purchase_timeline: get("purchase_timeline") || null,
      consent_status: consent,
      status: isOptedOut ? "do_not_contact" : "new",
    });
  });

  return {
    fatal: null,
    valid,
    rejected,
    summary: {
      total: parsed.data.length,
      valid: valid.length,
      rejected: rejected.length,
      optedOut: optedOutCount,
      consentUnknown,
    },
  };
}
