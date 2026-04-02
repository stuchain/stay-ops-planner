# Stay Ops Planner

**Work in progress.** Internal tool for short-term rental ops: sync bookings from a channel manager, assign each stay to a **physical unit**, avoid double-booking, and coordinate cleaning and maintenance. Not for guests.

Stack direction: Next.js, PostgreSQL / Prisma, Redis for jobs — see [docs/architecture/CONVENTIONS.md](docs/architecture/CONVENTIONS.md) when present.

**Requirements:** Node 20+, pnpm. **Scripts:** `pnpm dev`, `pnpm build`, `pnpm lint` (see `package.json`).