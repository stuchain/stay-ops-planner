-- Align DB default with schema.prisma `id Int @id @default(1)` for drift checks.
ALTER TABLE "excel_rental_config" ALTER COLUMN "id" SET DEFAULT 1;
