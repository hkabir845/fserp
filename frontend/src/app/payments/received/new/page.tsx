'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { usePageMeta } from '@/hooks/usePageMeta'
import { Wallet } from 'lucide-react'
import { PaymentReceivedForm } from '@/components/payments/PaymentReceivedForm'

function RecordPaymentReceivedInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pageMeta = usePageMeta()

  const rawCustomerId = searchParams.get('customer_id')
  const initialCustomerId = rawCustomerId != null && Number.isFinite(Number(rawCustomerId))
    ? Number(rawCustomerId)
    : null

  return (
    <PageLayout>
      <div className="app-scroll-pad">
        <ErpPageShell
          flush
          showBackLink
          backHref="/payments/received"
          backLabel={pageMeta.eyebrow}
          title={pageMeta.title}
          titleIcon={Wallet}
          eyebrow={pageMeta.eyebrow}
          description={pageMeta.description}
          maxWidthClass="max-w-[1600px]"
          contentClassName="mt-4"
        >
          <PaymentReceivedForm
            initialCustomerId={initialCustomerId}
            onSuccess={() => router.push('/payments/received')}
          />
        </ErpPageShell>
      </div>
    </PageLayout>
  )
}

export default function NewPaymentReceivedPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center bg-muted/40">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      }
    >
      <RecordPaymentReceivedInner />
    </Suspense>
  )
}
