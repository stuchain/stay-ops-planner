/** BullMQ passes options through to ioredis; avoids direct `new Redis()` (CJS/ESM default export typing). */
export function bullmqConnectionFromUrl(redisUrl: string) {
  const u = new URL(redisUrl);
  const port = u.port ? Number(u.port) : 6379;
  return {
    host: u.hostname,
    port,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    maxRetriesPerRequest: null,
  };
}
