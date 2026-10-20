import type { CreateCompetitorRequest } from '@competitor-pulse/contracts';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { COMPETITOR_ID_MESSAGE, COMPETITOR_ID_PATTERN, normalizeCompetitorId } from '../../common/competitor-id';

export class CreateCompetitorDto implements CreateCompetitorRequest {
  @Transform(({ value }) => (typeof value === 'string' ? normalizeCompetitorId(value) : value))
  @IsString()
  @Matches(COMPETITOR_ID_PATTERN, { message: COMPETITOR_ID_MESSAGE })
  id: string;
}
