-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "summary_status" AS ENUM ('none', 'pending', 'completed', 'failed');

-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "next_poll_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_polled_at" TIMESTAMPTZ(3),
    "last_snapshot_id" BIGINT,
    "last_content_hash" TEXT,
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshots" (
    "id" BIGSERIAL NOT NULL,
    "competitor_id" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "title" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "previous_snapshot_id" BIGINT,
    "previous_content_hash" TEXT,
    "changed" BOOLEAN NOT NULL,
    "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "summary_status" "summary_status" NOT NULL DEFAULT 'none',
    "summary_error" TEXT,
    "summary_attempts" INTEGER NOT NULL DEFAULT 0,
    "summarized_at" TIMESTAMPTZ(3),
    "llm_model" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "snapshots_timeline_idx" ON "snapshots"("competitor_id", "fetched_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written partial indexes (Prisma's schema language can't express WHERE clauses).
-- NOTE: if a future `prisma migrate dev` proposes dropping these, remove those lines from that migration.

-- Scheduler: "which active competitors are due?" stays an index range scan as the table grows.
CREATE INDEX "competitors_due_idx" ON "competitors"("next_poll_at") WHERE "deleted_at" IS NULL;

-- Summary cache: reuse an earlier summary for the exact same (previous -> current) content transition.
CREATE INDEX "snapshots_summary_cache_idx" ON "snapshots"("previous_content_hash", "content_hash")
  WHERE "summary_status" = 'completed';

-- Reconciler: find summaries stuck in pending (e.g. enqueue lost after commit).
CREATE INDEX "snapshots_pending_idx" ON "snapshots"("created_at") WHERE "summary_status" = 'pending';
