export default function AuthLayout({ children }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg-subtle px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-3xl font-semibold leading-tight text-text">PrepKit</p>
          <p className="mt-2 text-[15px] leading-relaxed text-text-muted">
            A job description, a company, and however many days you have left.
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
