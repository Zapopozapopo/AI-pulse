import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Without `limit` the endpoint returns the complete history (the API contract: every snapshot,
 * newest first). `limit` + `before` opt into keyset pagination, which the UI uses.
 */
export class ListSnapshotsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  /** Cursor: id of the last snapshot of the previous page (from the X-Next-Cursor header). */
  @IsOptional()
  @IsString()
  before?: string;
}
