'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateTime } from '@/utils/date'

type Announcement = {
  id: number
  title: string
  message: string
  priority: string
  sent_at: string | null
  created_at: string
}

function priorityStyles(p: string) {
  const x = (p || '').toLowerCase()
  if (x === 'urgent') return 'bg-destructive/10 text-red-900 border-destructive/25'
  if (x === 'high') return 'bg-amber-100 text-warning-foreground border-warning/30'
  if (x === 'low') return 'bg-muted text-foreground/85 border-border'
  return 'bg-accent text-foreground/85 border-primary/15'
}

export default function AnnouncementsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['tenant-announcements'],
    queryFn: async () => {
      const res = await api.get<Announcement[]>('/announcements')
      return res.data
    },
    retry: 1,
  })

  const err = (error as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
    ?.detail ?? (error as Error)?.message

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Announcements</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Messages from the platform team (maintenance windows, policy updates, and notices).
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {isError && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {err || 'Could not load announcements.'}
        </div>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <div className="rounded-xl border border-border bg-white p-8 text-center text-muted-foreground">
          No announcements yet. When your operator publishes a notice, it will appear here.
        </div>
      )}

      {!isLoading && data && data.length > 0 && (
        <ul className="space-y-4">
          {data.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border border-border bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-semibold text-foreground">{a.title}</h2>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${priorityStyles(a.priority)}`}
                >
                  {a.priority}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">{a.message}</p>
              <p className="mt-4 text-xs text-muted-foreground/70">
                {a.sent_at
                  ? `Sent ${formatDateTime(a.sent_at)}`
                  : `Posted ${formatDateTime(a.created_at)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
