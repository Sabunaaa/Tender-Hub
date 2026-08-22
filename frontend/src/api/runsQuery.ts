import { queryOptions } from '@tanstack/react-query'
import { api } from '../api'

/** Fast enough to watch progress tick along while a scrape is running. */
const ACTIVE_POLL_MS = 2_000
/** Idle pages only need the status badge to notice a run that started elsewhere. */
const IDLE_POLL_MS = 30_000

/** Shared live scrape status query, mounted app-wide by the status badge. */
export const runsQueryOptions = queryOptions({
  queryKey: ['runs'] as const,
  queryFn: () => api.getScrapeHealth(),
  staleTime: 0,
  refetchInterval: (query) => (query.state.data?.activeRun ? ACTIVE_POLL_MS : IDLE_POLL_MS),
  refetchOnWindowFocus: true,
})
