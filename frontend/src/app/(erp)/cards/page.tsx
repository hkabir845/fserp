'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import Link from 'next/link'
import { useState, useEffect, useMemo, useRef } from 'react'

type Card = {
  display_name: string
  title: string | null
  department: string | null
  phone: string | null
  email: string | null
  website: string | null
  address: string | null
  bio: string | null
  theme: string | null
  show_phone: boolean
  show_email: boolean
  nfc_tag_uid: string | null
  paper_card_ordered: boolean
  digital_card_url: string
  role_business_card: boolean
  role_employee_id: boolean
  role_access: boolean
  role_payment: boolean
  employee_code: string | null
  photo_url: string | null
  join_date: string | null
  blood_group: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  profile_notes: string | null
  access_zones: string[] | null
  access_valid_from: string | null
  access_valid_to: string | null
  access_notes: string | null
  payment_enrolled: boolean
  payment_provider_ref: string | null
  payment_last4_hint: string | null
  payment_notes: string | null
}

type PayrollEmployee = {
  id: number
  name: string
  phone?: string | null
  email?: string | null
  department?: string | null
  designation?: string | null
  join_date: string
  is_active: boolean
}

function mapEmployeeToCard(emp: PayrollEmployee): Partial<Card> {
  return {
    display_name: emp.name,
    title: emp.designation ?? null,
    department: emp.department ?? null,
    phone: emp.phone ?? null,
    email: emp.email ?? null,
    join_date: emp.join_date ? new Date(emp.join_date).toISOString() : null,
    employee_code: `EMP-${String(emp.id).padStart(4, '0')}`,
  }
}

function zonesToText(z: string[] | null | undefined) {
  return (z || []).join('\n')
}

function textToZones(s: string) {
  return s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
}

