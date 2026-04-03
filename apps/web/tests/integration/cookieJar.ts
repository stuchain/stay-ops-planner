export class CookieJar {
  private readonly cookies = new Map<string, string>();

  getCookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  applySetCookieHeader(response: Response) {
    const headersAny = response.headers as unknown as { getSetCookie?: () => string[] };
    const setCookies =
      typeof headersAny.getSetCookie === "function"
        ? headersAny.getSetCookie()
        : (() => {
            const single = response.headers.get("set-cookie");
            return single ? [single] : [];
          })();

    for (const setCookie of setCookies) {
      // e.g. "stay_ops_session=token; Path=/; HttpOnly; SameSite=lax; Max-Age=86400"
      const [pair] = setCookie.split(";");
      const [name, value] = pair.split("=");
      if (!name) continue;

      const maxAgeMatch = /Max-Age=([0-9]+)/i.exec(setCookie);
      const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : undefined;
      if (maxAge === 0) {
        this.cookies.delete(name);
        continue;
      }

      // If the server clears the cookie without Max-Age, delete when empty.
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

