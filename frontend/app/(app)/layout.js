'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Button from '@/components/ui/Button';
import { SkeletonList } from '@/components/ui/Skeleton';
import Notice from '@/components/ui/Notice';
import { useLogout, useSession } from '@/lib/session';

/**
 * Everything under here needs a session. While we are finding out, the page
 * shows the shape of what is coming rather than a spinner.
 */
export default function AppLayout({ children }) {
  const { user, isLoading, error } = useSession();
  const router = useRouter();
  const logout = useLogout();

  useEffect(() => {
    if (!isLoading && !error && !user) router.replace('/login');
  }, [isLoading, error, user, router]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 md:px-10">
          <Link href="/kits" className="rounded-lg text-base font-semibold text-text">
            PrepKit
          </Link>

          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="hidden text-xs text-text-muted sm:inline">
                  {user.name || user.email}
                </span>
                <Button size="sm" variant="ghost" onClick={() => logout.mutate()}>
                  Sign out
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 md:px-10">
        {error ? (
          <Notice tone="danger" title="Could not check your session">
            {error.message}
          </Notice>
        ) : isLoading || !user ? (
          <SkeletonList count={3} />
        ) : (
          children
        )}
      </main>
    </div>
  );
}
