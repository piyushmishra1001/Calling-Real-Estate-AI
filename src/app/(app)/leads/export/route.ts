import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/lead-input";

export const dynamic = "force-dynamic";

/** Downloads the organisation's leads as CSV. Partner admins only; row-level security scopes the data. */
export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "partner_admin") return new NextResponse("Not allowed", { status: 403 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("name, phone, email, source, status, enquiry_type, preferred_config, preferred_location, budget, purchase_timeline, consent_status, next_follow_up_at, last_interaction_at, created_at, projects(name), profiles:assigned_to(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(50_000);
  if (error) return new NextResponse("Could not export", { status: 500 });

  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v);
  const csv = toCsv(
    ["Name", "Phone", "Email", "Source", "Project", "Status", "Owner", "Enquiry type", "Configuration", "Location", "Budget (INR)", "Timeline", "Consent", "Next follow-up", "Last interaction", "Created"],
    (data ?? []).map((l) => {
      const p = one(l.projects as { name: string } | { name: string }[] | null);
      const o = one(l.profiles as { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null);
      return [l.name, l.phone, l.email, l.source, p?.name, l.status, o?.full_name ?? o?.email, l.enquiry_type, l.preferred_config, l.preferred_location, l.budget, l.purchase_timeline, l.consent_status, l.next_follow_up_at, l.last_interaction_at, l.created_at];
    }),
  );
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
