import type { Snapshot } from '@competitor-pulse/contracts';
import { SummaryState } from './SummaryState';

interface Props {
  snapshot: Snapshot;
  onRetry: (snapshotId: string) => void;
  retrying: boolean;
}

export function SnapshotCard({ snapshot, onRetry, retrying }: Props) {
  return (
    <li className="card">
      <time className="muted" dateTime={snapshot.fetchedAt}>
        {new Date(snapshot.fetchedAt).toLocaleString()}
      </time>
      <div>
        <strong>{snapshot.title}</strong> — {snapshot.tagline}
      </div>
      <div>{snapshot.price}</div>
      <div>{snapshot.description}</div>
      <SummaryState snapshot={snapshot} onRetry={() => onRetry(snapshot.id)} retrying={retrying} />
    </li>
  );
}
