import { backendUrl } from '@/lib/api'
import { notFound } from 'next/navigation'

type PublicCard = {
  slug: string
  preview_url: string
  roles: Record<string, boolean>
  business?: Record<string, unknown> | null
  identity?: Record<string, unknown> | null
  access?: Record<string, unknown> | null
  payment?: Record<string, unknown> | null
}

type Props = { params: { slug: string } }

async function getPublicCard(slug: string): Promise<PublicCard | null> {
  const res = await fetch(backendUrl(`/api/v1/cards/public/${slug}`), { next: { revalidate: 60 } })
  if (!res.ok) return null
  return res.json()
}

export default async function PublicCardPage({ params }: Props) {
  const data = await getPublicCard(params.slug)
  if (!data) notFound()

  const biz = data.business as Record<string, string | undefined> | undefined
  const idn = data.identity as Record<string, string | undefined> | undefined
  const acc = data.access as { zones?: string[]; valid_from?: string; valid_to?: string; notes?: string } | undefined
  const pay = data.payment as { enrolled?: boolean; card_hint?: string; notes?: string } | undefined

  const theme =
    biz?.theme === 'emerald' ? 'from-emerald-800 to-slate-900' : 'from-slate-800 to-slate-950'

  return (
    <div className={`min-h-screen bg-gradient-to-br ${theme} px-4 py-10 text-white`}>
      <div className="mx-auto max-w-lg space-y-6">
        <header className="text-center">
          <p className="text-xs uppercase tracking-widest text-emerald-200/90">Digital employee profile</p>
          <p className="mt-1 text-xs text-slate-400">
            NFC / QR ·{' '}
            {Object.entries(data.roles)
              .filter(([, v]) => v)
              .map(([k]) => k.replace('_', ' '))
              .join(' · ')}
          </p>
        </header>

        {data.roles.business_card && biz ? (
          <section className="rounded-2xl border border-white/10 bg-white/10 p-6 shadow-xl backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Business card</h2>
            <h1 className="mt-2 text-2xl font-bold">{biz.display_name}</h1>
            {biz.title ? <p className="text-emerald-100">{biz.title}</p> : null}
            {biz.department ? <p className="text-sm text-slate-300">{biz.department}</p> : null}
            {biz.bio ? <p className="mt-4 text-sm leading-relaxed text-slate-200">{biz.bio}</p> : null}
            <dl className="mt-4 space-y-2 text-sm">
              {biz.phone ? (
                <div>
                  <dt className="text-slate-400">Phone</dt>
                  <dd>
                    <a href={`tel:${biz.phone}`} className="text-white underline">
                      {biz.phone}
                    </a>
                  </dd>
                </div>
              ) : null}
              {biz.email ? (
                <div>
                  <dt className="text-slate-400">Email</dt>
                  <dd>
                    <a href={`mailto:${biz.email}`} className="text-white underline">
                      {biz.email}
                    </a>
                  </dd>
                </div>
              ) : null}
              {biz.website ? (
                <div>
                  <dt className="text-slate-400">Web</dt>
                  <dd>
                    <a href={biz.website} target="_blank" rel="noreferrer" className="text-emerald-200 underline">
                      {biz.website}
                    </a>
                  </dd>
                </div>
              ) : null}
              {biz.address ? (
                <div>
                  <dt className="text-slate-400">Address</dt>
                  <dd className="whitespace-pre-line text-slate-200">{biz.address}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}

        {data.roles.employee_id && idn ? (
          <section className="rounded-2xl border border-white/10 bg-black/20 p-6 backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-200">Employee ID</h2>
            <div className="mt-3 flex gap-4">
              {idn.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={idn.photo_url}
                  alt=""
                  className="h-24 w-24 rounded-lg object-cover ring-2 ring-white/20"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-white/10 text-3xl text-slate-400">
                  ID
                </div>
              )}
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold">{idn.display_name}</div>
                {idn.employee_code ? (
                  <div className="mt-1 font-mono text-amber-100">#{idn.employee_code}</div>
                ) : null}
                {idn.title ? <div className="text-slate-300">{idn.title}</div> : null}
                {idn.department ? <div className="text-slate-400">{idn.department}</div> : null}
                {idn.join_date ? <div className="mt-2 text-xs text-slate-500">Joined {idn.join_date}</div> : null}
                {idn.blood_group ? <div className="text-xs text-slate-400">Blood {idn.blood_group}</div> : null}
                {idn.emergency_contact_name || idn.emergency_contact_phone ? (
                  <div className="mt-2 border-t border-white/10 pt-2 text-xs text-slate-400">
                    Emergency: {idn.emergency_contact_name} {idn.emergency_contact_phone}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {data.roles.access && acc ? (
          <section className="rounded-2xl border border-cyan-500/30 bg-cyan-950/40 p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Access</h2>
            <ul className="mt-2 list-inside list-disc text-sm text-cyan-100">
              {(acc.zones || []).map((z) => (
                <li key={z}>{z}</li>
              ))}
            </ul>
            {acc.valid_from || acc.valid_to ? (
              <p className="mt-2 text-xs text-cyan-300/80">
                Valid {acc.valid_from || '—'} → {acc.valid_to || '—'}
              </p>
            ) : null}
            {acc.notes ? <p className="mt-2 text-xs text-slate-400">{acc.notes}</p> : null}
          </section>
        ) : null}

        {data.roles.payment && pay ? (
          <section className="rounded-2xl border border-violet-500/30 bg-violet-950/40 p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-violet-200">Payment / wallet</h2>
            <p className="mt-2 text-sm text-violet-100">
              {pay.enrolled ? 'Enrolled' : 'Not enrolled'}
              {pay.card_hint ? ` · ${pay.card_hint}` : ''}
            </p>
            {pay.notes ? <p className="mt-2 text-xs text-slate-400">{pay.notes}</p> : null}
            <p className="mt-3 text-xs text-slate-500">
              Card numbers are never stored here — only masked hints and provider tokens for integrations.
            </p>
          </section>
        ) : null}

        <p className="text-center text-xs text-slate-500">FMERP · multi-role NFC profile</p>
      </div>
    </div>
  )
}
