import { Link, useParams } from 'react-router-dom';
import { useRetrySummary, useSnapshots } from '../api/hooks';
import { SnapshotCard } from '../components/SnapshotCard';

export function CompetitorTimelinePage() {
  const { id = '' } = useParams();
  const snapshots = useSnapshots(id);
  const retry = useRetrySummary(id);
  const items = snapshots.data?.pages.flatMap((page) => page.items);

  return (
    <>
      <Link to="/" className="button">
        ← Back to competitors
      </Link>
      <h2>{id}</h2>

      {snapshots.isPending && <p className="muted">Loading…</p>}
      {snapshots.error && <p className="error">{snapshots.error.message}</p>}
      {retry.error && <p className="error">Retry failed: {retry.error.message}</p>}
      {items?.length === 0 && <p className="muted">No snapshots yet — the first poll is on its way.</p>}

      <ol className="timeline">
        {items?.map((snapshot) => (
          <SnapshotCard
            key={snapshot.id}
            snapshot={snapshot}
            onRetry={retry.mutate}
            retrying={retry.isPending && retry.variables === snapshot.id}
          />
        ))}
      </ol>

      {snapshots.hasNextPage && (
        <button type="button" onClick={() => snapshots.fetchNextPage()} disabled={snapshots.isFetchingNextPage}>
          {snapshots.isFetchingNextPage ? 'Loading…' : 'Load older snapshots'}
        </button>
      )}
    </>
  );
}
