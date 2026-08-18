"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/", label: "Open roles", matches: (path: string) => path === "/" || path.startsWith("/jobs/") },
  { href: "/review", label: "Review", matches: (path: string) => path.startsWith("/review") },
  { href: "/pipeline", label: "Pipeline", matches: (path: string) => path.startsWith("/pipeline") },
  { href: "/tailor", label: "Tailor", matches: (path: string) => path.startsWith("/tailor") },
  { href: "/apply", label: "Apply", matches: (path: string) => path.startsWith("/apply") },
  { href: "/profile", label: "Profile", matches: (path: string) => path.startsWith("/profile") },
] as const;

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="ledger-nav">
      <Link className="ledger-brand" href="/">Opportunity ledger</Link>
      <div className="ledger-nav-links">
        {navigation.map((item) => {
          const active = item.matches(pathname);
          return <Link aria-current={active ? "page" : undefined} href={item.href} key={item.href}>{item.label}</Link>;
        })}
      </div>
    </nav>
  );
}
