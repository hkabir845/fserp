import type { ReactNode } from 'react'
import { PayrollNav } from './PayrollNav'

export default function PayrollLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <PayrollNav />
      {children}
    </div>
  )
}
