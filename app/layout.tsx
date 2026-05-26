import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'BidPilot AI',
  description: 'AI-помічник для фрілансерів. Генерація заявок, моніторинг проєктів, автоматична ціна та терміни.',
  generator: 'BidPilot AI',
  applicationName: 'BidPilot AI',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0A0A0F',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="uk" className={`bg-background ${inter.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground overflow-hidden h-dvh">
        {children}
        {/* Telegram Mini App SDK — loaded after React hydrates to prevent mismatch */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </body>
    </html>
  )
}
