import { parseSnapshotId } from './snapshot-id';

describe('parseSnapshotId', () => {
  it.each([
    ['1', 1n],
    ['9223372036854775807', 9223372036854775807n],
  ])('accepts %s', (raw, expected) => expect(parseSnapshotId(raw)).toBe(expected));

  it.each(['0', '9223372036854775808', '9999999999999999999', '-1', '1.5', 'abc', '', '12345678901234567890'])(
    'rejects %s',
    (raw) => expect(parseSnapshotId(raw)).toBeNull(),
  );
});
