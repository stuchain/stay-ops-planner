-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "SchemaBootstrap" (
    "id" TEXT NOT NULL,

    CONSTRAINT "SchemaBootstrap_pkey" PRIMARY KEY ("id")
);
