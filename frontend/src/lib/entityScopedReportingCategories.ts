import { useEffect, useState } from 'react'
import api from '@/lib/api'
import {
  billExpenseCategoriesFromApi,
  type AquacultureBillExpenseCategory,
} from '@/lib/aquacultureBillLine'
import {
  invoiceAquacultureIncomeFromApi,
  type AquacultureInvoiceIncomeCategory,
} from '@/lib/aquacultureInvoiceLine'
import { entityScopeParamsFromKey } from '@/lib/billLineEntity'
import {
  billFuelCategoriesFromApi,
  type FuelStationBillExpenseCategory,
} from '@/lib/fuelStationBillLine'
import {
  invoiceFuelCategoriesFromApi,
  type FuelStationInvoiceIncomeCategory,
} from '@/lib/fuelStationInvoiceLine'

const cache = new Map<string, unknown[]>()

function scopedCacheKey(endpoint: string, entityKey: string): string {
  const params = entityScopeParamsFromKey(entityKey)
  return `${endpoint}:${params.station_id || ''}:${params.pond_id || ''}:${params.head_office || ''}`
}

function readCache<T>(key: string): T[] | undefined {
  const hit = cache.get(key)
  return hit ? (hit as T[]) : undefined
}

function writeCache<T>(key: string, rows: T[]): T[] {
  cache.set(key, rows)
  return rows
}

export function clearEntityScopedReportingCategoryCache(): void {
  cache.clear()
}

export async function fetchAquacultureBillExpenseCategoriesForEntity(
  entityKey: string
): Promise<AquacultureBillExpenseCategory[]> {
  const key = scopedCacheKey('/aquaculture/expense-categories/', entityKey)
  const cached = readCache<AquacultureBillExpenseCategory>(key)
  if (cached) return cached
  const { data } = await api.get('/aquaculture/expense-categories/', {
    params: entityScopeParamsFromKey(entityKey),
  })
  return writeCache(
    key,
    billExpenseCategoriesFromApi(Array.isArray(data) ? data : [])
  )
}

export async function fetchFuelBillExpenseCategoriesForEntity(
  entityKey: string
): Promise<FuelStationBillExpenseCategory[]> {
  const key = scopedCacheKey('/fuel-station/expense-categories/', entityKey)
  const cached = readCache<FuelStationBillExpenseCategory>(key)
  if (cached) return cached
  const { data } = await api.get('/fuel-station/expense-categories/', {
    params: entityScopeParamsFromKey(entityKey),
  })
  return writeCache(
    key,
    billFuelCategoriesFromApi(Array.isArray(data) ? data : [])
  )
}

export async function fetchAquacultureInvoiceIncomeForEntity(
  entityKey: string
): Promise<AquacultureInvoiceIncomeCategory[]> {
  const key = scopedCacheKey('/aquaculture/income-types/', entityKey)
  const cached = readCache<AquacultureInvoiceIncomeCategory>(key)
  if (cached) return cached
  const { data } = await api.get('/aquaculture/income-types/', {
    params: entityScopeParamsFromKey(entityKey),
  })
  return writeCache(key, invoiceAquacultureIncomeFromApi(Array.isArray(data) ? data : []))
}

export async function fetchFuelInvoiceIncomeForEntity(
  entityKey: string
): Promise<FuelStationInvoiceIncomeCategory[]> {
  const key = scopedCacheKey('/fuel-station/income-categories/', entityKey)
  const cached = readCache<FuelStationInvoiceIncomeCategory>(key)
  if (cached) return cached
  const { data } = await api.get('/fuel-station/income-categories/', {
    params: entityScopeParamsFromKey(entityKey),
  })
  return writeCache(
    key,
    invoiceFuelCategoriesFromApi(Array.isArray(data) ? data : [])
  )
}

export function useEntityScopedBillExpenseCategories(
  entityKey: string,
  entityKind: 'office' | 'station' | 'pond'
): { categories: AquacultureBillExpenseCategory[]; loading: boolean } {
  const [categories, setCategories] = useState<AquacultureBillExpenseCategory[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (entityKind !== 'pond') {
      setCategories([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetchAquacultureBillExpenseCategoriesForEntity(entityKey)
      .then((rows) => {
        if (!cancelled) setCategories(rows)
      })
      .catch(() => {
        if (!cancelled) setCategories([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entityKey, entityKind])

  return { categories, loading }
}

export function useEntityScopedFuelBillExpenseCategories(
  entityKey: string,
  entityKind: 'office' | 'station' | 'pond'
): { categories: FuelStationBillExpenseCategory[]; loading: boolean } {
  const [categories, setCategories] = useState<FuelStationBillExpenseCategory[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (entityKind !== 'station') {
      setCategories([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetchFuelBillExpenseCategoriesForEntity(entityKey)
      .then((rows) => {
        if (!cancelled) setCategories(rows)
      })
      .catch(() => {
        if (!cancelled) setCategories([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entityKey, entityKind])

  return { categories, loading }
}

export function useEntityScopedInvoiceIncomeCategories(
  entityKey: string,
  entityKind: 'office' | 'station' | 'pond'
): {
  pondCategories: AquacultureInvoiceIncomeCategory[]
  stationCategories: FuelStationInvoiceIncomeCategory[]
  loading: boolean
} {
  const [pondCategories, setPondCategories] = useState<AquacultureInvoiceIncomeCategory[]>([])
  const [stationCategories, setStationCategories] = useState<FuelStationInvoiceIncomeCategory[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (entityKind === 'office') {
      setPondCategories([])
      setStationCategories([])
      return
    }
    let cancelled = false
    setLoading(true)
    const task =
      entityKind === 'pond'
        ? fetchAquacultureInvoiceIncomeForEntity(entityKey).then((rows) => {
            if (!cancelled) {
              setPondCategories(rows)
              setStationCategories([])
            }
          })
        : fetchFuelInvoiceIncomeForEntity(entityKey).then((rows) => {
            if (!cancelled) {
              setStationCategories(rows)
              setPondCategories([])
            }
          })
    task
      .catch(() => {
        if (!cancelled) {
          setPondCategories([])
          setStationCategories([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entityKey, entityKind])

  return { pondCategories, stationCategories, loading }
}
