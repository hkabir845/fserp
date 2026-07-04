'use client'

import { Suspense } from 'react'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { BrainChatPanel, brainUiLabels } from '@/components/brain/BrainChatPanel'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { Brain } from 'lucide-react'

function BrainPageInner() {
  const { language } = useCompanyLocale()
  const labels = brainUiLabels(language === 'bn' ? 'bn' : 'en')

  return (
    <PageLayout>
      <ErpPageShell title={labels.title} titleIcon={Brain} description={labels.subtitle}>
        <BrainChatPanel />
      </ErpPageShell>
    </PageLayout>
  )
}

export default function BrainPage() {
  return (
    <Suspense fallback={null}>
      <BrainPageInner />
    </Suspense>
  )
}
