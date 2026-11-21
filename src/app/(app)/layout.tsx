import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";
import { Notice, btnGhost } from "@/components/ui";

const NAV: { href: string; label: string; icon: string; roles: Role[] }[] = [
  { href: "/dashboard", icon: "ri-dashboard-line", label: "Dashboard", roles: ["super_admin", "partner_admin", "partner_employee"] },
  { href: "/leads", icon: "ri-user-search-line", label: "Leads", roles: ["partner_admin", "partner_employee"] },
  { href: "/visits", icon: "ri-map-pin-time-line", label: "Site visits", roles: ["partner_admin", "partner_employee"] },
  { href: "/tasks", icon: "ri-phone-line", label: "Callbacks", roles: ["partner_admin", "partner_employee"] },
  { href: "/projects", icon: "ri-building-line", label: "Projects", roles: ["partner_admin", "partner_employee"] },
  { href: "/campaigns", icon: "ri-megaphone-line", label: "Campaigns", roles: ["partner_admin"] },
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
  const links = NAV.filter((n) => n.roles.includes(session.role));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-[var(--border-default)] bg-white md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <div>
            <div className="text-lg font-semibold tracking-tight text-[var(--brand)]">LeadPilot AI</div>
            <div className="text-xs text-[var(--text-body)]">{session.orgName ?? "Platform"}</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="flex items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-sm font-medium text-[var(--text-body)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text-title)]">
              <i className={`${l.icon} text-[18px] text-[var(--text-soft-400)]`} aria-hidden="true" />
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-[var(--border-subtle)] p-4 text-xs text-slate-500 md:block">
          <div className="truncate font-medium text-slate-700">{session.fullName ?? session.email}</div>
          <div>{ROLE_LABEL[session.role]}</div>
          <form action={signOut} className="mt-3"><button className={btnGhost + " w-full"}>Sign out</button></form>
        </div>
      </aside>
      <main className="flex-1 px-4 py-6 md:px-8">
        {settings?.calling_kill_switch && (
          <div className="mb-4"><Notice tone="red">Calling is paused platform-wide by LeadPilot. No AI calls will be placed until it is lifted.</Notice></div>
        )}
        {children}
        <form action={signOut} className="mt-8 md:hidden"><button className={btnGhost}>Sign out</button></form>
      </main>
    </div>
  );
}
