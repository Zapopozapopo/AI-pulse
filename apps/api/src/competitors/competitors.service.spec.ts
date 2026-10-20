import { Prisma, type Competitor } from '@prisma/client';
import { ConflictError } from '../common/errors';
import type { CompetitorsRepository } from './competitors.repository';
import { CompetitorsRepository as RealRepository } from './competitors.repository';
import { CompetitorsService } from './competitors.service';

const row = (overrides: Partial<Competitor> = {}) => ({ id: 'acme-crm', deletedAt: null, ...overrides }) as Competitor;

function setup(existing: Competitor | null) {
  const repo = {
    findById: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue(row()),
    restore: jest.fn().mockResolvedValue(true),
    softDelete: jest.fn().mockResolvedValue(true),
    findAllActive: jest.fn(),
  };
  return { service: new CompetitorsService(repo as unknown as CompetitorsRepository), repo };
}

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

describe('CompetitorsService.track', () => {
  it('creates a new competitor', async () => {
    const { service, repo } = setup(null);
    await service.track('acme-crm');
    expect(repo.create).toHaveBeenCalledWith('acme-crm');
    expect(repo.restore).not.toHaveBeenCalled();
  });

  it('restores a soft-deleted competitor (keeping its history)', async () => {
    const { service, repo } = setup(row({ deletedAt: new Date() }));
    await service.track('acme-crm');
    expect(repo.restore).toHaveBeenCalledWith('acme-crm');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects an already tracked competitor with a conflict', async () => {
    const { service, repo } = setup(row());
    await expect(service.track('acme-crm')).rejects.toBeInstanceOf(ConflictError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent create (unique violation) to a conflict', async () => {
    const { service, repo } = setup(null);
    repo.create.mockRejectedValue(uniqueViolation());
    await expect(service.track('acme-crm')).rejects.toBeInstanceOf(ConflictError);
  });

  it('maps a lost restore race to a conflict', async () => {
    const { service, repo } = setup(row({ deletedAt: new Date() }));
    repo.restore.mockResolvedValue(false);
    await expect(service.track('acme-crm')).rejects.toBeInstanceOf(ConflictError);
  });

  it('propagates unexpected database errors', async () => {
    const { service, repo } = setup(null);
    repo.create.mockRejectedValue(new Error('connection lost'));
    await expect(service.track('acme-crm')).rejects.toThrow('connection lost');
  });
});

describe('CompetitorsService.untrack', () => {
  it('is idempotent', async () => {
    const { service, repo } = setup(null);
    repo.softDelete.mockResolvedValue(false);
    await expect(service.untrack('missing')).resolves.toBeUndefined();
  });
});

describe('CompetitorsRepository.isUniqueViolation', () => {
  it('recognizes only P2002', () => {
    expect(RealRepository.isUniqueViolation(uniqueViolation())).toBe(true);
    expect(RealRepository.isUniqueViolation(new Error('x'))).toBe(false);
  });
});
