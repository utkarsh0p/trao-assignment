'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Notice from '@/components/ui/Notice';
import { Input, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api';
import { useCreateKit } from '@/lib/kits';

// The server's own limits, mirrored so the user is told before the round trip.
const JD_MAX = 60_000;
const DAYS_MAX = 365;

export default function NewKitPage() {
  const router = useRouter();
  const toast = useToast();
  const create = useCreateKit();

  const [jd, setJd] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [days, setDays] = useState('7');
  const [local, setLocal] = useState({});

  const serverError = create.error instanceof ApiError ? create.error : null;

  function validate() {
    const issues = {};
    if (!jd.trim()) issues.jd = 'Paste the job description.';
    else if (jd.length > JD_MAX) issues.jd = `That is longer than ${JD_MAX.toLocaleString()} characters.`;

    if (!companyUrl.trim()) issues.company_url = 'Give the company website.';
    else {
      try {
        const parsed = new URL(companyUrl);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error('scheme');
      } catch {
        issues.company_url = 'Include the full URL, starting with https://';
      }
    }

    const parsedDays = Number(days);
    if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > DAYS_MAX) {
      issues.days = `A whole number of days, 1 to ${DAYS_MAX}.`;
    }

    return issues;
  }

  function submit(event) {
    event.preventDefault();
    const issues = validate();
    setLocal(issues);
    if (Object.keys(issues).length > 0) return;

    create.mutate(
      { jd: jd.trim(), company_url: companyUrl.trim(), days: Number(days) },
      {
        onSuccess: (summary) => {
          if (summary.duplicate) {
            toast.success('You already have a kit for this posting — opening it.');
          }
          router.push(`/kits/${summary.id}`);
        },
      },
    );
  }

  const errorFor = (field) => local[field] || serverError?.fieldError(field);
  const overLimit = jd.length > JD_MAX;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold leading-tight text-text">New kit</h1>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-text-muted">
          Paste the posting and give the company&rsquo;s website. What cannot be found is recorded
          as a gap rather than guessed at, so a thin posting makes a kit that says it is thin.
        </p>
      </div>

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          {serverError && !serverError.detail.length ? (
            <Notice tone="danger" title="Could not start the kit">
              {serverError.message}
            </Notice>
          ) : null}

          <div>
            <Textarea
              label="Job description"
              rows={12}
              value={jd}
              onChange={(event) => setJd(event.target.value)}
              placeholder="Paste the whole posting — responsibilities, requirements, the lot."
              error={errorFor('jd')}
            />
            <p
              className={`mt-1.5 text-right text-xs ${overLimit ? 'font-medium text-danger' : 'text-text-faint'}`}
            >
              {jd.length.toLocaleString()} / {JD_MAX.toLocaleString()}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-[1fr_10rem]">
            <Input
              label="Company website"
              type="url"
              inputMode="url"
              placeholder="https://example.com"
              value={companyUrl}
              onChange={(event) => setCompanyUrl(event.target.value)}
              error={errorFor('company_url')}
              hint="We read what they publish about themselves and about interviewing."
            />
            <Input
              label="Days until the interview"
              type="number"
              min={1}
              max={DAYS_MAX}
              step={1}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              error={errorFor('days')}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={create.isPending}>
              Build the kit
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
