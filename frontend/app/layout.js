import './globals.css';
import Providers from './providers';

export const metadata = {
  title: 'PrepKit',
  description: 'Turn a job description and a deadline into a practisable interview prep kit.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
