import { getReadinessResponse } from "@/modules/health/readiness";

export async function GET() {
  return getReadinessResponse();
}
