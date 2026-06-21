'use client'

import { useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { pageMetaForPath, type LocalizedPageMeta } from '@/lib/pageMetaI18n'

export function usePageMeta(pathnameOverride?: string): LocalizedPageMeta {
  const pathname = usePathname()
  const { language } = useCompanyLocale()
  const path = pathnameOverride ?? pathname ?? '/'
  return useMemo(() => pageMetaForPath(path, language), [path, language])
}
