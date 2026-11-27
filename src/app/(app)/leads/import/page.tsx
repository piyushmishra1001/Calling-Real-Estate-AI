import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ImportForm } from "@/components/import-form";
import { Notice, PageHeader } from "@/components/ui";

export default async function ImportPage() {
  await requireRole("partner_admin");
  const supabase = await createClient();
  const [{ data: projects }, { data: employees }] = await Promise.all([
    supabase.from("projects").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name, email").eq("role", "partner_employee").eq("is_active", true),
  ]);
  return (
    <>
      <PageHeader title="Import leads" subtitle="Upload a CSV of existing enquiries for one project." />
      {(projects ?? []).length === 0 ? (
        <Notice>Add a project first (Projects in the menu), then come back to add leads.</Notice>
      ) : (
        <ImportForm projects={projects!} employees={(employees ?? []).map((e) => ({ id: e.id, name: e.full_name ?? e.email ?? e.id }))} />
      )}
    </>
  );
}
