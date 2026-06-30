'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LayoutGrid, Layers, Search } from 'lucide-react'
import PageLayout from '@/components/PageLayout'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import { AQ_HERO_BTN_GHOST, AQ_HERO_BTN_PRIMARY, PipelineStatCard } from '@/components/aquaculture/AquacultureUi'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useErpNavigationMenu } from '@/hooks/useErpNavigationMenu'
import { aquacultureT } from '@/lib/aquacultureI18n'
import { useT } from '@/lib/i18n'
import type { ErpAppSection } from '@/navigation/erpAppMenu'

/**
 * App launcher — Aquaculture-style hero, stats, and section cards.
 * Same visibility rules as the sidebar (shared hook).
 */
export default function AppsPage() {
  const router = useRouter()
  const pageMeta = usePageMeta()
  const { lang } = useT()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSection, setFilterSection] = useState<'all' | ErpAppSection>('all')

  const { navReady, menuItemsForNav: visibleApps, sectionsForNav: sections } = useErpNavigationMenu({
    excludeHrefs: ['/apps'],
    searchQuery,
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('access_token')
    if (!token?.trim()) {
      router.replace('/login')
    }
  }, [router])

  const displayedSections = useMemo(() => {
    if (filterSection === 'all') return sections
    return sections.filter((s) => s.id === filterSection)
  }, [sections, filterSection])

  const appsInView = useMemo(() => {
    if (filterSection === 'all') return visibleApps
    return visibleApps.filter((a) => a.section === filterSection)
  }, [visibleApps, filterSection])

  const sectionPills = useMemo(
    () => [{ id: 'all' as const, label: aquacultureT('appsAllSections', lang) }, ...sections],
    [sections, lang],
  )

  return (
    <PageLayout>
      <AquaculturePageShell
            showBackLink={false}
            titleId="apps-title"
            eyebrow={pageMeta.eyebrow}
            eyebrowIcon={LayoutGrid}
            title={pageMeta.title}
            titleIcon={LayoutGrid}
            description={pageMeta.description ?? undefined}
            maxWidthClass="max-w-[1400px]"
            contentClassName="mt-4 space-y-4"
            actions={
              <>
                <div className="relative w-full sm:w-52 lg:w-60">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-100/70"
                    aria-hidden
                  />
                  <input
                    type="search"
                    placeholder={aquacultureT('appsSearchPlaceholder', lang)}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-lg border border-white/20 bg-white/10 py-1.5 pl-8 pr-3 text-sm text-white placeholder:text-teal-100/60 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                    aria-label={aquacultureT('appsSearchPlaceholder', lang)}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sectionPills.map((pill) => (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={() => setFilterSection(pill.id)}
                      className={
                        filterSection === pill.id ? AQ_HERO_BTN_PRIMARY : AQ_HERO_BTN_GHOST
                      }
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>
              </>
            }
            stats={
              navReady ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <PipelineStatCard
                    title={aquacultureT('appsTotalApps', lang)}
                    value={visibleApps.length}
                    sub={aquacultureT('apps', lang)}
                    icon={LayoutGrid}
                    tone="emerald"
                  />
                  <PipelineStatCard
                    title={aquacultureT('appsSections', lang)}
                    value={sections.length}
                    sub={aquacultureT('appsAllSections', lang)}
                    icon={Layers}
                    tone="sky"
                  />
                  <PipelineStatCard
                    title={aquacultureT('appsInView', lang)}
                    value={appsInView.length}
                    sub={
                      filterSection === 'all'
                        ? aquacultureT('appsAllSections', lang)
                        : sections.find((s) => s.id === filterSection)?.label ?? '—'
                    }
                    icon={LayoutGrid}
                    tone="slate"
                  />
                </div>
              ) : null
            }
          >
            {!navReady ? (
              <div
                className="flex items-center justify-center gap-3 rounded-2xl border border-border/80 bg-white py-16 text-sm text-muted-foreground shadow-sm"
                aria-busy="true"
              >
                <div
                  className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary"
                  aria-hidden
                />
                {aquacultureT('appsLoading', lang)}
              </div>
            ) : null}

            {navReady && appsInView.length === 0 ? (
              <div className="rounded-2xl border border-border/80 bg-white p-8 text-center text-sm text-muted-foreground shadow-sm">
                {aquacultureT('appsNoMatch', lang)}
              </div>
            ) : null}

            {navReady
              ? displayedSections.map((section) => {
                  const items = visibleApps.filter((a) => a.section === section.id)
                  if (items.length === 0) return null
                  return (
                    <section
                      key={section.id}
                      className="erp-panel"
                      aria-labelledby={`apps-section-${section.id}`}
                    >
                      <h2
                        id={`apps-section-${section.id}`}
                        className="text-sm font-semibold tracking-tight text-foreground"
                      >
                        {section.label}
                      </h2>
                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
                        {items.map((item) => {
                          const Icon = item.icon
                          return (
                            <Link
                              key={`${item.href}-${item.label}`}
                              href={item.href}
                              className="group erp-quick-app-tile"
                            >
                              <div
                                className={`mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ${item.tileClass} transition group-hover:opacity-90 sm:h-16 sm:w-16`}
                              >
                                <Icon className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={1.75} aria-hidden />
                              </div>
                              <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground/85 sm:text-base">
                                {item.label}
                              </span>
                            </Link>
                          )
                        })}
                      </div>
                    </section>
                  )
                })
              : null}
          </AquaculturePageShell>
    </PageLayout>
  )
}
