"use client";

import { useId, useMemo, useState } from "react";

type CompanyOption = { slug: string; name: string };

type CompanyPickerProps = {
  companies: CompanyOption[];
  defaultSlug: string | null;
};

function initialName(companies: readonly CompanyOption[], slug: string | null): string {
  return companies.find((company) => company.slug === slug)?.name ?? "";
}

/** A small keyboard-accessible company search that keeps the selected slug URL-safe. */
export function CompanyPicker({ companies, defaultSlug }: CompanyPickerProps) {
  const listboxId = useId();
  const [query, setQuery] = useState(() => initialName(companies, defaultSlug));
  const [selectedSlug, setSelectedSlug] = useState(defaultSlug ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? companies.filter((company) => company.name.toLocaleLowerCase().includes(needle)).slice(0, 10) : companies.slice(0, 10);
  }, [companies, query]);

  function choose(company: CompanyOption): void {
    setQuery(company.name);
    setSelectedSlug(company.slug);
    setOpen(false);
    setActiveIndex(0);
  }

  function clear(): void {
    setQuery("");
    setSelectedSlug("");
    setOpen(false);
    setActiveIndex(0);
  }

  return (
    <div className="relative">
      <input name="company" type="hidden" value={selectedSlug} />
      <div className="relative">
        <input
          aria-activedescendant={open && matches[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          autoComplete="off"
          className="ledger-control pr-10"
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            const value = event.target.value;
            const exact = companies.find((company) => company.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
            setQuery(value);
            setSelectedSlug(exact?.slug ?? "");
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && open && matches[activeIndex]) {
              event.preventDefault();
              choose(matches[activeIndex]!);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
          placeholder="Search a company"
          role="combobox"
          type="search"
          value={query}
        />
        {query ? <button aria-label="Clear company filter" className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center border border-transparent text-sm font-bold text-[var(--muted)] transition hover:border-[var(--ledger-border)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rust)]" onMouseDown={(event) => event.preventDefault()} onClick={clear} type="button">×</button> : null}
      </div>
      {open ? <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto border border-[var(--ledger-border)] bg-[var(--paper)] py-1 shadow-[0_16px_35px_rgba(45,35,17,0.16)]" id={listboxId} role="listbox">{matches.length > 0 ? matches.map((company, index) => <li aria-selected={selectedSlug === company.slug} className={`cursor-pointer px-3 py-2 text-sm text-[var(--ink-soft)] transition hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] ${index === activeIndex ? "bg-[var(--paper-deep)]" : ""}`} id={`${listboxId}-${index}`} key={company.slug} onMouseDown={(event) => { event.preventDefault(); choose(company); }} role="option">{company.name}</li>) : <li aria-selected={false} className="px-3 py-2 text-sm text-[var(--muted)]" role="option">No live board matches that name.</li>}</ul> : null}
    </div>
  );
}
