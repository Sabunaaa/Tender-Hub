import { api } from '../api'

/** Shared live scrape status query — polls every 2s so progress updates without a manual refresh. */
export const runsQueryOptions = {
  queryKey: ['runs'] as const,
  queryFn: () => api.getScrapeHealth(),
  staleTime: 0,
  refetchInterval: 2_000,
  refetchOnWindowFocus: true,
}
