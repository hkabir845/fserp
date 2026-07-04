'use client'

import Link from 'next/link'
import { Brain } from 'lucide-react'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import {
  brainPageHref,
  defaultBrainQuestion,
  type BrainEntityType,
  type BrainLinkContext,
} from '@/lib/brainLinks'

type AskBrainButtonProps = {
  entityType: BrainEntityType
  entityId: number
  entityName?: string
  /** Override auto question; if omitted, uses entity-type default. */
  initialQuestion?: string
  className?: string
  compact?: boolean
}

const LABELS = {
  en: { ask: 'Ask Brain', title: 'Open Company Brain about this entity' },
  bn: { ask: 'ব্রেইনকে জিজ্ঞাসা', title: 'এই বিষয়ে কোম্পানি ব্রেইন খুলুন' },
}

export function AskBrainButton({
  entityType,
  entityId,
  entityName,
  initialQuestion,
  className = '',
  compact = false,
}: AskBrainButtonProps) {
  const { language } = useCompanyLocale()
  const lang = language === 'bn' ? 'bn' : 'en'
  const labels = LABELS[lang]
  const q =
    initialQuestion ??
    defaultBrainQuestion(entityType, lang, entityName)

  const href = brainPageHref({
    entityType,
    entityId,
    entityName,
    initialQuestion: q,
  } satisfies BrainLinkContext)

  return (
    <Link
      href={href}
      title={labels.title}
      className={
        className ||
        `inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100 ${
          compact ? 'px-2 py-1 text-xs' : ''
        }`
      }
    >
      <Brain className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
      {labels.ask}
    </Link>
  )
}
