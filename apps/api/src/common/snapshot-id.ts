import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Postgres BIGINT upper bound: anything larger would make Prisma throw (HTTP 500). */
const MAX_BIGINT = 9_223_372_036_854_775_807n;

export function parseSnapshotId(value: string): bigint | null {
  if (!/^\d{1,19}$/.test(value)) return null;
  const id = BigInt(value);
  return id >= 1n && id <= MAX_BIGINT ? id : null;
}

@Injectable()
export class SnapshotIdPipe implements PipeTransform<string, bigint> {
  transform(value: string): bigint {
    const id = parseSnapshotId(value);
    if (id === null) throw new BadRequestException('snapshot id must be a positive 64-bit integer');
    return id;
  }
}
