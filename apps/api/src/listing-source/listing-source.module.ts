import { Module } from '@nestjs/common';
import { HttpListingSourceClient } from './http-listing-source.client';
import { LISTING_SOURCE } from './listing-source.client';

@Module({
  providers: [{ provide: LISTING_SOURCE, useClass: HttpListingSourceClient }],
  exports: [LISTING_SOURCE],
})
export class ListingSourceModule {}
