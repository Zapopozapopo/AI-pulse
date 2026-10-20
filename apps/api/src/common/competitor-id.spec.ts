import { BadRequestException } from '@nestjs/common';
import { CompetitorIdPipe } from './competitor-id';

describe('CompetitorIdPipe', () => {
  const pipe = new CompetitorIdPipe();

  it('normalizes route ids the same way as the POST body', () => {
    expect(pipe.transform(' ACME-CRM ')).toBe('acme-crm');
  });

  it.each(['Bad Id!', '-acme', 'acme-', '', 'a'.repeat(65)])('rejects %p', (id) => {
    expect(() => pipe.transform(id)).toThrow(BadRequestException);
  });
});
