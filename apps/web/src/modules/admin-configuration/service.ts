import {
  Prisma,
  type AlertConfigChannel,
  type AlertConfigEventType,
  type OperationalThresholdKey,
} from "@stay-ops/db";
import { prisma } from "@/lib/prisma";
import { writeAuditSnapshot } from "@stay-ops/audit";

export type AdminAlertTemplateRecord = {
  id: string;
  eventType: AlertConfigEventType;
  channel: AlertConfigChannel;
  templateVersion: number;
  title: string | null;
  body: string;
  enabled: boolean;
  metaJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminThresholdRecord = {
  id: string;
  key: OperationalThresholdKey;
  numericValue: string | null;
  stringValue: string | null;
  unit: string | null;
  notes: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertAlertTemplateInput = {
  eventType: AlertConfigEventType;
  channel: AlertConfigChannel;
  templateVersion?: number;
  title?: string | null;
  body: string;
  enabled?: boolean;
  metaJson?: Record<string, unknown> | null;
  actorUserId?: string;
  auditMeta?: Record<string, unknown>;
};

export type UpsertThresholdInput = {
  key: OperationalThresholdKey;
  numericValue?: number | null;
  stringValue?: string | null;
  unit?: string | null;
  notes?: string | null;
  enabled?: boolean;
  actorUserId?: string;
  auditMeta?: Record<string, unknown>;
};

export type UpdateAlertTemplateByIdInput = {
  title?: string | null;
  body?: string;
  enabled?: boolean;
  metaJson?: Record<string, unknown> | null;
  actorUserId?: string;
  auditMeta?: Record<string, unknown>;
};

export type UpdateThresholdByIdInput = {
  numericValue?: number | null;
  stringValue?: string | null;
  unit?: string | null;
  notes?: string | null;
  enabled?: boolean;
  actorUserId?: string;
  auditMeta?: Record<string, unknown>;
};

export class AdminConfigNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;
  constructor(public readonly entity: "alert_template" | "threshold", public readonly id: string) {
    super(`${entity} not found`);
    this.name = "AdminConfigNotFoundError";
  }
}

export async function listAlertTemplates(): Promise<AdminAlertTemplateRecord[]> {
  return prisma.alertTemplateConfig.findMany({
    orderBy: [{ eventType: "asc" }, { channel: "asc" }, { templateVersion: "desc" }],
  });
}

export async function listOperationalThresholds(): Promise<AdminThresholdRecord[]> {
  const rows = await prisma.operationalThresholdConfig.findMany({ orderBy: [{ key: "asc" }] });
  return rows.map((row) => ({
    ...row,
    numericValue: row.numericValue?.toString() ?? null,
  }));
}

export async function upsertAlertTemplate(input: UpsertAlertTemplateInput): Promise<AdminAlertTemplateRecord> {
  const templateVersion = input.templateVersion ?? 1;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.alertTemplateConfig.findUnique({
      where: {
        eventType_channel_templateVersion: {
          eventType: input.eventType,
          channel: input.channel,
          templateVersion,
        },
      },
    });

    const saved = existing
      ? await tx.alertTemplateConfig.update({
          where: { id: existing.id },
          data: {
            title: input.title ?? null,
            body: input.body,
            enabled: input.enabled ?? true,
            metaJson: input.metaJson ? (input.metaJson as Prisma.InputJsonValue) : Prisma.JsonNull,
          },
        })
      : await tx.alertTemplateConfig.create({
          data: {
            eventType: input.eventType,
            channel: input.channel,
            templateVersion,
            title: input.title ?? null,
            body: input.body,
            enabled: input.enabled ?? true,
            metaJson: input.metaJson ? (input.metaJson as Prisma.InputJsonValue) : Prisma.JsonNull,
          },
        });

    await writeAuditSnapshot(tx, {
      actorUserId: input.actorUserId,
      action: existing ? "admin_config.alert_template.update" : "admin_config.alert_template.create",
      entityType: "alert_template_config",
      entityId: saved.id,
      before: existing
        ? {
            eventType: existing.eventType,
            channel: existing.channel,
            templateVersion: existing.templateVersion,
            title: existing.title,
            body: existing.body,
            enabled: existing.enabled,
            metaJson: existing.metaJson,
          }
        : null,
      after: {
        eventType: saved.eventType,
        channel: saved.channel,
        templateVersion: saved.templateVersion,
        title: saved.title,
        body: saved.body,
        enabled: saved.enabled,
        metaJson: saved.metaJson,
      },
      meta: {
        ...(input.auditMeta ?? {}),
        eventType: saved.eventType,
        channel: saved.channel,
      },
    });

    return saved;
  });
}

