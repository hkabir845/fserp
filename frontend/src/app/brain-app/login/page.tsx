'use client'

import { Suspense } from 'react'
import { LoginPageInner } from '@/components/auth/LoginPageInner'

export default function BrainAppLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner variant="brain" />
    </Suspense>
  )
}
