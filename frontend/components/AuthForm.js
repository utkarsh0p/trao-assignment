'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Notice from '@/components/ui/Notice';
import { Input } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { useLogin, useRegister, useSession } from '@/lib/session';

/**
 * Register and log in are the same form with one extra field, so they are the
 * same component. Field-level errors come from the server's `detail[]`; the
 * headline error is its `message`, never a stack trace.
 */
export default function AuthForm({ mode }) {
  const isRegister = mode === 'register';
  const router = useRouter();
  // Read-only: asking the server who we are from the login page would spend
  // two of the thirty auth requests a quarter-hour allows, on a question the
  // visitor has already answered by being here.
  const { user } = useSession({ enabled: false });
  const [values, setValues] = useState({ email: '', password: '', name: '' });

  // Both hooks run unconditionally so the hook order never depends on `mode`.
  const register = useRegister();
  const login = useLogin();
  const mutation = isRegister ? register : login;

  useEffect(() => {
    if (user) router.replace('/kits');
  }, [user, router]);

  const error = mutation.error instanceof ApiError ? mutation.error : null;

  function submit(event) {
    event.preventDefault();
    const payload = isRegister
      ? { email: values.email, password: values.password, name: values.name || undefined }
      : { email: values.email, password: values.password };

    mutation.mutate(payload, { onSuccess: () => router.replace('/kits') });
  }

  function set(field) {
    return (event) => setValues((current) => ({ ...current, [field]: event.target.value }));
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold leading-snug text-text">
        {isRegister ? 'Create an account' : 'Sign in'}
      </h1>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        {error && !error.detail.length ? <Notice tone="danger">{error.message}</Notice> : null}

        {isRegister ? (
          <Input
            label="Name"
            autoComplete="name"
            maxLength={80}
            value={values.name}
            onChange={set('name')}
            error={error?.fieldError('name')}
            hint="Optional."
          />
        ) : null}

        <Input
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          value={values.email}
          onChange={set('email')}
          error={error?.fieldError('email')}
        />

        <Input
          label="Password"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          required
          minLength={isRegister ? 8 : undefined}
          maxLength={200}
          value={values.password}
          onChange={set('password')}
          error={error?.fieldError('password')}
          hint={isRegister ? 'At least eight characters.' : undefined}
        />

        <Button type="submit" variant="primary" loading={mutation.isPending} className="mt-2">
          {isRegister ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-text-muted">
        {isRegister ? 'Already have an account? ' : 'No account yet? '}
        <Link
          href={isRegister ? '/login' : '/register'}
          className="font-medium text-accent hover:text-accent-hover"
        >
          {isRegister ? 'Sign in' : 'Create one'}
        </Link>
      </p>
    </Card>
  );
}
