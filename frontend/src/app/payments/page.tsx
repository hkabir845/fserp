'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { usePageMeta } from '@/hooks/usePageMeta'
import {
  ArrowRight,
  Banknote,
  BookOpen,
  CreditCard,
  Landmark,
  ListTree,
  Pencil,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react'

type HubCard = {
  href: string
  title: string
  subtitle: string
  description: string
  icon: ReactNode
  accent: string
  footer: string
  cta: string
}

const cards: HubCard[] = [
  {
    href: '/payments/received',
    title: 'Payments received',
    subtitle: 'Accounts receivable',
    description:
      'Record customer receipts, apply to invoices, and see undeposited status. Each row supports edit and delete with full GL rollback (AUTO-PAY reversal) where allowed.',
    icon: <Banknote className="h-8 w-8 text-emerald-600" aria-hidden />,
    accent: 'border-emerald-200 hover:border-emerald-300 hover:shadow-emerald-100/50',
    footer: 'Row actions: Pencil · Trash — transactional rollback',
    cta: 'Open AR payments',
  },
  {
    href: '/payments/made',
    title: 'Payments made',
    subtitle: 'Accounts payable',
    description:
      'Pay vendors against bills. Edit or delete from the list: the system removes the disbursement journal and restores vendor A/P, then recomputes bill status in one transaction.',
    icon: <CreditCard className="h-8 w-8 text-primary" aria-hidden />,
    accent: 'border-primary/25 hover:border-blue-300 hover:shadow-blue-100/50',
    footer: 'Row actions: Pencil · Trash — same rollback rules',
    cta: 'Open AP payments',
  },
  {
    href: '/payments/deposits',
    title: 'Record deposits',
    subtitle: 'Clearing → bank',
    description:
      'Batch undeposited receipts into a bank register with posted GL (Dr bank, Cr clearing). Receipts on a deposit are locked from edit/delete until the deposit is adjusted.',
    icon: <TrendingUp className="h-8 w-8 text-violet-600" aria-hidden />,
    accent: 'border-violet-200 hover:border-violet-300 hover:shadow-violet-100/50',
    footer: 'Protects GL integrity after funds are batched to the bank',
    cta: 'Open deposits',
  },
  {
    href: '/payments/all',
    title: 'Payment register',
    subtitle: 'AR + AP in one view',
    description:
      'Combined cash receipt and disbursement register with filters, expandable detail, and the same edit/delete workflow and rollback messaging as the other payment screens.',
    icon: <ListTree className="h-8 w-8 text-muted-foreground" aria-hidden />,
    accent: 'border-border hover:border-border',
    footer: 'Primary workspace for cross-checking all payment types',
    cta: 'Open register',
  },
]

export default function PaymentsPage() {
  const router = useRouter()
  const pageMeta = usePageMeta()

  return (
    <PageLayout>
      <ErpPageShell
        showBackLink={false}
        titleId="payments-title"
        eyebrow={pageMeta.eyebrow}
        title={pageMeta.title}
        titleIcon={Wallet}
        description={pageMeta.description}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
      >
        <div className="mb-8 rounded-xl border border-border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
              <ShieldCheck className="h-6 w-6" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-3 text-sm text-muted-foreground">
              <h2 className="text-base font-semibold text-foreground">Rollback &amp; edit policy (all modules)</h2>
              <ul className="list-inside list-disc space-y-1 text-foreground/85">
                <li>
                  <strong className="font-medium text-foreground">Delete</strong> removes the posted{' '}
                  <code className="rounded bg-muted px-1 text-xs">AUTO-PAY-…</code> journal,
                  restores customer AR or vendor A/P subledgers, and recomputes invoice/bill status —
                  <strong className="font-medium text-foreground"> all in one database transaction</strong>.
                </li>
                <li>
                  <strong className="font-medium text-foreground">Edit</strong> reverses the old journal,
                  updates the payment, then re-posts; failure rolls back entirely.
                </li>
                <li>
                  <strong className="font-medium text-foreground">Deposited receipts</strong> (on a bank
                  deposit batch) show a lock: adjust the deposit first — same rule on Received, Made,
                  and the register.
                </li>
              </ul>
              <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  Edit
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Delete
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                  <Landmark className="h-3.5 w-3.5" aria-hidden />
                  Deposit lock
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" aria-hidden />
          <p>
            Use <strong className="font-medium">Payments received</strong> or{' '}
            <strong className="font-medium">Payments made</strong> for day-to-day entry; use{' '}
            <strong className="font-medium">Payment register</strong> when you need one grid with filters
            and the same pencil/trash controls.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {cards.map((card) => (
            <div
              key={card.href}
              role="button"
              tabIndex={0}
              onClick={() => router.push(card.href)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  router.push(card.href)
                }
              }}
              className={`group flex cursor-pointer flex-col rounded-xl border bg-white p-6 shadow-sm transition hover:shadow-md ${card.accent}`}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-muted/40 p-3 ring-1 ring-slate-100">{card.icon}</div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{card.title}</h2>
                    <p className="text-sm text-muted-foreground">{card.subtitle}</p>
                  </div>
                </div>
                <ArrowRight className="h-6 w-6 shrink-0 text-muted-foreground/70 transition group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
              </div>
              <p className="mb-4 flex-1 text-sm leading-relaxed text-muted-foreground">{card.description}</p>
              <div className="border-t border-border/70 pt-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {card.footer}
                </p>
                <Link
                  href={card.href}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary"
                >
                  {card.cta}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </ErpPageShell>
    </PageLayout>
  )
}
