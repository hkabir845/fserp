'use client'

import { useState } from 'react'

export interface PlatformCurrency {
  id: number
  code: string
  name: string
  symbol: string
  is_default: boolean
  is_active: boolean
  decimal_places: number
  exchange_rate?: number
}

export interface PlatformUOM {
  id: number
  code: string
  name: string
  category: string
  base_unit?: string
  conversion_factor: number
  is_active: boolean
}

export function CurrencyModal({
  currency,
  onClose,
  onSave,
}: {
  currency: PlatformCurrency | null
  onSave: (currency: Partial<PlatformCurrency>) => void
  onClose: () => void
}) {
  const [formData, setFormData] = useState<{
    code: string
    name: string
    symbol: string
    decimal_places: number
    exchange_rate?: number
    is_default: boolean
  }>({
    code: currency?.code || '',
    name: currency?.name || '',
    symbol: currency?.symbol || '',
    decimal_places: currency?.decimal_places || 2,
    exchange_rate: currency?.exchange_rate || undefined,
    is_default: currency?.is_default || false,
  })

  return (
    <div className="fixed inset-0 z-50 h-full w-full overflow-y-auto bg-muted-foreground bg-opacity-50">
      <div className="relative top-20 mx-auto w-full max-w-md rounded-md border bg-white p-5 shadow-lg">
        <div className="mt-3">
          <h3 className="mb-4 text-lg font-medium text-foreground">
            {currency?.id ? 'Edit Currency' : 'Add Currency'}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground/85">Code *</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                disabled={!!currency?.id}
                className="mt-1 block w-full rounded-md border border-border px-3 py-2 shadow-sm focus:border-ring focus:ring-ring"
                placeholder="BDT"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/85">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 block w-full rounded-md border border-border px-3 py-2 shadow-sm focus:border-ring focus:ring-ring"
                placeholder="Bangladesh Taka"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/85">Symbol *</label>
              <input
                type="text"
                value={formData.symbol}
                onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                className="mt-1 block w-full rounded-md border border-border px-3 py-2 shadow-sm focus:border-ring focus:ring-ring"
                placeholder="৳"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/85">Decimal Places</label>
              <input
                type="number"
                value={formData.decimal_places}
                onChange={(e) => setFormData({ ...formData, decimal_places: parseInt(e.target.value, 10) || 2 })}
                className="mt-1 block w-full rounded-md border border-border px-3 py-2 shadow-sm focus:border-ring focus:ring-ring"
                min={0}
                max={4}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/85">Exchange Rate</label>
              <input
                type="number"
                step="0.0001"
                value={formData.exchange_rate || ''}
                onChange={(e) =>
                  setFormData({ ...formData, exchange_rate: parseFloat(e.target.value) || undefined })
                }
                className="mt-1 block w-full rounded-md border border-border px-3 py-2 shadow-sm focus:border-ring focus:ring-ring"
                placeholder="1.0000"
              />
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
              />
              <label className="ml-2 block text-sm text-foreground">Set as default currency</label>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (formData.code && formData.name && formData.symbol) {
                  onSave(formData)
                }
              }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function UOMModal({
  uom,
  onClose,
  onSave,
}: {
  uom: PlatformUOM | null
  onSave: (uom: Partial<PlatformUOM>) => void
  onClose: () => void
}) {
  const [formData, setFormData] = useState<{
    code: string
    name: string
    category: string
    base_unit: string
    conversion_factor: number
  }>({
    code: uom?.code || '',
    name: uom?.name || '',
    category: uom?.category || 'weight',
    base_unit: uom?.base_unit || '',
    conversion_factor: uom?.conversion_factor || 1.0,
  })

  const categories = ['weight', 'volume', 'length', 'count', 'area', 'temperature', 'time']

  return (
    <div className="fixed inset-0 z-50 h-full w-full overflow-y-auto bg-muted-foreground bg-opacity-50">
      <div className="relative top-20 mx-auto w-full max-w-md rounded-md border bg-white p-5 shadow-lg">
        <div className="mt-3">
          <h3 className="mb-4 text-lg font-medium text-foreground">
            {uom?.id ? 'Edit Unit of Measure' : 'Add Unit of Measure'}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground/85">Code *</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                disabled={!!uom?.id}
                className="mt-1 block w-full rounded-md border border-border px-3 py-2 shadow-sm focus:border-ring focus:ring-ring"
                placeholder="KG"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/85">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 block w-full rounded-md border border-border px-3 py-2 shadow-sm focus:border-ring focus:ring-ring"
                placeholder="Kilogram"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/85">Category *</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="mt-1 block w-full rounded-md border border-border px-3 py-2 shadow-sm focus:border-ring focus:ring-ring"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/85">Base Unit</label>
              <input
                type="text"
                value={formData.base_unit}
                onChange={(e) => setFormData({ ...formData, base_unit: e.target.value.toUpperCase() })}
                className="mt-1 block w-full rounded-md border border-border px-3 py-2 shadow-sm focus:border-ring focus:ring-ring"
                placeholder="KG (for weight category)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/85">Conversion Factor</label>
              <input
                type="number"
                step="0.0001"
                value={formData.conversion_factor}
                onChange={(e) =>
                  setFormData({ ...formData, conversion_factor: parseFloat(e.target.value) || 1.0 })
                }
                className="mt-1 block w-full rounded-md border border-border px-3 py-2 shadow-sm focus:border-ring focus:ring-ring"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (formData.code && formData.name && formData.category) {
                  onSave(formData)
                }
              }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
