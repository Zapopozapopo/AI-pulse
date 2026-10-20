import type { Snapshot } from '@competitor-pulse/contracts';

interface Props {
  snapshot: Snapshot;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Every summary state the backend can report gets an explicit, distinct rendering. */
export function SummaryState({ snapshot, onRetry, retrying }: Props) {
  if (!snapshot.changed) {
    // The first snapshot has nothing to compare with; per the spec it is shown as "no change".
    return (
      <p className="muted">
        {snapshot.isBaseline
          ? 'No change — first snapshot, the baseline for future comparisons.'
          : 'No change since previous snapshot.'}
      </p>
    );
  }

  switch (snapshot.summaryStatus) {
    case 'completed':
      return <p className="summary">{snapshot.summary}</p>;
    case 'failed':
      return (
        <p className="warning">
          Changed ({snapshot.changedFields.join(', ')}), but the AI summary failed.{' '}
          {onRetry && (
            <button type="button" onClick={onRetry} disabled={retrying}>
              {retrying ? 'Retrying…' : 'Retry summary'}
            </button>
          )}
        </p>
      );
    default:
      return <p className="muted">Changed ({snapshot.changedFields.join(', ')}) — generating AI summary…</p>;
  }
}
