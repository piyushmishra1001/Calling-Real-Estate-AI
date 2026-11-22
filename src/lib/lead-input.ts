import { parseBudget } from "./csv-import";
import { normalizePhone } from "./phone";

export type LeadFields = {
  name: string;
  email: string | null;
  source: string | null;
  enquiry_type: "residential" | "commercial" | null;
  preferred_config: string | null;
  preferred_location: string | null;
  budget: number | null;
  purchase_timeline: string | null;
};

export type LeadFormResult = { ok: true; phone: string | null; fields: LeadFields } | { ok: false; error: string };

type Getter = (key: string) => string;

const clean = (v: string, max: number) => {
  const t = v.trim().slice(0, max);
  return t === "" ? null : t;
};

/** Validates the fields of the add-lead and edit-lead forms. The server is the authority; the browser only helps. */
export function parseLeadForm(get: Getter, opts: { requirePhone: boolean }): LeadFormResult {
  const name = clean(get("name"), 120);
  if (!name) return { ok: false, error: "Enter the lead's name." };

  let phone: string | null = null;
  if (opts.requirePhone) {
    phone = normalizePhone(get("phone"));
    if (!phone) return { ok: false, error: "Enter a valid phone number, for example 98765 43210." };
  }

  const email = clean(get("email"), 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address, or leave it blank." };

  const et = get("enquiry_type").trim().toLowerCase();
  if (et && et !== "residential" && et !== "commercial") return { ok: false, error: "Enquiry type must be residential or commercial." };

  const budgetRaw = get("budget").trim();
  const budget = budgetRaw ? parseBudget(budgetRaw) : null;
  if (budgetRaw && budget === null) return { ok: false, error: "Enter the budget as a number, for example 85 lakh or 1.2 cr." };

  return {
    ok: true,
    phone,
    fields: {
      name,
      email,
      source: clean(get("source"), 80),
      enquiry_type: et === "residential" || et === "commercial" ? et : null,
      preferred_config: clean(get("preferred_config"), 80),
      preferred_location: clean(get("preferred_location"), 120),
      budget,
      purchase_timeline: clean(get("purchase_timeline"), 80),
    },
  };
}

/** Escapes one CSV cell, and neutralises spreadsheet formulas (a cell starting with = + - @ would run in Excel). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}
