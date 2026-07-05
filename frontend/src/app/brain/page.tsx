'use client'

import { Suspense, useState } from 'react'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { BrainChatPanel, brainUiLabels } from '@/components/brain/BrainChatPanel'
import { BrainInsightsPanel } from '@/components/brain/BrainInsightsPanel'
import { BrainKnowledgePanel } from '@/components/brain/BrainKnowledgePanel'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { Brain } from 'lucide-react'

function BrainPageInner() {
  const { language } = useCompanyLocale()
  const labels = brainUiLabels(language === 'bn' ? 'bn' : 'en')
  const [queuedQuestion, setQueuedQuestion] = useState<string | null>(null)

  return (
    <PageLayout>
      <ErpPageShell title={labels.title} titleIcon={Brain} description={labels.subtitle}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="space-y-4">
            <BrainInsightsPanel
              language={language === 'bn' ? 'bn' : 'en'}
              onAsk={(q) => setQueuedQuestion(q)}
            />
            <BrainKnowledgePanel
              language={language === 'bn' ? 'bn' : 'en'}
              onAsk={(q) => setQueuedQuestion(q)}
            />
          </div>
          <BrainChatPanel
            queuedQuestion={queuedQuestion}
            onQueuedQuestionHandled={() => setQueuedQuestion(null)}
          />
        </div>
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