export default function BusinessCardsPage() {
  const qc = useQueryClient()
  const [form, setForm] = useState<Partial<Card>>({})
  const [zonesText, setZonesText] = useState('')
  const [employeeSearchOpen, setEmployeeSearchOpen] = useState(false)
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('')
  const employeeSectionRef = useRef<HTMLElement>(null)
  const didAutoApplyFromUserEmail = useRef(false)

  const { data: card, error, isLoading, isSuccess: cardQuerySuccess } = useQuery({
    queryKey: ['my-business-card'],
    queryFn: async () => {
      try {
        const res = await api.get<Card>('/cards/me')
        return res.data
      } catch (e: unknown) {
        const status = (e as { response?: { status?: number } })?.response?.status
        if (status === 404) return null
        throw e
      }
    },
    retry: false,
  })

  const { data: employees = [] } = useQuery<PayrollEmployee[]>({
    queryKey: ['payroll-employees'],
    queryFn: async () => {
      const res = await api.get<PayrollEmployee[]>('/payroll/employees')
      return res.data
    },
    retry: false,
  })

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    retry: false,
  })

  const filteredEmployees = useMemo(() => {
    const q = employeeSearchQuery.trim().toLowerCase()
    if (!q) return employees
    return employees.filter((e) =>
      [e.name, e.email, e.department, e.designation].some(
        (field) => field && String(field).toLowerCase().includes(q),
      ),
    )
  }, [employees, employeeSearchQuery])

  useEffect(() => {
    if (card) {
      setForm(card)
      setZonesText(zonesToText(card.access_zones))
    }
  }, [card])

  useEffect(() => {
    const onDocMouseDown = (ev: MouseEvent) => {
      const el = employeeSectionRef.current
      if (!el || !employeeSearchOpen) return
      if (ev.target instanceof Node && !el.contains(ev.target)) setEmployeeSearchOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [employeeSearchOpen])

  const noSavedCard = cardQuerySuccess && card === null

  useEffect(() => {
    if (!noSavedCard || didAutoApplyFromUserEmail.current || !employees.length || !currentUser?.email) return
    const match = employees.find(
      (e) => e.email && e.email.toLowerCase() === currentUser.email.toLowerCase(),
    )
    if (!match) return
    didAutoApplyFromUserEmail.current = true
    setForm((f) => ({ ...f, ...mapEmployeeToCard(match) }))
  }, [noSavedCard, employees, currentUser])

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.put('/cards/me', {
        display_name: form.display_name || 'Team member',
        title: form.title || null,
        department: form.department || null,
        phone: form.phone || null,
        email: form.email || null,
        website: form.website || null,
        address: form.address || null,
        bio: form.bio || null,
        theme: form.theme || 'slate',
        show_phone: form.show_phone ?? true,
        show_email: form.show_email ?? true,
        nfc_tag_uid: form.nfc_tag_uid || null,
        paper_card_ordered: form.paper_card_ordered ?? false,
        role_business_card: form.role_business_card ?? true,
        role_employee_id: form.role_employee_id ?? true,
        role_access: form.role_access ?? false,
        role_payment: form.role_payment ?? false,
        employee_code: form.employee_code || null,
        photo_url: form.photo_url || null,
        join_date: form.join_date ? new Date(form.join_date).toISOString() : null,
        blood_group: form.blood_group || null,
        emergency_contact_name: form.emergency_contact_name || null,
        emergency_contact_phone: form.emergency_contact_phone || null,
        profile_notes: form.profile_notes || null,
        access_zones: textToZones(zonesText),
        access_valid_from: form.access_valid_from ? new Date(form.access_valid_from).toISOString() : null,
        access_valid_to: form.access_valid_to ? new Date(form.access_valid_to).toISOString() : null,
        access_notes: form.access_notes || null,
        payment_enrolled: form.payment_enrolled ?? false,
        payment_provider_ref: form.payment_provider_ref || null,
        payment_last4_hint: form.payment_last4_hint || null,
        payment_notes: form.payment_notes || null,
      })
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-business-card'] }),
  })

  const role = (key: keyof Card, label: string, hint: string) => (
    <label key={key as string} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/40">
      <input
        type="checkbox"
        className="mt-1"
        checked={Boolean(form[key])}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
      />
      <span>
        <span className="font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  )

  return (
          <div className="max-w-3xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Multi-role NFC & digital profile</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            One tag or QR can open your profile: use it as a <strong>business card</strong>, on-site{' '}
            <strong>employee ID</strong>, <strong>access</strong> context for doors/zones, and (with integrations) a{' '}
            <strong>payment / wallet</strong> enrollment reference. Door readers and POS use separate systems — this
            page stores display data and opaque provider references only.
          </p>
        </div>

        <section
          ref={employeeSectionRef}
          className="rounded-xl border border-border bg-white p-4 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-foreground">Fill from payroll roster</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Search by name, email, department, or designation, then select an employee to merge roster fields into the
            form.
          </p>
          <div className="relative mt-3">
            <input
              type="search"
              placeholder="Search employees…"
              value={employeeSearchQuery}
              onChange={(e) => {
                setEmployeeSearchQuery(e.target.value)
                setEmployeeSearchOpen(true)
              }}
              onFocus={() => setEmployeeSearchOpen(true)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              autoComplete="off"
            />
            {employeeSearchOpen ? (
              <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-white py-1 text-sm shadow-lg">
                {filteredEmployees.length === 0 ? (
                  <li className="px-3 py-2 text-muted-foreground">No matches</li>
                ) : (
                  filteredEmployees.map((emp) => (
                    <li key={emp.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left hover:bg-accent"
                        onClick={() => {
                          setForm((f) => ({ ...f, ...mapEmployeeToCard(emp) }))
                          setEmployeeSearchOpen(false)
                          setEmployeeSearchQuery('')
                        }}
                      >
                        <span className="font-medium text-foreground">{emp.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {[emp.designation, emp.department, emp.email].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </section>

        {error ? (
          <div className="erp-alert-warning">
            {(error as { response?: { data?: { detail?: string } } })?.response?.data?.detail?.toString() ||
              'Create your profile below (requires tenant mode).'}
          </div>
        ) : null}

        {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

        <section className="rounded-xl border border-primary/15 bg-accent/50 p-4">
          <h2 className="text-sm font-semibold text-foreground/85">Card roles</h2>
          <p className="mt-1 text-xs text-primary/80">Enable the experiences this NFC tag should expose on the public page.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {role('role_business_card', 'Business card', 'Contact, bio, company links for customers & partners')}
            {role('role_employee_id', 'Employee ID', 'Badge-style photo, employee #, emergency contact')}
            {role('role_access', 'Access context', 'Zones & validity window (display; physical auth is at readers)')}
            {role('role_payment', 'Payment / wallet', 'Enrollment flag + masked hint + PSP reference only')}
          </div>
        </section>

        <div className="space-y-4 rounded-xl border border-border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Shared contact</h2>
          {['display_name', 'title', 'department', 'phone', 'email', 'website'].map((field) => (
            <div key={field}>
              <label className="text-xs font-medium text-muted-foreground">{field.replace('_', ' ')}</label>
              <input
                value={(form as Record<string, string>)[field] || ''}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Address</label>
            <textarea
              value={form.address || ''}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              rows={2}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Bio</label>
            <textarea
              value={form.bio || ''}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.show_phone ?? true}
                onChange={(e) => setForm((f) => ({ ...f, show_phone: e.target.checked }))}
              />
              Show phone on public business card
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.show_email ?? true}
                onChange={(e) => setForm((f) => ({ ...f, show_email: e.target.checked }))}
              />
              Show email on public business card
            </label>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Theme (preview)</label>
            <select
              value={form.theme || 'slate'}
              onChange={(e) => setForm((f) => ({ ...f, theme: e.target.value }))}
              className="mt-1 rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="slate">Slate</option>
              <option value="emerald">Emerald</option>
            </select>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-amber-100 bg-warning/10/30 p-5">
          <h2 className="text-sm font-semibold text-warning-foreground">Employee ID profile</h2>
          {['employee_code', 'photo_url', 'blood_group', 'emergency_contact_name', 'emergency_contact_phone'].map(
            (field) => (
              <div key={field}>
                <label className="text-xs font-medium text-muted-foreground">{field.replace(/_/g, ' ')}</label>
                <input
                  value={(form as Record<string, string>)[field] || ''}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  placeholder={field === 'photo_url' ? 'https://…' : undefined}
                />
              </div>
            ),
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Join date</label>
            <CompanyDateInput value={form.join_date ? form.join_date.slice(0, 10) : ''} onChange={(iso) => setForm((f) => ({ ...f, join_date: iso ? `${iso}T00:00:00` : null }))} className="mt-1 rounded-md border border-border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Profile notes (skills, certifications)</label>
            <textarea
              value={form.profile_notes || ''}
              onChange={(e) => setForm((f) => ({ ...f, profile_notes: e.target.value }))}
              rows={2}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-cyan-100 bg-cyan-50/30 p-5">
          <h2 className="text-sm font-semibold text-cyan-900">Access (display)</h2>
          <p className="text-xs text-cyan-800/80">List zones/locations this badge is associated with. Physical access control integrates via your door vendor; NFC UID can be linked for provisioning.</p>
          <div>
            <label className="text-xs font-medium text-muted-foreground">NFC tag UID</label>
            <input
              value={form.nfc_tag_uid || ''}
              onChange={(e) => setForm((f) => ({ ...f, nfc_tag_uid: e.target.value }))}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Zones (one per line)</label>
            <textarea
              value={zonesText}
              onChange={(e) => setZonesText(e.target.value)}
              rows={3}
              placeholder="Main gate&#10;Mill floor&#10;Warehouse B"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Valid from</label>
              <input
                type="datetime-local"
                value={form.access_valid_from ? form.access_valid_from.slice(0, 16) : ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, access_valid_from: e.target.value ? `${e.target.value}:00` : null }))
                }
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Valid to</label>
              <input
                type="datetime-local"
                value={form.access_valid_to ? form.access_valid_to.slice(0, 16) : ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, access_valid_to: e.target.value ? `${e.target.value}:00` : null }))
                }
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Access notes</label>
            <input
              value={form.access_notes || ''}
              onChange={(e) => setForm((f) => ({ ...f, access_notes: e.target.value }))}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-violet-100 bg-violet-50/30 p-5">
          <h2 className="text-sm font-semibold text-violet-900">Payment / wallet (integration)</h2>
          <p className="text-xs text-violet-800/80">
            Store only a provider token reference and optional last-4 style hint — never full card numbers.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.payment_enrolled ?? false}
              onChange={(e) => setForm((f) => ({ ...f, payment_enrolled: e.target.checked }))}
            />
            Mark as enrolled with payment provider
          </label>
          {['payment_provider_ref', 'payment_last4_hint', 'payment_notes'].map((field) => (
            <div key={field}>
              <label className="text-xs font-medium text-muted-foreground">{field.replace(/_/g, ' ')}</label>
              <input
                value={(form as Record<string, string>)[field] || ''}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground/85">
          <input
            type="checkbox"
            checked={form.paper_card_ordered ?? false}
            onChange={(e) => setForm((f) => ({ ...f, paper_card_ordered: e.target.checked }))}
          />
          Physical card ordered (PVC / paper) from print vendor
        </label>

        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90"
        >
          Save profile
        </button>

        {card?.digital_card_url ? (
          <Link
            href={card.digital_card_url}
            className="inline-flex text-sm font-semibold text-primary hover:text-primary"
          >
            Open public preview →
          </Link>
        ) : null}
      </div>
  )
}
