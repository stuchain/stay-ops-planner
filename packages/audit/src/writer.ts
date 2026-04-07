import { Prisma } from "@stay-ops/db";

type JsonObject = Record<string, unknown>;

const REDACT_KEYS = new Set(["password", "passwordHash", "token", "accessToken", "refreshToken", "rawPayload"]);

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const input = value as JsonObject;
  const out: JsonObject = {};
  for (const [key, child] of Object.entries(input)) {
    if (REDACT_KEYS.has(key)) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = redactValue(child);
    }
  }
  return out;
}

export type AuditSnapshotWrite = {
  actorUserId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  meta?: JsonObject;
};

export async function writeAuditSnapshot(
  tx: Prisma.TransactionClient,
  args: AuditSnapshotWrite,
): Promise<string> {
  const row = await tx.auditEvent.create({
    data: {
      userId: args.actorUserId ?? null,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      beforeJson: args.before ? (redactValue(args.before) as Prisma.InputJsonValue) : Prisma.JsonNull,
      afterJson: args.after ? (redactValue(args.after) as Prisma.InputJsonValue) : Prisma.JsonNull,
      metaJson: args.meta ? (redactValue(args.meta) as Prisma.InputJsonValue) : Prisma.JsonNull,
      payload: Prisma.JsonNull,
    },
    select: { id: true },
  });
  return row.id;
}
