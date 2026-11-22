"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string };

/** Sidebar links with an active state. Prefetch is off so opening the app does not trigger a request per page. */
export function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0" aria-label="Main">
      {items.map((l) => {
        const active = pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={
              "flex items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-sm font-medium transition-colors " +
              (active
                ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                : "text-[var(--text-body)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-title)]")
            }
          >
            <i className={`${l.icon} text-[18px] ${active ? "text-[var(--brand-accent)]" : "text-[var(--text-soft-400)]"}`} aria-hidden="true" />
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
