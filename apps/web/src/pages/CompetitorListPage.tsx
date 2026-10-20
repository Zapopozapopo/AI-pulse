import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCompetitors, useRemoveCompetitor, useTrackCompetitor } from '../api/hooks';

export function CompetitorListPage() {
  const [id, setId] = useState('');
  const competitors = useCompetitors();
  const track = useTrackCompetitor();
  const remove = useRemoveCompetitor();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = id.trim();
    if (!value) return;
    track.mutate(value, { onSuccess: () => setId('') });
  };

  return (
    <>
      <form className="row" onSubmit={onSubmit}>
        <input
          aria-label="Competitor id"
          placeholder="competitor id, e.g. acme-crm"
          value={id}
          onChange={(event) => {
            setId(event.target.value);
            if (track.error) track.reset();
          }}
        />
        <button type="submit" disabled={track.isPending}>
          Track
        </button>
      </form>
      {track.error && <p className="error">{track.error.message}</p>}
      {remove.error && <p className="error">{remove.error.message}</p>}

      {competitors.isPending && <p className="muted">Loading…</p>}
      {competitors.error && <p className="error">Could not load competitors: {competitors.error.message}</p>}
      {competitors.data?.length === 0 && <p className="muted">No competitors tracked yet.</p>}

      <ul className="list">
        {competitors.data?.map((competitor) => (
          <li key={competitor.id} className="row list-item">
            <div>
              <Link to={`/competitors/${encodeURIComponent(competitor.id)}`}>{competitor.id}</Link>
              {competitor.lastError && <div className="error small">Last poll failed: {competitor.lastError}</div>}
            </div>
            <button
              type="button"
              onClick={() => remove.mutate(competitor.id)}
              disabled={remove.isPending && remove.variables === competitor.id}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
