'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, post } from './api.js';

export const ACTIVE_STATUSES = ['queued', 'running', 'regenerating'];
export const isActive = (status) => ACTIVE_STATUSES.includes(status);

/** STACK.md's reasoning: a kit takes ~90s, so two seconds is ~45 requests. */
const POLL_MS = 2000;

export const kitsKey = ['kits'];
export const kitKey = (id) => ['kits', id];

export function useKits() {
  return useQuery({
    queryKey: kitsKey,
    queryFn: async () => (await get('/kits')).kits,
  });
}

export function useKit(id) {
  return useQuery({
    queryKey: kitKey(id),
    queryFn: () => get(`/kits/${id}`),
    enabled: Boolean(id),
    // Poll only while there is something to watch, and stop the moment there
    // is not. A ready kit is refetched on demand by the edit mutations.
    refetchInterval: (query) => (isActive(query.state.data?.status) ? POLL_MS : false),
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

export function useCreateKit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jd, company_url, days, idempotencyKey }) =>
      post(
        '/kits',
        { jd, company_url, days },
        idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: kitsKey }),
  });
}

export function useDeleteKit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => del(`/kits/${id}`),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: kitKey(id) });
      queryClient.invalidateQueries({ queryKey: kitsKey });
    },
  });
}

/**
 * A fresh key for a deliberate re-run. The server derives its idempotency key
 * from the posting itself, so retrying a failed kit without one would just
 * hand back the failed job.
 */
export function freshIdempotencyKey() {
  return `retry-${crypto.randomUUID()}`;
}
