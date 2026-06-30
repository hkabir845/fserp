'use client'

import { useCallback, useEffect, useState } from 'react'
import { Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatNumber } from '@/utils/currency'

type WarehouseGroup = {
  id: number
  name: string
  code: string
  notes: string
  is_active: boolean
  member_pond_count: number
  member_ponds: { id: number; name: string; code: string }[]
}

type PoolRow = {
  warehouse_group_id: number
  warehouse_group_name: string
  item_name: string
  quantity: string
  unit: string
  member_pond_count: number
}

const inputCls =
  'mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500'

export function AquacultureWarehouseGroupsPanel(props: { onChanged?: () => void }) {
  const { onChanged } = props
  const toast = useToast()
  const [groups, setGroups] = useState<WarehouseGroup[]>([])
  const [pool, setPool] = useState<PoolRow[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<WarehouseGroup | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [gRes, pRes] = await Promise.all([
        api.get<WarehouseGroup[]>('/aquaculture/warehouse-groups/'),
        api.get<{ rows: PoolRow[] }>('/aquaculture/warehouse-group-pool/'),
      ])
      setGroups(Array.isArray(gRes.data) ? gRes.data : [])
      setPool(pRes.data?.rows || [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load warehouse groups'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setName('')
    setCode('')
    setNotes('')
    setModalOpen(true)
  }

  const openEdit = (g: WarehouseGroup) => {
    setEditing(g)
    setName(g.name)
    setCode(g.code || '')
    setNotes(g.notes || '')
    setModalOpen(true)
  }

  const save = async () => {
    const n = name.trim()
    if (!n) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      const body = { name: n, code: code.trim(), notes: notes.trim(), is_active: true }
      if (editing) {
        await api.put(`/aquaculture/warehouse-groups/${editing.id}/`, body)
        toast.success('Warehouse group updated')
      } else {
        await api.post('/aquaculture/warehouse-groups/', body)
        toast.success('Warehouse group created — assign member ponds on the Ponds page')
      }
      setModalOpen(false)
      await load()
      onChanged?.()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (g: WarehouseGroup) => {
    if (!window.confirm(`Delete shared warehouse "${g.name}"? Member ponds will be unlinked (stock stays on each pond).`)) {
      return
    }
    try {
      await api.delete(`/aquaculture/warehouse-groups/${g.id}/`)
      toast.success('Warehouse group removed')
      await load()
      onChanged?.()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    }
  }

  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
            <Layers className="h-4 w-4 text-primary" aria-hidden />
            Shared warehouse groups
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Link ponds that share one physical feed/medicine store (e.g. Ashari-1 and Ashari-2). Each pond keeps its own
            allocation; use <strong>Move between ponds</strong> to rebalance. Assign groups under{' '}
            <strong>Aquaculture → Ponds</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-accent px-3 py-2 text-sm font-medium text-primary hover:bg-teal-100"
        >
          <Plus className="h-4 w-4" aria-hidden />
          New group
        </button>
      </div>

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading groups…
        </p>
      ) : groups.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No shared groups yet. Create one for ponds on the same shed or canal bund.</p>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {groups.map((g) => {
            const poolRows = pool.filter((r) => r.warehouse_group_id === g.id)
            return (
              <div key={g.id} className="rounded-lg border border-border/70 bg-muted/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">{g.name}</p>
                    {g.code ? <p className="font-mono text-xs text-muted-foreground">{g.code}</p> : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {g.member_pond_count} pond{g.member_pond_count === 1 ? '' : 's'}
                      {g.member_ponds?.length
                        ? `: ${g.member_ponds.map((p) => p.name).join(', ')}`
                        : ' — assign on Ponds page'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(g)}
                      className="rounded p-1 text-muted-foreground hover:bg-white hover:text-foreground"
                      aria-label={`Edit ${g.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(g)}
                      className="rounded p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-700"
                      aria-label={`Delete ${g.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {poolRows.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 border-t border-border/80 pt-2 text-xs text-foreground/85">
                    {poolRows.map((r) => (
                      <li key={`${r.warehouse_group_id}-${r.item_name}`}>
                        <span className="font-medium">{r.item_name}</span>: {formatNumber(Number(r.quantity), 2)}{' '}
                        {r.unit}{' '}
                        <span className="text-muted-foreground">(pooled)</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 border-t border-border/80 pt-2 text-xs text-muted-foreground">No pooled stock on hand.</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-white p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">
              {editing ? 'Edit warehouse group' : 'New shared warehouse group'}
            </h3>
            <label className="mt-3 block text-xs font-medium text-foreground/85">
              Name
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ashari canal shed" />
            </label>
            <label className="mt-3 block text-xs font-medium text-foreground/85">
              Code (optional)
              <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="ASHARI-WH" />
            </label>
            <label className="mt-3 block text-xs font-medium text-foreground/85">
              Notes
              <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground/85"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
