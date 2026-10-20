import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from './client';

/** Polling keeps the views live while the backend fetches snapshots and summaries in the background. */
const REFRESH_MS = 5000;
const PAGE_SIZE = 50;

const keys = {
  competitors: ['competitors'] as const,
  snapshots: (id: string) => ['competitors', id, 'snapshots'] as const,
};

/** Stop polling once a query is in a client-error state (e.g. 404 for a removed competitor). */
const refetchUnlessClientError = (error: Error | null) =>
  error instanceof ApiRequestError && error.status < 500 ? false : REFRESH_MS;

export const useCompetitors = () =>
  useQuery({ queryKey: keys.competitors, queryFn: api.listCompetitors, refetchInterval: REFRESH_MS });

/** Newest-first timeline, one page at a time; refetching re-derives every loaded page's cursor. */
export const useSnapshots = (id: string) =>
  useInfiniteQuery({
    queryKey: keys.snapshots(id),
    queryFn: ({ pageParam }) => api.listSnapshotsPage(id, PAGE_SIZE, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: (query) => refetchUnlessClientError(query.state.error),
  });

export function useTrackCompetitor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.trackCompetitor({ id }),
    // exact: don't also refetch every cached timeline (they share the ['competitors'] prefix).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.competitors, exact: true }),
  });
}

export function useRemoveCompetitor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.removeCompetitor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.competitors, exact: true }),
  });
}

export function useRetrySummary(competitorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.retrySummary,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.snapshots(competitorId) }),
  });
}
