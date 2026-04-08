CREATE TABLE "integration_secrets" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "secret_key" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_secrets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_secrets_provider_secret_key_key"
ON "integration_secrets"("provider", "secret_key");
