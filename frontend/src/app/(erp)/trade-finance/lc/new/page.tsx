'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { api } from '@/lib/api'

const GOODS_CATS = [
  { id: 'feed_ingredient', label: 'Feed ingredients & additives' },
  { id: 'spare_parts', label: 'Spare parts' },
  { id: 'machinery', label: 'Machinery & equipment' },
  { id: 'packaging', label: 'Packaging' },
  { id: 'other', label: 'Other' },
]

const DEAL_TYPES = [
  { id: 'sight', label: 'Sight' },
  { id: 'usance', label: 'Usance / deferred' },
  { id: 'deferred_payment', label: 'Deferred payment' },
  { id: 'mixed_payment', label: 'Mixed payment' },
  { id: 'revolving', label: 'Revolving' },
  { id: 'transferable', label: 'Transferable' },
  { id: 'back_to_back', label: 'Back-to-back' },
]

export default function NewLCPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    lc_internal_number: `LC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-001`,
    bank_lc_reference: '',
    direction: 'import' as 'import' | 'export',
    deal_type: 'sight',
    status: 'draft',
    applicant_name: '',
    applicant_address: '',
    beneficiary_name: '',
    beneficiary_address: '',
    beneficiary_country: '',
    issuing_bank_name: '',
    issuing_bank_branch: '',
    issuing_bank_swift: '',
    advising_bank_name: '',
    advising_bank_swift: '',
    confirming_bank_name: '',
    currency_code: 'USD',
    amount: '',
    tolerance_pct_plus: '',
    tolerance_pct_minus: '',
    incoterm: 'CIF',
    partial_shipment_allowed: true,
    transshipment_allowed: true,
    latest_shipment_date: '',
    expiry_date: '',
    presentation_period_days: '21',
    goods_description: '',
    goods_category: 'feed_ingredient',
    hs_codes: '',
    bin_tin: '',
    irc_number: '',
    erc_number: '',
    feed_reg_license_ref: '',
    bangladesh_bank_reporting_ref: '',
    bank_lodgment_reference: '',
    insurers_cover_note: '',
    margin_pct: '',
    charges_account_party: 'applicant',
    supplier_id: '',
    customer_id: '',
    purchase_order_id: '',
    compliance_notes: '',
    internal_notes: '',
  })

  const mut = useMutation({
    mutationFn: async () => {
      const toIso = (d: string) => (d ? new Date(d + 'T12:00:00').toISOString() : undefined)
      const num = (s: string) => (s.trim() === '' ? undefined : Number(s))
      const int = (s: string) => (s.trim() === '' ? undefined : parseInt(s, 10))
      const payload = {
        lc_internal_number: form.lc_internal_number.trim(),
        bank_lc_reference: form.bank_lc_reference.trim() || undefined,
        direction: form.direction,
        deal_type: form.deal_type,
        status: form.status,
        applicant_name: form.applicant_name.trim(),
        applicant_address: form.applicant_address.trim() || undefined,
        beneficiary_name: form.beneficiary_name.trim(),
        beneficiary_address: form.beneficiary_address.trim() || undefined,
        beneficiary_country: form.beneficiary_country.trim() || undefined,
        issuing_bank_name: form.issuing_bank_name.trim(),
        issuing_bank_branch: form.issuing_bank_branch.trim() || undefined,
        issuing_bank_swift: form.issuing_bank_swift.trim() || undefined,
        advising_bank_name: form.advising_bank_name.trim() || undefined,
        advising_bank_swift: form.advising_bank_swift.trim() || undefined,
        confirming_bank_name: form.confirming_bank_name.trim() || undefined,
        currency_code: form.currency_code.trim().toUpperCase().slice(0, 3),
        amount: Number(form.amount),
        tolerance_pct_plus: num(form.tolerance_pct_plus ?? ''),
        tolerance_pct_minus: num(form.tolerance_pct_minus ?? ''),
        incoterm: form.incoterm.trim() || undefined,
        partial_shipment_allowed: form.partial_shipment_allowed,
        transshipment_allowed: form.transshipment_allowed,
        latest_shipment_date: toIso(form.latest_shipment_date),
        expiry_date: toIso(form.expiry_date),
        presentation_period_days: int(form.presentation_period_days),
        goods_description: form.goods_description.trim(),
        goods_category: form.goods_category,
        hs_codes: form.hs_codes.trim() || undefined,
        bin_tin: form.bin_tin.trim() || undefined,
        irc_number: form.irc_number.trim() || undefined,
        erc_number: form.erc_number.trim() || undefined,
        feed_reg_license_ref: form.feed_reg_license_ref.trim() || undefined,
        bangladesh_bank_reporting_ref: form.bangladesh_bank_reporting_ref.trim() || undefined,
        bank_lodgment_reference: form.bank_lodgment_reference.trim() || undefined,
        insurers_cover_note: form.insurers_cover_note.trim() || undefined,
        margin_pct: num(form.margin_pct ?? ''),
        charges_account_party: form.charges_account_party || undefined,
        supplier_id: int(form.supplier_id),
        customer_id: int(form.customer_id),
        purchase_order_id: int(form.purchase_order_id),
        compliance_notes: form.compliance_notes.trim() || undefined,
        internal_notes: form.internal_notes.trim() || undefined,
      }
      const res = await api.post('/lc', payload)
      return res.data
    },
    onSuccess: (data: { id: number }) => {
      router.push(`/trade-finance/lc/${data.id}`)
    },
  })

  const field =
    'block w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-ring'
  const label = 'block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1'

  return (
          <div className="mx-auto max-w-5xl space-y-6 pb-16">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/trade-finance/lc" className="text-sm font-medium text-primary hover:text-primary">
              ← Back to LC register
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-foreground">Register letter of credit</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter data from your bank’s SWIFT MT700/701 or application form. Fields mirror common Bangladesh AD bank and customs references.
            </p>
          </div>
        </div>

        {mut.isError && (
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
            {(mut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || (mut.error as Error)?.message || 'Save failed'}
          </div>
        )}

        <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Identity & direction</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label}>Internal reference # *</label>
              <input className={field} value={form.lc_internal_number} onChange={(e) => setForm({ ...form, lc_internal_number: e.target.value })} />
            </div>
            <div>
              <label className={label}>Bank LC reference</label>
              <input
                className={field}
                placeholder="As per SWIFT / bank advice"
                value={form.bank_lc_reference}
                onChange={(e) => setForm({ ...form, bank_lc_reference: e.target.value })}
              />
            </div>
            <div>
              <label className={label}>Direction *</label>
              <select className={field} value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as 'import' | 'export' })}>
                <option value="import">Import (buying from abroad)</option>
                <option value="export">Export (selling overseas)</option>
              </select>
            </div>
            <div>
              <label className={label}>Deal type</label>
              <select className={field} value={form.deal_type} onChange={(e) => setForm({ ...form, deal_type: e.target.value })}>
                {DEAL_TYPES.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Initial status</label>
              <select className={field} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="draft">Draft</option>
                <option value="bank_review">Submitted to bank</option>
                <option value="opened">Opened</option>
                <option value="advised">Advised</option>
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Parties</h2>
          <p className="mt-1 text-sm text-muted-foreground">For imports, applicant is usually your company in Bangladesh; beneficiary is the foreign seller. Reverse roles for export.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label}>Applicant (ordering party) *</label>
              <input className={field} value={form.applicant_name} onChange={(e) => setForm({ ...form, applicant_name: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Applicant address</label>
              <textarea className={field} rows={2} value={form.applicant_address} onChange={(e) => setForm({ ...form, applicant_address: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Beneficiary *</label>
              <input className={field} value={form.beneficiary_name} onChange={(e) => setForm({ ...form, beneficiary_name: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Beneficiary address</label>
              <textarea className={field} rows={2} value={form.beneficiary_address} onChange={(e) => setForm({ ...form, beneficiary_address: e.target.value })} />
            </div>
            <div>
              <label className={label}>Beneficiary country</label>
              <input className={field} value={form.beneficiary_country} onChange={(e) => setForm({ ...form, beneficiary_country: e.target.value })} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Banks (SWIFT where available)</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label}>Issuing / applicant’s bank *</label>
              <input className={field} value={form.issuing_bank_name} onChange={(e) => setForm({ ...form, issuing_bank_name: e.target.value })} />
            </div>
            <div>
              <label className={label}>Branch</label>
              <input className={field} value={form.issuing_bank_branch} onChange={(e) => setForm({ ...form, issuing_bank_branch: e.target.value })} />
            </div>
            <div>
              <label className={label}>SWIFT BIC</label>
              <input className={field} placeholder="e.g. 8 or 11 characters" value={form.issuing_bank_swift} onChange={(e) => setForm({ ...form, issuing_bank_swift: e.target.value })} />
            </div>
            <div>
              <label className={label}>Advising bank</label>
              <input className={field} value={form.advising_bank_name} onChange={(e) => setForm({ ...form, advising_bank_name: e.target.value })} />
            </div>
            <div>
              <label className={label}>Advising SWIFT</label>
              <input className={field} value={form.advising_bank_swift} onChange={(e) => setForm({ ...form, advising_bank_swift: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Confirming bank (if any)</label>
              <input className={field} value={form.confirming_bank_name} onChange={(e) => setForm({ ...form, confirming_bank_name: e.target.value })} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Amounts & trade terms</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={label}>Currency *</label>
              <input className={field} maxLength={3} value={form.currency_code} onChange={(e) => setForm({ ...form, currency_code: e.target.value })} />
            </div>
            <div>
              <label className={label}>LC amount *</label>
              <input className={field} type="number" step="any" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div>
              <label className={label}>Incoterm</label>
              <select className={field} value={form.incoterm} onChange={(e) => setForm({ ...form, incoterm: e.target.value })}>
                {['FOB', 'CFR', 'CIF', 'EXW', 'FCA', 'DAP', 'DDP'].map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Tolerance + %</label>
              <input className={field} type="number" step="any" value={form.tolerance_pct_plus} onChange={(e) => setForm({ ...form, tolerance_pct_plus: e.target.value })} />
            </div>
            <div>
              <label className={label}>Tolerance − %</label>
              <input className={field} type="number" step="any" value={form.tolerance_pct_minus} onChange={(e) => setForm({ ...form, tolerance_pct_minus: e.target.value })} />
            </div>
            <div>
              <label className={label}>Presentation period (days)</label>
              <input className={field} type="number" value={form.presentation_period_days} onChange={(e) => setForm({ ...form, presentation_period_days: e.target.value })} />
            </div>
            <div>
              <label className={label}>Latest shipment</label>
              <CompanyDateInput value={form.latest_shipment_date} onChange={(iso) => setForm({ ...form, latest_shipment_date: iso })} className={field} />
            </div>
            <div>
              <label className={label}>LC expiry *</label>
              <CompanyDateInput value={form.expiry_date} onChange={(iso) => setForm({ ...form, expiry_date: iso })} className={field} />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
              <label className="flex items-center gap-2 text-sm text-foreground/85">
                <input type="checkbox" checked={form.partial_shipment_allowed} onChange={(e) => setForm({ ...form, partial_shipment_allowed: e.target.checked })} />
                Partial shipments allowed
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground/85">
                <input type="checkbox" checked={form.transshipment_allowed} onChange={(e) => setForm({ ...form, transshipment_allowed: e.target.checked })} />
                Transshipment allowed
              </label>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Goods (feed & plant)</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Category</label>
              <select className={field} value={form.goods_category} onChange={(e) => setForm({ ...form, goods_category: e.target.value })}>
                {GOODS_CATS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>HS code(s)</label>
              <input
                className={field}
                placeholder="Comma-separated"
                value={form.hs_codes}
                onChange={(e) => setForm({ ...form, hs_codes: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Goods description (as per LC) *</label>
              <textarea className={field} rows={4} value={form.goods_description} onChange={(e) => setForm({ ...form, goods_description: e.target.value })} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Bangladesh regulatory & bank references</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use values issued to your company (IRC for imports, ERC for exports as applicable). Bank lodgment / BB references are given by your AD bank when reporting under
            current FX rules.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>BIN / TIN</label>
              <input className={field} value={form.bin_tin} onChange={(e) => setForm({ ...form, bin_tin: e.target.value })} />
            </div>
            <div>
              <label className={label}>IRC (import)</label>
              <input className={field} value={form.irc_number} onChange={(e) => setForm({ ...form, irc_number: e.target.value })} />
            </div>
            <div>
              <label className={label}>ERC (export)</label>
              <input className={field} value={form.erc_number} onChange={(e) => setForm({ ...form, erc_number: e.target.value })} />
            </div>
            <div>
              <label className={label}>Feed / veterinary license ref.</label>
              <input className={field} value={form.feed_reg_license_ref} onChange={(e) => setForm({ ...form, feed_reg_license_ref: e.target.value })} />
            </div>
            <div>
              <label className={label}>Bangladesh Bank reporting ref.</label>
              <input className={field} value={form.bangladesh_bank_reporting_ref} onChange={(e) => setForm({ ...form, bangladesh_bank_reporting_ref: e.target.value })} />
            </div>
            <div>
              <label className={label}>Bank lodgment reference</label>
              <input className={field} value={form.bank_lodgment_reference} onChange={(e) => setForm({ ...form, bank_lodgment_reference: e.target.value })} />
            </div>
            <div>
              <label className={label}>Margin % (cash / cover)</label>
              <input className={field} type="number" step="any" value={form.margin_pct} onChange={(e) => setForm({ ...form, margin_pct: e.target.value })} />
            </div>
            <div>
              <label className={label}>Bank charges borne by</label>
              <select className={field} value={form.charges_account_party} onChange={(e) => setForm({ ...form, charges_account_party: e.target.value })}>
                <option value="applicant">Applicant</option>
                <option value="beneficiary">Beneficiary</option>
                <option value="shared">Shared</option>
              </select>
            </div>
            <div>
              <label className={label}>Insurance cover note</label>
              <input className={field} value={form.insurers_cover_note} onChange={(e) => setForm({ ...form, insurers_cover_note: e.target.value })} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">ERP links (optional)</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>Supplier ID</label>
              <input className={field} type="number" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} />
            </div>
            <div>
              <label className={label}>Customer ID</label>
              <input className={field} type="number" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} />
            </div>
            <div>
              <label className={label}>Purchase order ID</label>
              <input className={field} type="number" value={form.purchase_order_id} onChange={(e) => setForm({ ...form, purchase_order_id: e.target.value })} />
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-1">
            <div>
              <label className={label}>Compliance notes</label>
              <textarea className={field} rows={2} value={form.compliance_notes} onChange={(e) => setForm({ ...form, compliance_notes: e.target.value })} />
            </div>
            <div>
              <label className={label}>Internal notes</label>
              <textarea className={field} rows={2} value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} />
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-6">
          <Link href="/trade-finance/lc" className="rounded-md border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground/85 hover:bg-muted/40">
            Cancel
          </Link>
          <button
            type="button"
            disabled={mut.isPending || !form.lc_internal_number.trim() || !form.applicant_name.trim() || !form.beneficiary_name.trim() || !form.issuing_bank_name.trim() || !form.goods_description.trim() || !form.amount || !form.expiry_date}
            onClick={() => mut.mutate()}
            className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {mut.isPending ? 'Saving…' : 'Save LC'}
          </button>
        </div>
      </div>
  )
}
