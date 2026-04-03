import { parseEnv } from "@stay-ops/shared";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    parseEnv(process.env);
  }
}
