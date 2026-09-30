import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'KEYKARD press assets', robots: { index: false, follow: false } }

export default function PressLayout({ children }: { children: React.ReactNode }) {
  return children
}
