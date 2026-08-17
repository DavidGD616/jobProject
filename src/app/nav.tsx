import Link from "next/link";

export function AppNav() {
  return (
    <nav aria-label="Primary" className="ledger-nav">
      <Link className="ledger-brand" href="/">Opportunity ledger</Link>
      <div className="ledger-nav-links">
        <Link href="/">Open roles</Link>
        <Link href="/review">Review</Link>
        <Link href="/pipeline">Pipeline</Link>
        <Link href="/tailor">Tailor</Link>
        <Link href="/profile">Profile</Link>
      </div>
    </nav>
  );
}
