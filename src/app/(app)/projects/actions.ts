"use server";

import { revalidatePath } from "next/cache";
import { audit, requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type ProjectState = { error?: string; message?: string } | undefined;

/**
 * A Partner Admin adds a project for their own organisation, so a CRM customer can start adding leads at once.
 * Projects are platform records (RLS only lets the Super Admin write them), so this uses the server-only admin client
 * and only ever assigns the new project to the caller's own organisation.
 */
export async function addProject(_: ProjectState, form: FormData): Promise<ProjectState> {
  const s = await requireRole("partner_admin");
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const location = String(form.get("location") ?? "").trim().slice(0, 120) || null;
  const developer = String(form.get("developer") ?? "").trim().slice(0, 120) || null;
  if (!name) return { error: "Enter a project name." };

  const admin = createAdminClient();
  const { data: project, error } = await admin.from("projects").insert({ name, location, developer, created_by: s.userId }).select("id").single();
  if (error || !project) return { error: "Could not add the project." };
  const { error: aErr } = await admin.from("project_assignments").insert({ project_id: project.id, org_id: s.orgId! });
  if (aErr) {
    await admin.from("projects").delete().eq("id", project.id);
    return { error: "Could not add the project." };
  }
  await audit(s, "project.create", "project", project.id, { name });
  revalidatePath("/projects");
  revalidatePath("/leads/new");
  return { message: `${name} added.` };
}
