'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookOpen, FileUp, Loader2, UserPlus } from 'lucide-react'
import api, { isApiSessionError } from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { useToast } from '@/components/Toast'

type BrainDoc = {
  id: number
  title: string
  description?: string
  department?: string
  role_tags?: string[]
  original_filename?: string
  download_url?: string
}

type HandoverRow = {
  id: number
  employee_name?: string
  job_title?: string
  department?: string
  status?: string
  updated_at?: string
}

type EmployeeRow = {
  id: number
  first_name: string
  last_name?: string
  job_title?: string
  is_active?: boolean
}

type Props = {
  language?: 'en' | 'bn'
  onAsk?: (question: string) => void
  className?: string
}

export function BrainKnowledgePanel({ language = 'bn', onAsk, className = '' }: Props) {
  const toast = useToast()
  const [docs, setDocs] = useState<BrainDoc[]>([])
  const [handovers, setHandovers] = useState<HandoverRow[]>([])
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [handoverEmployeeId, setHandoverEmployeeId] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [docDepartment, setDocDepartment] = useState('')
  const [docRoles, setDocRoles] = useState('')

  const labels =
    language === 'bn'
      ? {
          title: 'জ্ঞান ও হ্যান্ডওভার',
          subtitle: 'SOP আপলোড + কর্মী ছাড়ার আগে handover তৈরি',
          docs: 'কোম্পানি নথি (SOP)',
          upload: 'আপলোড',
          handover: 'Handover প্রোফাইল',
          generate: 'তৈরি করুন',
          employee: 'কর্মী',
          askNew: 'নতুন পদে জিজ্ঞেস',
          emptyDocs: 'এখনো নথি নেই — .txt / .md আপলোড করুন।',
          emptyHandover: 'Handover নেই — কর্মী বেছে তৈরি করুন।',
        }
      : {
          title: 'Knowledge & handover',
          subtitle: 'Upload SOPs + build handover packs when staff leave',
          docs: 'Company documents (SOP)',
          upload: 'Upload',
          handover: 'Handover profiles',
          generate: 'Generate',
          employee: 'Employee',
          askNew: 'Ask as new hire',
          emptyDocs: 'No documents yet — upload .txt / .md files.',
          emptyHandover: 'No handovers — pick an employee and generate.',
        }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [docRes, handRes, empRes] = await Promise.all([
        api.get<{ results: BrainDoc[] }>('/brain/documents/'),
        api.get<{ results: HandoverRow[] }>('/brain/handover/'),
        api.get<EmployeeRow[] | { results: EmployeeRow[] }>('/employees/'),
      ])
      setDocs(docRes.data.results || [])
      setHandovers(handRes.data.results || [])
      const empData = empRes.data
      const list = Array.isArray(empData) ? empData : empData.results || []
      setEmployees(list)
    } catch (e) {
      if (!isApiSessionError(e)) toast.error(extractErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const handleUpload = async (file: File | null) => {
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('title', docTitle.trim() || file.name)
      if (docDepartment.trim()) form.append('department', docDepartment.trim())
      if (docRoles.trim()) form.append('role_tags', docRoles.trim())
      await api.post('/brain/documents/', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success(language === 'bn' ? 'নথি সংরক্ষিত' : 'Document saved')
      setDocTitle('')
      await load()
    } catch (e) {
      if (!isApiSessionError(e)) toast.error(extractErrorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  const handleGenerateHandover = async () => {
    if (!handoverEmployeeId) return
    setGenerating(true)
    try {
      await api.post('/brain/handover/', {
        employee_id: Number(handoverEmployeeId),
        publish: true,
      })
      toast.success(language === 'bn' ? 'Handover তৈরি হয়েছে' : 'Handover created')
      await load()
    } catch (e) {
      if (!isApiSessionError(e)) toast.error(extractErrorMessage(e))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className={`rounded-xl border border-border bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-start gap-2">
        <BookOpen className="mt-0.5 h-5 w-5 text-indigo-600" />
        <div>
          <h2 className="font-semibold text-foreground">{labels.title}</h2>
          <p className="text-xs text-muted-foreground">{labels.subtitle}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <section>
            <p className="mb-2 font-medium">{labels.docs}</p>
            <div className="space-y-2">
              <input
                type="text"
                placeholder={language === 'bn' ? 'শিরোনাম' : 'Title'}
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                className="w-full rounded border border-border px-2 py-1 text-xs"
              />
              <input
                type="text"
                placeholder={language === 'bn' ? 'বিভাগ (ঐচ্ছিক)' : 'Department (optional)'}
                value={docDepartment}
                onChange={(e) => setDocDepartment(e.target.value)}
                className="w-full rounded border border-border px-2 py-1 text-xs"
              />
              <input
                type="text"
                placeholder={language === 'bn' ? 'পদ (comma)' : 'Roles (comma)'}
                value={docRoles}
                onChange={(e) => setDocRoles(e.target.value)}
                className="w-full rounded border border-border px-2 py-1 text-xs"
              />
              <label className="inline-flex cursor-pointer items-center gap-2 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileUp className="h-3 w-3" />}
                {labels.upload}
                <input
                  type="file"
                  accept=".txt,.md,.csv,.json"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => void handleUpload(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {docs.length === 0 && <li>{labels.emptyDocs}</li>}
              {docs.map((d) => (
                <li key={d.id}>
                  <span className="font-medium text-foreground">{d.title}</span>
                  {d.department ? ` · ${d.department}` : ''}
                </li>
              ))}
            </ul>
          </section>

          <section className="border-t border-border pt-3">
            <p className="mb-2 font-medium">{labels.handover}</p>
            <div className="flex flex-wrap gap-2">
              <select
                value={handoverEmployeeId}
                onChange={(e) => setHandoverEmployeeId(e.target.value)}
                className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-xs"
              >
                <option value="">{labels.employee}</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {[e.first_name, e.last_name].filter(Boolean).join(' ')}
                    {e.job_title ? ` — ${e.job_title}` : ''}
                    {e.is_active === false ? ' (inactive)' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!handoverEmployeeId || generating}
                onClick={() => void handleGenerateHandover()}
                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                {labels.generate}
              </button>
            </div>
            <ul className="mt-2 max-h-24 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {handovers.length === 0 && <li>{labels.emptyHandover}</li>}
              {handovers.slice(0, 6).map((h) => (
                <li key={h.id}>
                  {h.employee_name || `#${h.id}`} — {h.job_title || h.department || 'role'}
                </li>
              ))}
            </ul>
            {onAsk && (
              <button
                type="button"
                onClick={() =>
                  onAsk(
                    language === 'bn'
                      ? 'আমি এই পদে নতুন — handover ও SOP দেখে catch up করান'
                      : 'I am new in this role — catch me up using handover and SOP documents',
                  )
                }
                className="mt-2 text-xs font-medium text-indigo-700 hover:underline"
              >
                {labels.askNew}
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
