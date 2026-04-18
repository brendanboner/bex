import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { Providers } from '@/components/providers';
import { StatusBar } from '@/components/StatusBar';

export const metadata: Metadata = {
  title: 'Forge — Enterprise Agentic Platform',
  description: 'Autonomously build, deploy and operate domain agents at scale',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-[rgb(var(--bg-base))] text-[rgb(var(--text-primary))] antialiased">
        <Providers>
          <div className="flex h-screen overflow-hidden bg-radial-glow">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <StatusBar />
              <main className="flex-1 overflow-y-auto">
                <div className="px-8 py-6">{children}</div>
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}

