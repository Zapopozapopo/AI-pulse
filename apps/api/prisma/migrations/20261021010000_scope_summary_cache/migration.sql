-- The summary cache is now scoped per competitor (a summary may name the competitor).
DROP INDEX IF EXISTS "snapshots_summary_cache_idx";

CREATE INDEX "snapshots_summary_cache_idx" ON "snapshots"("competitor_id", "previous_content_hash", "content_hash")
  WHERE "summary_status" = 'completed';
