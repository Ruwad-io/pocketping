import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PocketPing Community',
  description: 'Self-hosted live chat widget',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
