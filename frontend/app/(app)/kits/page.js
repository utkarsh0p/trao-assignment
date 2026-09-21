'use client';

import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Notice from '@/components/ui/Notice';
import { SkeletonList } from '@/components/ui/Skeleton';
import { AlertIcon, DocumentIcon } from '@/components/ui/icons';
import { useKits } from '@/lib/kits';

function relativeDate(iso) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString();
}

function KitRow({ kit }) {
  const title = kit.role || 'Untitled role';
  const company = kit.company || new URL(kit.company_url).hostname;

  return (
    <Card as="li" interactive className="p-0 md:p-0">
      <Link href={`/kits/${kit.id}`} className="flex flex-col gap-3 rounded-xl p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-text">{title}</p>
            <p className="mt-0.5 truncate text-xs text-text-muted">{company}</p>
          </div>
          <Badge status={kit.status} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
          <span>{kit.days === 1 ? '1 day' : `${kit.days} days`} to prepare</span>
          {kit.status === 'ready' ? (
            <span>{kit.questions === 1 ? '1 question' : `${kit.questions} questions`}</span>
          ) : null}
          {kit.uncovered > 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-danger">
              <AlertIcon className="h-3 w-3" />
              {kit.uncovered} uncovered
            </span>
          ) : null}
          <span className="text-text-faint">{relativeDate(kit.created_at)}</span>
        </div>

        {kit.status === 'failed' && kit.error ? (
          <p className="text-xs text-danger">{kit.error.message}</p>
        ) : null}
      </Link>
    </Card>
  );
}

export default function KitsPage() {
  const { data: kits, isPending, error } = useKits();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold leading-tight text-text">Your kits</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-text-muted">
            One per posting you are preparing for.
          </p>
        </div>
        <Button as={Link} href="/kits/new" variant="primary">
          New kit
        </Button>
      </div>

      {error ? (
        <Notice tone="danger" title="Could not load your kits">
          {error.message}
        </Notice>
      ) : isPending ? (
        <SkeletonList count={3} />
      ) : kits.length === 0 ? (
        <EmptyState
          icon={DocumentIcon}
          title="No kits yet"
          description="Paste a job description to build your first one."
          action={
            <Button as={Link} href="/kits/new" variant="primary">
              Build a kit
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {kits.map((kit) => (
            <KitRow key={kit.id} kit={kit} />
          ))}
        </ul>
      )}
    </div>
  );
}
