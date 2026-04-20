import type { Metadata } from 'next';
import { Source_Sans_3 } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { Providers } from '@/components/providers';
import { StatusBar } from '@/components/StatusBar';

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BEX Forge — Enterprise Agentic Platform',
  description: 'BEX — Brendan\'s Extreme eXchange. Build, deploy and operate autonomous domain agents at scale.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isAuthenticated = !!cookies().get('bex_token')?.value;

  return (
    <html lang="en" className={sourceSans.variable} suppressHydrationWarning>
      <body className="bg-[rgb(var(--bg-base))] text-[rgb(var(--text-primary))] antialiased">
        <Providers>
          {isAuthenticated ? (
            <div className="flex h-screen overflow-hidden bg-radial-glow">
              <Sidebar />
              <div className="flex flex-1 flex-col overflow-hidden">
                <StatusBar />
                <main className="flex-1 overflow-y-auto">
                  <div className="px-8 py-6">{children}</div>
                </main>
              </div>
            </div>
          ) : (
            <div className="bg-radial-glow min-h-screen">{children}</div>
          )}
        </Providers>
      </body>
    </html>
  );
}

