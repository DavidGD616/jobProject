# Job Hunt Agent

Local-only job discovery and application workspace. The project is currently
in Phase 1: building the ingestion pipeline for official ATS boards.

## Run locally

Requirements: Node 24 and pnpm.

```bash
pnpm install
pnpm dev
```

Open <http://127.0.0.1:3000>. The development and production scripts bind to
`127.0.0.1` by design; this project is not deployed or exposed to the network.

Useful checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Database

The local SQLite database lives at `data/jobs.sqlite` and is created by the
migrations. After changing `src/db/schema.ts`, generate and apply a new
migration:

```bash
pnpm db:generate
pnpm db:migrate
```

See [docs/README.md](docs/README.md) for the architecture and roadmap.
