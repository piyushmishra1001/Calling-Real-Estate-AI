import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";
import { Notice, btnGhost } from "@/components/ui";

const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["super_admin", "partner_admin", "partner_employee"] },
  { href: "/leads", label: "Leads", roles: ["partner_admin", "partner_employee"] },
  { href: "/visits", label: "Site visits", roles: ["partner_admin", "partner_employee"] },
  { href: "/tasks", label: "Callbacks", roles: ["partner_admin", "partner_employee"] },
  { href: "/projects", label: "Projects", roles: ["partner_admin", "partner_employee"] },
  { href: "/campaigns", label: "Campaigns", roles: ["partner_admin"] },
  { href: "/team", label: "Team", roles: ["partner_admin"] },
  { href: "/admin/partners", label: "Partners", roles: ["super_admin"] },
  { href: "/admin/projects", label: "Projects", roles: ["super_admin"] },
  { href: "/admin/calling", label: "Calling & campaigns", roles: ["super_admin"] },
  { href: "/admin/audit", label: "Audit log", roles: ["super_admin"] },
];

const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  partner_admin: "Partner Admin",
  partner_employee: "Employee",
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login?reason=no-access");

  const supabase = await createClient();
  const { data: settings } = await supabase.from("platform_settings").select("calling_kill_switch").eq("id", 1).maybeSingle();
  const links = NAV.filter((n) => n.roles.includes(session.role));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white md:w-56 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <div>
            <div className="text-lg font-bold text-indigo-700">LeadPilot AI</div>
            <div className="text-xs text-slate-500">{session.orgName ?? "Platform"}</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-slate-100 p-4 text-xs text-slate-500 md:block">
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
