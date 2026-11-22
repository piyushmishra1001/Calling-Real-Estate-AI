import { describe, expect, it } from "vitest";
import { csvCell, parseLeadForm, toCsv } from "@/lib/lead-input";

const form = (o: Record<string, string>) => (k: string) => o[k] ?? "";

describe("parseLeadForm", () => {
  it("accepts a minimal lead and normalises the phone", () => {
    const r = parseLeadForm(form({ name: " Asha ", phone: "98765 43210" }), { requirePhone: true });
    expect(r).toMatchObject({ ok: true, phone: "+919876543210", fields: { name: "Asha", budget: null, email: null } });
  });
  it("parses a budget written the Indian way", () => {
    const r = parseLeadForm(form({ name: "A", phone: "9876543210", budget: "85 lakh" }), { requirePhone: true });
    expect(r.ok && r.fields.budget).toBe(8_500_000);
  });
  it.each([
    [{ phone: "9876543210" }, /name/i],
    [{ name: "A", phone: "123" }, /phone/i],
    [{ name: "A", phone: "9876543210", email: "nope" }, /email/i],
    [{ name: "A", phone: "9876543210", enquiry_type: "villa" }, /enquiry/i],
    [{ name: "A", phone: "9876543210", budget: "lots" }, /budget/i],
  ])("rejects bad input %#", (input, msg) => {
    const r = parseLeadForm(form(input), { requirePhone: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
  it("does not need a phone when editing", () => {
    expect(parseLeadForm(form({ name: "A" }), { requirePhone: false }).ok).toBe(true);
  });
  it("caps overly long text", () => {
    const r = parseLeadForm(form({ name: "x".repeat(500), phone: "9876543210" }), { requirePhone: true });
    expect(r.ok && r.fields.name.length).toBe(120);
  });
});

describe("csv export", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it.each(["=SUM(A1)", "+1", "-1", "@cmd"])("neutralises formula %s", (v) => {
    expect(csvCell(v).startsWith("'")).toBe(true);
  });
  it("writes headers and rows", () => {
    expect(toCsv(["a", "b"], [[1, null], ["x,y", 2]])).toBe('a,b\r\n1,\r\n"x,y",2\r\n');
  });
});
