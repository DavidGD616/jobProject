"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/profile", label: "Profile", description: "Set your direction", step: "01", matches: (path: string) => path.startsWith("/profile") },
  { href: "/", label: "Explore", description: "Browse open roles", step: "02", matches: (path: string) => path === "/" || path.startsWith("/jobs/") },
  { href: "/review", label: "Matches", description: "Choose your best fits", step: "03", matches: (path: string) => path.startsWith("/review") },
  { href: "/pipeline", label: "Applications", description: "Keep momentum", step: "04", matches: (path: string) => path.startsWith("/pipeline") },
  { href: "/tailor", label: "Materials", description: "Tailor your resume", step: "05", matches: (path: string) => path.startsWith("/tailor") },
  { href: "/apply", label: "Form prep", description: "Submit yourself", step: "06", matches: (path: string) => path.startsWith("/apply") },
] as const;

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="ledger-nav">
      <div className="ledger-nav-top">
        <Link aria-label="Opportunity Desk home" className="ledger-brand" href="/">
          <span aria-hidden="true" className="ledger-brand-mark">OD</span>
          <span className="ledger-brand-copy">
            <span>Opportunity Desk</span>
            <small>Your job search, in one place</small>
          </span>
        </Link>
        <span className="ledger-nav-note">Local workspace</span>
      </div>
      <div className="ledger-nav-links">
        {navigation.map((item) => {
          const active = item.matches(pathname);
          return (
            <Link aria-current={active ? "page" : undefined} href={item.href} key={item.href}>
              <span aria-hidden="true" className="ledger-nav-step">{item.step}</span>
              <span className="ledger-nav-label">
                <span>{item.label}</span>
                <small>{item.description}</small>
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
