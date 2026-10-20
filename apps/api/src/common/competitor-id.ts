import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Slug: lowercase letters, digits and inner dashes, 1-64 chars, e.g. "acme-crm". */
export const COMPETITOR_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const COMPETITOR_ID_MESSAGE = 'id must be a slug: lowercase letters, digits and dashes, e.g. "acme-crm"';

/** Single normalization rule for every place a competitor id enters the system. */
export const normalizeCompetitorId = (value: string): string => value.trim().toLowerCase();

/**
 * Applies the same normalization + validation to `:id` route params as the POST body gets,
 * so "ACME-CRM" means the same competitor on every endpoint.
 */
@Injectable()
export class CompetitorIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const id = normalizeCompetitorId(value);
    if (!COMPETITOR_ID_PATTERN.test(id)) throw new BadRequestException(COMPETITOR_ID_MESSAGE);
    return id;
  }
}
