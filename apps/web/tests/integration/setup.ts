process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.APP_TIMEZONE ??= "Etc/UTC";

// Keep integration tests isolated from the main dev dataset.
process.env.DATABASE_URL ??= "postgresql://stayops:stayops@localhost:5432/stayops?schema=vitest";

