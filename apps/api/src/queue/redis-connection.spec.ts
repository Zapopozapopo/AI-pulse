import { redisConnectionFromUrl } from './redis-connection';

describe('redisConnectionFromUrl', () => {
  it('parses a plain local URL', () => {
    expect(redisConnectionFromUrl('redis://localhost:6379')).toEqual({
      host: 'localhost',
      port: 6379,
      username: undefined,
      password: undefined,
      db: 0,
      tls: undefined,
    });
  });

  it('enables TLS for rediss:// and decodes credentials and db', () => {
    expect(redisConnectionFromUrl('rediss://default:p%40ss%2Fw@cache.example.com:6380/2')).toEqual({
      host: 'cache.example.com',
      port: 6380,
      username: 'default',
      password: 'p@ss/w',
      db: 2,
      tls: { servername: 'cache.example.com' },
    });
  });

  it('rejects other schemes', () => {
    expect(() => redisConnectionFromUrl('http://localhost:6379')).toThrow(/redis:\/\/ or rediss:\/\//);
  });
});
