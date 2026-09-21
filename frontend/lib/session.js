'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, onSessionLost, pingHealth, post } from './api.js';

export const SESSION_KEY = ['session'];

/**
 * Who is signed in. There is no other way to ask: the tokens are httpOnly, so
 * the only session signal available to JavaScript is whether this call works.
 */
export function useSession({ enabled = true } = {}) {
  const query = useQuery({
    queryKey: SESSION_KEY,
    enabled,
    queryFn: async () => {
      try {
        const { user } = await get('/auth/me');
        return user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
  });

  return {
    user: query.data ?? null,
    isLoading: enabled && query.isPending,
    error: query.error,
  };
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials) => post('/auth/login', credentials),
    onSuccess: ({ user }) => queryClient.setQueryData(SESSION_KEY, user),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (details) => post('/auth/register', details),
    onSuccess: ({ user }) => queryClient.setQueryData(SESSION_KEY, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => post('/auth/logout'),
    onSettled: () => {
      // Logout never fails server-side; clear locally either way so a network
      // blip cannot leave a stale name in the header.
      queryClient.clear();
      router.replace('/login');
    },
  });
}

/**
 * Mounted once, at the root. Wakes the host, and turns "the session is gone"
 * — announced by lib/api.js when a refresh fails — into a clean sign-out.
 */
export function SessionEffects() {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    pingHealth();
  }, []);

  useEffect(
    () =>
      onSessionLost(() => {
        queryClient.setQueryData(SESSION_KEY, null);
        queryClient.removeQueries({ queryKey: ['kits'] });
        router.replace('/login');
      }),
    [queryClient, router],
  );

  return null;
}
