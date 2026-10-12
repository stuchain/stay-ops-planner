-- Statistics page: review pages and the score they showed over time (additive only).
CREATE TYPE "ReviewPlatform" AS ENUM ('airbnb', 'booking', 'google');

CREATE TABLE "review_sources" (
    "id" TEXT NOT NULL,
    "platform" "ReviewPlatform" NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "room_id" TEXT,
    "google_place_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "review_snapshots" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "taken_on" DATE NOT NULL,
    "rating_hundredths" INTEGER,
    "review_count" INTEGER,
    "origin" TEXT NOT NULL,
    "latest_reviews" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "review_snapshots_source_id_taken_on_key" ON "review_snapshots"("source_id", "taken_on");

ALTER TABLE "review_sources" ADD CONSTRAINT "review_sources_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "review_snapshots" ADD CONSTRAINT "review_snapshots_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "review_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
