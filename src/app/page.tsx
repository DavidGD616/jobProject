const plannedStages = [
  {
    name: "Discover",
    description: "Find company career boards and verify the official ATS endpoint.",
  },
  {
    name: "Ingest",
    description: "Normalize, deduplicate, and keep job listings fresh in SQLite.",
  },
  {
    name: "Match",
    description: "Rank openings against a structured profile using explainable signals.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-12 sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-16">
        <header className="flex flex-col gap-6 border-b border-slate-200 pb-12">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">
            Local workspace
          </p>
          <div className="max-w-3xl space-y-5">
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
              Job hunting, organized around your judgment.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-600">
              The app will discover official job boards, bring openings into one
              searchable place, and help you decide what is worth your time.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-slate-600">
            <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-800">
              Runs on this machine
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">
              Human stays in control
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">
              Phase 1: ingest pipeline
            </span>
          </div>
        </header>

        <section aria-labelledby="roadmap-heading" className="space-y-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              What comes next
            </p>
            <h2
              id="roadmap-heading"
              className="mt-2 text-2xl font-semibold tracking-tight text-slate-950"
            >
              A small foundation before the matching engine
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {plannedStages.map((stage, index) => (
              <article
                key={stage.name}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <p className="text-sm font-semibold text-blue-700">0{index + 1}</p>
                <h3 className="mt-8 text-xl font-semibold text-slate-950">
                  {stage.name}
                </h3>
                <p className="mt-3 leading-7 text-slate-600">{stage.description}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="border-t border-slate-200 pt-6 text-sm text-slate-500">
          Scaffold, database schema, and Greenhouse source adapter are ready.
          Next: discovery, scheduled ingest, and the local job list.
        </footer>
      </div>
    </main>
  );
}
