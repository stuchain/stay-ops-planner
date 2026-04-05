import { handleHosthubWebhookPost } from "@/modules/sync/hosthubWebhook";

export async function POST(request: Request) {
  return handleHosthubWebhookPost(request);
}
