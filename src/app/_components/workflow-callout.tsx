import type { ReactNode } from "react";

type WorkflowCalloutProps = {
  eyebrow: string;
  title: string;
  children: ReactNode;
  tone?: "paper" | "signal" | "ink";
  className?: string;
};

/** Small editorial callout used to make the immediate decision obvious. */
export function WorkflowCallout({
  eyebrow,
  title,
  children,
  tone = "paper",
  className = "",
}: WorkflowCalloutProps) {
  const toneClass = {
    paper: "border-[color:color-mix(in_srgb,var(--ink)_14%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_86%,transparent)]",
    signal: "border-[#d8b54b] bg-[#fff5d2]",
    ink: "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]",
  }[tone];
  const mutedClass = tone === "ink" ? "text-[color:rgba(255,250,238,0.7)]" : "text-[var(--muted)]";
  const eyebrowClass = tone === "ink" ? "text-[var(--paper)]" : "text-[var(--rust)]";

  return (
    <section className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${toneClass} ${className}`}>
      <p className={`text-xs font-semibold ${eyebrowClass}`}>{eyebrow}</p>
      <h2 className="mt-2 break-words font-serif text-2xl leading-tight tracking-[-0.035em]">{title}</h2>
      <div className={`mt-2 break-words text-sm leading-6 ${mutedClass}`}>{children}</div>
    </section>
  );
}