export async function upsertOperationalThreshold(input: UpsertThresholdInput): Promise<AdminThresholdRecord> {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.operationalThresholdConfig.findUnique({ where: { key: input.key } });
    const saved = existing
      ? await tx.operationalThresholdConfig.update({
          where: { id: existing.id },
          data: {
            numericValue: input.numericValue ?? null,
            stringValue: input.stringValue ?? null,
            unit: input.unit ?? null,
            notes: input.notes ?? null,
            enabled: input.enabled ?? true,
          },
        })
      : await tx.operationalThresholdConfig.create({
          data: {
            key: input.key,
            numericValue: input.numericValue ?? null,
            stringValue: input.stringValue ?? null,
            unit: input.unit ?? null,
            notes: input.notes ?? null,
            enabled: input.enabled ?? true,
          },
        });

    await writeAuditSnapshot(tx, {
      actorUserId: input.actorUserId,
      action: existing ? "admin_config.threshold.update" : "admin_config.threshold.create",
      entityType: "operational_threshold_config",
      entityId: saved.id,
      before: existing
        ? {
            key: existing.key,
            numericValue: existing.numericValue?.toString() ?? null,
            stringValue: existing.stringValue,
            unit: existing.unit,
            notes: existing.notes,
            enabled: existing.enabled,
          }
        : null,
      after: {
        key: saved.key,
        numericValue: saved.numericValue?.toString() ?? null,
        stringValue: saved.stringValue,
        unit: saved.unit,
        notes: saved.notes,
        enabled: saved.enabled,
      },
      meta: { ...(input.auditMeta ?? {}), thresholdKey: saved.key },
    });

    return saved;
  });

  return {
    ...result,
    numericValue: result.numericValue?.toString() ?? null,
  };
}

export async function updateAlertTemplateById(
  id: string,
  patch: UpdateAlertTemplateByIdInput,
): Promise<AdminAlertTemplateRecord> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.alertTemplateConfig.findUnique({ where: { id } });
    if (!existing) throw new AdminConfigNotFoundError("alert_template", id);

    const saved = await tx.alertTemplateConfig.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.metaJson !== undefined
          ? { metaJson: patch.metaJson ? (patch.metaJson as Prisma.InputJsonValue) : Prisma.JsonNull }
          : {}),
      },
    });

    await writeAuditSnapshot(tx, {
      actorUserId: patch.actorUserId,
      action: "admin_config.alert_template.update",
      entityType: "alert_template_config",
      entityId: saved.id,
      before: {
        eventType: existing.eventType,
        channel: existing.channel,
        templateVersion: existing.templateVersion,
        title: existing.title,
        body: existing.body,
        enabled: existing.enabled,
        metaJson: existing.metaJson,
      },
      after: {
        eventType: saved.eventType,
        channel: saved.channel,
        templateVersion: saved.templateVersion,
        title: saved.title,
        body: saved.body,
        enabled: saved.enabled,
        metaJson: saved.metaJson,
      },
      meta: { ...(patch.auditMeta ?? {}) },
    });
    return saved;
  });
}

export async function updateOperationalThresholdById(
  id: string,
  patch: UpdateThresholdByIdInput,
): Promise<AdminThresholdRecord> {
  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.operationalThresholdConfig.findUnique({ where: { id } });
    if (!existing) throw new AdminConfigNotFoundError("threshold", id);

    const updated = await tx.operationalThresholdConfig.update({
      where: { id },
      data: {
        ...(patch.numericValue !== undefined ? { numericValue: patch.numericValue } : {}),
        ...(patch.stringValue !== undefined ? { stringValue: patch.stringValue } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      },
    });

    await writeAuditSnapshot(tx, {
      actorUserId: patch.actorUserId,
      action: "admin_config.threshold.update",
      entityType: "operational_threshold_config",
      entityId: updated.id,
      before: {
        key: existing.key,
        numericValue: existing.numericValue?.toString() ?? null,
        stringValue: existing.stringValue,
        unit: existing.unit,
        notes: existing.notes,
        enabled: existing.enabled,
      },
      after: {
        key: updated.key,
        numericValue: updated.numericValue?.toString() ?? null,
        stringValue: updated.stringValue,
        unit: updated.unit,
        notes: updated.notes,
        enabled: updated.enabled,
      },
      meta: { ...(patch.auditMeta ?? {}) },
    });
    return updated;
  });

  return {
    ...saved,
    numericValue: saved.numericValue?.toString() ?? null,
  };
}
