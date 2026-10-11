import { z } from "zod";
import { writeAuditSnapshot } from "@stay-ops/audit";
import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_TEMPLATES,
  MESSAGE_KINDS,
  MESSAGE_LANGUAGES,
  type MessageKind,
  type MessageLanguage,
  type TemplateOverride,
} from "@/i18n/guestMessages/defaults";
import { readSetting } from "./settings";

export const GUEST_MESSAGES_SETTING_KEY = "guestMessageTemplates";

export const MAX_TEMPLATE_LENGTH = 4000;

const overrideSchema = z
  .object({
    kind: z.enum(MESSAGE_KINDS),
    lang: z.enum(MESSAGE_LANGUAGES),
    /** An apartment's id, or null for "all apartments". */
    roomId: z.string().min(1).nullable(),
    text: z.string().min(1).max(MAX_TEMPLATE_LENGTH),
  })
  .strict();

/** The saved texts. Each kind, language and apartment appears at most once. */
export const guestMessageTemplatesSchema = z
  .object({ templates: z.array(overrideSchema) })
  .strict()
  .refine(
    (config) =>
      new Set(config.templates.map((t) => `${t.kind}|${t.lang}|${t.roomId ?? ""}`)).size === config.templates.length,
    { message: "each text once" },
  );

export type GuestMessageTemplates = z.infer<typeof guestMessageTemplatesSchema>;

/** What the booking panel and Dev mode load: the saved texts and the built-in ones. */
export type GuestMessageTemplatesData = {
  overrides: TemplateOverride[];
  defaults: Record<MessageKind, Record<MessageLanguage, string>>;
};

/** The saved texts, or none when nothing valid is saved (the built-in texts then apply). */
export async function loadGuestMessageOverrides(): Promise<GuestMessageTemplates> {
  const parsed = guestMessageTemplatesSchema.safeParse(await readSetting(GUEST_MESSAGES_SETTING_KEY));
  return parsed.success ? parsed.data : { templates: [] };
}

export async function getGuestMessageTemplates(): Promise<GuestMessageTemplatesData> {
  const { templates } = await loadGuestMessageOverrides();
  return { overrides: templates, defaults: DEFAULT_TEMPLATES };
}

const sameSlot = (a: Omit<TemplateOverride, "text">, b: Omit<TemplateOverride, "text">) =>
  a.kind === b.kind && a.lang === b.lang && a.roomId === b.roomId;

async function writeOverrides(
  before: GuestMessageTemplates,
  after: GuestMessageTemplates,
  actorUserId: string,
  action: "setting.update" | "setting.reset",
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (after.templates.length === 0) {
      await tx.setting.deleteMany({ where: { key: GUEST_MESSAGES_SETTING_KEY } });
    } else {
      await tx.setting.upsert({
        where: { key: GUEST_MESSAGES_SETTING_KEY },
        create: { key: GUEST_MESSAGES_SETTING_KEY, value: after },
        update: { value: after },
      });
    }
    await writeAuditSnapshot(tx, {
      actorUserId,
      entityType: "setting",
      entityId: GUEST_MESSAGES_SETTING_KEY,
      action,
      before,
      after,
    });
  });
}

/** Saves the text for one kind, language and apartment (or all apartments), replacing the earlier one. */
export async function saveGuestMessageTemplate(input: {
  kind: MessageKind;
  lang: MessageLanguage;
  roomId: string | null;
  text: string;
  actorUserId: string;
}): Promise<GuestMessageTemplatesData> {
  const slot = { kind: input.kind, lang: input.lang, roomId: input.roomId };
  const parsed = overrideSchema.safeParse({ ...slot, text: input.text.trim() });
  if (!parsed.success) throw new DomainError("VALIDATION");
  if (input.roomId !== null) {
    const room = await prisma.room.findUnique({ where: { id: input.roomId }, select: { id: true } });
    if (!room) throw new DomainError("NOT_FOUND");
  }
  const before = await loadGuestMessageOverrides();
  const after: GuestMessageTemplates = {
    templates: [...before.templates.filter((t) => !sameSlot(t, slot)), parsed.data],
  };
  await writeOverrides(before, after, input.actorUserId, "setting.update");
  return getGuestMessageTemplates();
}

/** "Επαναφορά προεπιλογής": forget the saved text for one kind, language and apartment. */
export async function resetGuestMessageTemplate(input: {
  kind: MessageKind;
  lang: MessageLanguage;
  roomId: string | null;
  actorUserId: string;
}): Promise<GuestMessageTemplatesData> {
  const before = await loadGuestMessageOverrides();
  const after: GuestMessageTemplates = { templates: before.templates.filter((t) => !sameSlot(t, input)) };
  if (after.templates.length !== before.templates.length) {
    await writeOverrides(before, after, input.actorUserId, "setting.reset");
  }
  return getGuestMessageTemplates();
}
