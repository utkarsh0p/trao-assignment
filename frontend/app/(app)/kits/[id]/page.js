'use client';

import { use } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonCard, SkeletonList } from '@/components/ui/Skeleton';
import { DocumentIcon } from '@/components/ui/icons';
import GenerationProgress from '@/components/kit/GenerationProgress';
import KitBuilder from '@/components/kit/KitBuilder';
import { useKit } from '@/lib/kits';

export default function KitPage({ params }) {
  const { id } = use(params);
  const { data: record, isPending, error } = useKit(id);

  if (isPending) {
    return (
      <div className="flex flex-col gap-8">
        <SkeletonCard />
        <SkeletonList count={2} />
      </div>
    );
  }

  if (error) {
    // The API answers 404 rather than 403 for someone else's kit, so "not
    // found" is the only thing we can honestly say.
    const notFound = error.status === 404;
    return (
      <EmptyState
        icon={DocumentIcon}
        title={notFound ? 'No such kit' : 'Could not load this kit'}
        description={notFound ? 'It may have been deleted.' : error.message}
        action={
          <Button as={Link} href="/kits" variant="secondary">
            Back to your kits
          </Button>
        }
      />
    );
  }

  // A kit that has never produced output shows the run, not an empty shell.
  if (!record.kit) return <GenerationProgress record={record} />;

  return <KitBuilder record={record} />;
}
