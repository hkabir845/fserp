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
  if (x === 'urgent') return 'bg-red-100 text-red-900 border-red-200'
  if (x === 'high') return 'bg-amber-100 text-amber-900 border-amber-200'
  if (x === 'low') return 'bg-slate-100 text-slate-700 border-slate-200'
  return 'bg-indigo-50 text-indigo-900 border-indigo-100'
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
        <h1 className="text-2xl font-bold text-slate-900">Announcements</h1>
        <p className="mt-1 text-sm text-slate-600">
          Messages from the platform team (maintenance windows, policy updates, and notices).
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-slate-500">Loading…</p>
      )}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {err || 'Could not load announcements.'}
        </div>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          No announcements yet. When your operator publishes a notice, it will appear here.
        </div>
      )}

      {!isLoading && data && data.length > 0 && (
        <ul className="space-y-4">
          {data.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900">{a.title}</h2>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${priorityStyles(a.priority)}`}
                >
                  {a.priority}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{a.message}</p>
              <p className="mt-4 text-xs text-slate-400">
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
