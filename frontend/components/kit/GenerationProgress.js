'use client';

import Link from 'next/link';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Notice from '@/components/ui/Notice';
import ProgressList from '@/components/ui/ProgressList';
import { useToast } from '@/components/ui/Toast';
import { buildProgressRows } from '@/lib/progress';
import { freshIdempotencyKey, useCreateKit } from '@/lib/kits';
import { useRouter } from 'next/navigation';

/** A failed job says what went wrong in words the user can act on. */
const FAILURE_HELP = {
  JOB_STALE: 'The server restarted while this kit was being built. Nothing was lost but the run.',
  CASE_TIMEOUT: 'The run went past its time limit and was stopped.',
  GENERATION_FAILED: 'The model could not produce usable output, even after a repair attempt.',
  INVALID_KIT: 'What came back did not match the kit structure, so it was not saved.',
};

export default function GenerationProgress({ record }) {
  const rows = buildProgressRows(record.progress);
  const failed = record.status === 'failed';
  const router = useRouter();
  const toast = useToast();
  const create = useCreateKit();

  function retry() {
    create.mutate(
      { ...record.input, idempotencyKey: freshIdempotencyKey() },
      {
        onSuccess: (summary) => router.replace(`/kits/${summary.id}`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold leading-tight text-text">
          {failed ? 'This kit could not be built' : 'Building your kit'}
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-text-muted">
          {failed
            ? 'Nothing was saved. You can start the same posting again.'
            : 'This usually takes a minute or two. You can leave the page — it keeps going without you.'}
        </p>
      </div>

      {failed && record.error ? (
        <Notice
          tone="danger"
          title={record.error.message}
          action={
            <div className="flex gap-2">
              <Button variant="primary" onClick={retry} loading={create.isPending}>
                Try again
              </Button>
              <Button as={Link} href="/kits" variant="ghost">
                Back to your kits
              </Button>
            </div>
          }
        >
          {FAILURE_HELP[record.error.code] || null}
        </Notice>
      ) : null}

      <Card>
        <ProgressList rows={rows} />
      </Card>

      <p className="text-xs text-text-muted">
        A step marked skipped is an honest outcome, not a failure — a company that publishes nothing
        about how it hires simply has nothing to read.
      </p>
    </div>
  );
}
