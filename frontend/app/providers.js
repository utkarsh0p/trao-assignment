'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionEffects } from '@/lib/session';
import { ToastProvider } from '@/components/ui/Toast';

export default function Providers({ children }) {
  // One client per browser session, created inside the component so that a
  // server render never shares a cache between two users.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false, // lib/api.js already owns the one retry that matters
            refetchOnWindowFocus: false,
            staleTime: 10_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SessionEffects />
        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
}
