import { describe, expect, it } from "vitest";
import { withConnectTimeout } from "@/lib/databaseUrl";

describe("withConnectTimeout", () => {
  it("adds a 15 second connect timeout and keeps the other options", () => {
    const url = withConnectTimeout("postgresql://u:p@ep-x.neon.tech/db?sslmode=require");
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("connect_timeout")).toBe("15");
    expect(parsed.searchParams.get("sslmode")).toBe("require");
    expect(parsed.password).toBe("p");
  });

  it("leaves a URL that already sets connect_timeout alone", () => {
    const url = "postgresql://u:p@host/db?connect_timeout=30";
    expect(withConnectTimeout(url)).toBe(url);
  });

  it("passes through a missing or unparsable URL", () => {
    expect(withConnectTimeout(undefined)).toBeUndefined();
    expect(withConnectTimeout("not a url")).toBe("not a url");
  });
});
