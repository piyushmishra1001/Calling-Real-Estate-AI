import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";
import { Notice, btnGhost } from "@/components/ui";
import { Nav } from "@/components/nav";

const NAV: { href: string; label: string; icon: string; roles: Role[]; calling?: boolean }[] = [
  { href: "/dashboard", icon: "ri-dashboard-line", label: "Dashboard", roles: ["super_admin", "partner_admin", "partner_employee"] },
  { href: "/insights", icon: "ri-bar-chart-2-line", label: "Insights", roles: ["partner_admin", "partner_employee"] },
  { href: "/leads", icon: "ri-user-search-line", label: "Leads", roles: ["partner_admin", "partner_employee"] },
  { href: "/visits", icon: "ri-map-pin-time-line", label: "Site visits", roles: ["partner_admin", "partner_employee"] },
  { href: "/tasks", icon: "ri-phone-line", label: "Callbacks", roles: ["partner_admin", "partner_employee"] },
  { href: "/projects", icon: "ri-building-line", label: "Projects", roles: ["partner_admin", "partner_employee"] },
  { href: "/campaigns", icon: "ri-megaphone-line", label: "Campaigns", roles: ["partner_admin"], calling: true },
  { href: "/team", icon: "ri-team-line", label: "Team", roles: ["partner_admin"] },
  { href: "/admin/partners", icon: "ri-community-line", label: "Partners", roles: ["super_admin"] },
  { href: "/admin/projects", icon: "ri-building-line", label: "Projects", roles: ["super_admin"] },
  { href: "/admin/calling", icon: "ri-customer-service-2-line", label: "Calling & campaigns", roles: ["super_admin"] },
  { href: "/admin/audit", icon: "ri-file-list-3-line", label: "Audit log", roles: ["super_admin"] },
];

const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  partner_admin: "Partner Admin",
  partner_employee: "Employee",
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const [session, { data: settings }] = await Promise.all([
    getSession(),
    supabase.from("platform_settings").select("calling_kill_switch").eq("id", 1).maybeSingle(),
  ]);
  if (!session) redirect("/login?reason=no-access");
  const links = NAV.filter((n) => n.roles.includes(session.role) && (!n.calling || session.callingEnabled));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-[var(--border-default)] bg-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
        <div className="px-5 py-5">
          <div className="text-lg font-semibold tracking-tight text-[var(--brand)]">LeadPilot AI</div>
          <div className="mt-0.5 truncate text-xs text-[var(--text-body)]">{session.orgName ?? "Platform"}</div>
        </div>
        <Nav items={links.map(({ href, label, icon }) => ({ href, label, icon }))} />
        <div className="mt-auto hidden border-t border-[var(--border-subtle)] p-4 md:block">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand)]" aria-hidden="true">
              {(session.fullName ?? session.email).trim().charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--text-title)]">{session.fullName ?? session.email}</div>
              <div className="text-xs text-[var(--text-body)]">{ROLE_LABEL[session.role]}</div>
            </div>
          </div>
          <form action={signOut} className="mt-3"><button className={btnGhost + " w-full"}>Sign out</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8"><div className="mx-auto w-full max-w-[1216px]">
        {settings?.calling_kill_switch && (
          <div className="mb-4"><Notice tone="red">Calling is paused platform-wide by LeadPilot. No AI calls will be placed until it is lifted.</Notice></div>
        )}
        {children}
        <form action={signOut} className="mt-8 md:hidden"><button className={btnGhost}>Sign out</button></form>
      </div></main>
    </div>
  );
}
