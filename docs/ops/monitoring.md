# Monitoring and alerts

Everything here goes to Stelios. Nothing in Sentry can be configured from code, so the Sentry
steps below are click-by-click.

## 1. Secrets and env vars to set

Vercel (Project > Settings > Environment Variables, Production):

| Name | Purpose |
| --- | --- |
| `CRON_SECRET` | Min 16 chars. Guards `/api/cron/health-alerts` (and the sync cron). Same value as the GitHub secret. |
| `RESEND_API_KEY`, `ALERT_EMAIL_TO` | Email alerts. Also set `ALERT_EMAIL_FROM` to an address on a domain verified in Resend. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Optional Telegram alerts. Either channel, or both. With neither, alerts are only logged. |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Already used by the app. |
| `SENTRY_USER_ID_PEPPER` | Secret string; user ids are hashed with it before reaching Sentry. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Source map upload during the Vercel build. |

GitHub (Repo > Settings > Secrets and variables > Actions):

| Name | Purpose |
| --- | --- |
| `PRODUCTION_URL` | `https://...` of the live site. Used by the health check and the alerts workflow. |
| `CRON_SECRET` | Same as Vercel. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Only if Vercel deployment protection is on. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Tag builds (`v*`) upload source maps. |

## 2. Sentry

Code already does: release `stay-ops-web@<version>+<7-char commit>` (from `VERCEL_GIT_COMMIT_SHA`, or
`SENTRY_RELEASE` if set) for the build, source maps, server, edge and browser events; user id hashed
with the pepper.

Alert rules (Sentry > Alerts > Create Alert), one project:

1. **New issue.** Alert type "Issues". Environment: production. When: "A new issue is created".
   If: (none). Then: "Send a notification to Member" > Stelios (email). Name: "New issue".
2. **Error spike.** Alert type "Issues" > "Number of errors" (metric alert).
   Metric: `count()` of events where `event.type:error`, environment production. Time window: 1 hour.
   Critical threshold: above 20 errors; Warning: above 10. Action: email Stelios.
   Name: "Error spike". Tune the numbers after a week of real traffic.
3. In Settings > Account > Notifications, make sure Issue Alerts email is on for Stelios.

## 3. Sync health alerts

`.github/workflows/health-alerts.yml` calls `GET /api/cron/health-alerts` every 30 minutes with
`Authorization: Bearer $CRON_SECRET`. An alert is sent when:

- the last successful sync is older than 3 hours during 08:00-22:00 Europe/Athens, or
- the last 2 sync runs in a row failed (any hour).

The app stores what it last reported (table `alert_states`), so the same problem is sent once, and
a "recovered" note is sent when it clears. Logic: `apps/web/src/server/monitoring/syncHealth.ts`.
Test manually: Actions > "Sync health alerts" > Run workflow.

## 3b. Daily reminder (P4-3)

`.github/workflows/daily-reminders.yml` calls `/api/cron/daily-reminders` at 05:00 UTC (08:00 Athens in summer,
07:00 in winter) with the same `PRODUCTION_URL` and `CRON_SECRET` secrets. The app sends, in Greek, today's
arrivals and departures, tomorrow's arrivals and how many bookings have no apartment, at most once a day and only
when there is something to say. It uses the same Resend or Telegram setup as the alerts; set `REMINDER_EMAIL_TO`
(comma-separated, for example the father's address) or `REMINDER_TELEGRAM_CHAT_ID` in Vercel to send it somewhere
else. Switch it off or send a test from Dev mode > System. The "Στείλε στον Στέλιο" help button (P4-11) also
mails `ALERT_EMAIL_TO`.

## 4. Uptime

`.github/workflows/health-check.yml` also runs every 15 minutes against `${PRODUCTION_URL}/api/health`.
A failed run makes GitHub email the repo's watchers (Watch > Custom > Actions) and the person who
last edited the schedule. Stelios must watch the repo with "Actions" notifications on.

## 5. Restore rehearsal

A monthly issue "Monthly restore rehearsal" is opened by `.github/workflows/restore-rehearsal-reminder.yml`.

```
node scripts/restore-rehearsal.mjs                    # dry run: prints the plan
SOURCE_DATABASE_URL=... SCRATCH_DATABASE_URL=... node scripts/restore-rehearsal.mjs --execute
```

Needs `pg_dump`, `pg_restore`, `psql` 16+. It dumps the source, restores into an EMPTY scratch
database, compares row counts, and refuses if source and scratch are the same.

Neon point-in-time restore: Neon console > Branches > Create branch > "Past data", pick a time;
then `SCRATCH_DATABASE_URL=<branch url> node scripts/restore-rehearsal.mjs --execute --compare-only`.
Delete the scratch branch afterwards.

## 6. Retention

`packages/db/scripts/retention-prune.mjs` refuses `RETENTION_MONTHS` below 12 (audit history).
