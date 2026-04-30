"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import Sidebar from "@/components/Sidebar"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useToast } from "@/components/Toast"
import { extractErrorMessage } from "@/utils/errorHandler"
import Modal from "@/components/ui/Modal"
import api, { getApiBaseUrl } from "@/lib/api"
import { useCompany } from "@/contexts/CompanyContext"
import { getCurrencySymbol, formatNumber } from "@/utils/currency"
import { formatDate } from "@/utils/date"
import { getPosSaleScope, isLimitedPosRegisterUser, type PosSaleScope } from "@/utils/rbac"
import { escapeHtml, printDocument, printLedgerStatement } from "@/utils/printDocument"
import { loadPrintBranding } from "@/utils/printBranding"
import type { LedgerPayload } from "@/components/ContactLedgerPage"
import {
  Banknote,
  Building2,
  CheckCircle,
  ChevronDown,
  Clock,
  Fuel,
  HeartHandshake,
  Keyboard,
  Layers,
  Loader2,
  LogOut,
  PlusCircle,
  Printer,
  Search,
  ShoppingCart,
  Store,
  Wallet,
  X,
  XCircle,
} from "lucide-react"
import { CashierCollectPayment } from "./CashierCollectPayment"
import { CashierDonation } from "./CashierDonation"
import { CashierPayBills } from "./CashierPayBills"

const inputClassName =
  "w-full min-h-11 touch-manipulation rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-10"
const selectClassName =
  "w-full min-h-11 touch-manipulation rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-10"

/** Visual + layout metadata per register scope (server-enforced). */
const POS_SCOPE_UI: Record<
  PosSaleScope,
  {
    badgeClass: string
    loadingHint: string
    shell: string
    grid: string
    primarySpan: string
    checkoutSpan: string
    checkoutSticky: string
  }
> = {
  both: {
    badgeClass:
      "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200 sm:text-xs",
    loadingHint: "Preparing forecourt, catalog, and tills…",
    shell: "w-full max-w-[1600px] mx-auto",
    grid: "grid grid-cols-1 gap-5 sm:gap-6 xl:grid-cols-12 xl:items-start xl:gap-6 2xl:gap-8",
    primarySpan: "min-w-0 xl:col-span-7",
    checkoutSpan: "min-w-0 xl:col-span-5",
    checkoutSticky:
      "xl:sticky xl:top-3 xl:z-[5] xl:max-h-[min(100dvh,100vh)] xl:overflow-y-auto xl:overflow-x-hidden xl:overscroll-contain xl:pr-0.5 xl:pb-2",
  },
  general: {
    badgeClass:
      "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-900 dark:text-emerald-100 sm:text-xs",
    loadingHint: "Preparing your retail catalog…",
    shell: "w-full max-w-5xl mx-auto",
    grid: "grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-12 lg:items-start lg:gap-6 2xl:gap-8",
    primarySpan: "min-w-0 lg:col-span-7",
    checkoutSpan: "min-w-0 lg:col-span-5",
    checkoutSticky:
      "lg:sticky lg:top-3 lg:z-[5] lg:max-h-[min(100dvh,100vh)] lg:overflow-y-auto lg:overflow-x-hidden lg:overscroll-contain lg:pr-0.5 lg:pb-2",
  },
  fuel: {
    badgeClass:
      "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-100 sm:text-xs",
    loadingHint: "Preparing pumps, nozzles, and prices…",
    shell: "w-full max-w-[1600px] mx-auto",
    grid: "grid grid-cols-1 gap-5 sm:gap-6 xl:grid-cols-12 xl:items-start xl:gap-6 2xl:gap-8",
    primarySpan: "min-w-0 xl:col-span-7",
    checkoutSpan: "min-w-0 xl:col-span-5",
    checkoutSticky:
      "xl:sticky xl:top-3 xl:z-[5] xl:max-h-[min(100dvh,100vh)] xl:overflow-y-auto xl:overflow-x-hidden xl:overscroll-contain xl:pr-0.5 xl:pb-2",
  },
}

type Company = {
  id: number
  company_name: string
  name?: string
  address?: string
}

function mapCompanyFromApi(data: Record<string, unknown> | null | undefined): Company | null {
  if (!data || typeof data !== "object") return null
  const id = data.id
  if (typeof id !== "number") return null
  const label =
    (typeof data.company_name === "string" && data.company_name) ||
    (typeof data.name === "string" && data.name) ||
    ""
  return {
    id,
    company_name: label,
    name: typeof data.name === "string" ? data.name : undefined,
    address: typeof data.address === "string" ? data.address : undefined,
  }
}

type Customer = {
  id: number
  display_name: string
}

type Nozzle = {
  id: number
  nozzle_number: string
  nozzle_name?: string
  product_name: string
  product_price: number
  product_unit?: string
  station_id?: number
  station_name?: string
  station_number?: string
  island_name?: string
  island_number?: string
  dispenser_name?: string
  dispenser_number?: string
  meter_name?: string
  meter_number?: string
  current_reading?: number
  current_stock?: number
  tank_id?: number
  tank_name?: string
  tank_number?: string
  tank_capacity?: number
  color_code?: string
  is_operational?: boolean
}

type BankRegister = {
  id: number
  account_name: string
  bank_name?: string
  chart_account_id?: number | null
  is_active?: boolean
  is_equity_register?: boolean
  current_balance?: string | number | null
}

type Vendor = {
  id: number
  display_name: string
}

type POSItem = {
  id: number
  name: string
  item_type: string
  pos_category?: string
  unit?: string
  unit_price?: number
  quantity_on_hand?: number
  barcode?: string
  is_pos_available?: boolean
  image_url?: string
}

/** Response from GET /inventory/availability/?item_id= (shop / station bins). */
type ShopStationStockAvailability =
  | {
      item_id: number
      name: string
      tracks_per_station: true
      unit: string
      total_on_hand: string
      stations: {
        station_id: number
        station_name: string
        station_number: string
        quantity: string
      }[]
    }
  | {
      item_id: number
      name: string
      tracks_per_station: false
      message?: string
      stations: unknown[]
    }

function posItemSupportsShopStationStockView(item: POSItem): boolean {
  if (item.item_type?.toLowerCase() !== "inventory") return false
  return (item.pos_category || "").toLowerCase() !== "fuel"
}

type CartEntry = {
  item: POSItem
  quantity: number
  unitPrice: number
  discountPercent: number
}

type CartTotals = {
  subtotal: number
  discountTotal: number
  paymentTotal: number
  total: number
  hasNegativeTotal: boolean
}

type StationOption = {
  id: number
  station_name: string
  station_number?: string
}

const roundTwo = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100

/** POS payment method → API sends lowercase (e.g. on_account). */
const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  TRANSFER: "Bank transfer",
  MOBILE_MONEY: "Mobile money",
  ON_ACCOUNT: "On account (A/R)",
  MIXED: "Mixed (pay now + A/R)",
}

const computeCartTotals = (entries: CartEntry[]): CartTotals => {
  if (!entries.length) {
    return {
      subtotal: 0,
      discountTotal: 0,
      paymentTotal: 0,
      total: 0,
      hasNegativeTotal: false,
    }
  }

  let subtotal = 0
  let discountTotal = 0
  let paymentTotal = 0

  for (const entry of entries) {
    const { item, quantity, unitPrice, discountPercent } = entry
    const lineAmount = roundTwo(quantity * unitPrice)

    if (item.item_type === "discount") {
      discountTotal += Math.abs(lineAmount)
      continue
    }

    if (item.item_type === "payment") {
      paymentTotal += Math.abs(lineAmount)
      continue
    }

    subtotal += lineAmount

    if (discountPercent > 0) {
      discountTotal += roundTwo(lineAmount * (discountPercent / 100))
    }
  }

  const total = roundTwo(subtotal - discountTotal - paymentTotal)

  return {
    subtotal: roundTwo(subtotal),
    discountTotal: roundTwo(discountTotal),
    paymentTotal: roundTwo(paymentTotal),
    total,
    hasNegativeTotal: total < 0,
  }
}

export default function CashierPOSPage() {
  const router = useRouter()
  const toast = useToast()
  const { selectedCompany } = useCompany()

  /** What this login may sell: from localStorage user (set at login). */
  const posSaleScope: PosSaleScope = getPosSaleScope()
  const showNozzleColumn = posSaleScope !== "general"
  const showCatalog = posSaleScope !== "fuel"
  const showFuelDispensePanel = posSaleScope !== "general"
  const scopeUi = POS_SCOPE_UI[posSaleScope]

  const [loading, setLoading] = useState(true)
  const [currencySymbol, setCurrencySymbol] = useState<string>("৳") // Default to BDT
  
  // Get API base URL for image construction
  const getImageUrl = (imageUrl: string | undefined): string | null => {
    if (!imageUrl) return null
    if (imageUrl.startsWith('http')) return imageUrl
    const apiBaseUrl = getApiBaseUrl()
    const baseUrl = apiBaseUrl.replace('/api', '') // Remove /api suffix to get base URL
    return `${baseUrl}${imageUrl}`
  }

  const [company, setCompany] = useState<Company | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [nozzles, setNozzles] = useState<Nozzle[]>([])
  const [stations, setStations] = useState<StationOption[]>([])
  /** Shop stock / selling location for general lines (server also uses shift and fuel nozzle). */
  const [posStationId, setPosStationId] = useState<number | null>(null)
  const [posItems, setPosItems] = useState<POSItem[]>([])

  const [selectedNozzle, setSelectedNozzle] = useState<Nozzle | null>(null)
  const [selectedItem, setSelectedItem] = useState<POSItem | null>(null)
  const [quantity, setQuantity] = useState("")
  const [amount, setAmount] = useState("")
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [paymentMethod, setPaymentMethod] = useState("CASH")
  /** When set, GL debits this bank register's chart line (see Chart of Accounts → bank link). */
  const [depositBankId, setDepositBankId] = useState<number | "">("")
  /** With Cash/Card/etc., amount collected now; if below total, rest stays on A/R (split tender). */
  const [amountPaidNow, setAmountPaidNow] = useState("")
  const [bankRegisters, setBankRegisters] = useState<BankRegister[]>([])
  const [vehiclePlate, setVehiclePlate] = useState("")

  const [cartEntries, setCartEntries] = useState<CartEntry[]>([])
  const [itemSearch, setItemSearch] = useState("")
  const [customerFilter, setCustomerFilter] = useState("")
  const [now, setNow] = useState(() => new Date())
  const [showShortcuts, setShowShortcuts] = useState(false)
  const itemSearchRef = useRef<HTMLInputElement | null>(null)
  const [showInvoicePreview, setShowInvoicePreview] = useState(false)
  /** Per-station shop QOH (read-only); same API as Inventory → Stock by station. */
  const [stationStockItem, setStationStockItem] = useState<POSItem | null>(null)
  const [stationStockData, setStationStockData] = useState<ShopStationStockAvailability | null>(null)
  const [stationStockLoading, setStationStockLoading] = useState(false)
  const [printMenuOpen, setPrintMenuOpen] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  /** New sale vs collect A/R vs pay A/P. */
  const [posMode, setPosMode] = useState<"sale" | "collect" | "pay" | "donation">("sale")
  const printMenuRef = useRef<HTMLDivElement | null>(null)
  const shortcutsRef = useRef<HTMLDivElement | null>(null)
  const handleUnifiedSaleRef = useRef<() => Promise<void>>(async () => {})
  /** Mirrors Complete sale button enablement so F9 / Ctrl+Enter cannot bypass it. */
  const canCompleteUnifiedSaleRef = useRef(false)
  /** Avoid POSTing line items from company A after superadmin switched context to company B. */
  const prevTenantCompanyIdRef = useRef<number | undefined>(undefined)
  const limitedPosRegister = isLimitedPosRegisterUser()

  useEffect(() => {
    if (selectedNozzle?.station_id != null) {
      const sid = Number(selectedNozzle.station_id)
      if (Number.isFinite(sid)) setPosStationId(sid)
    }
  }, [selectedNozzle])

  useEffect(() => {
    if (!stationStockItem) {
      setStationStockData(null)
      setStationStockLoading(false)
      return
    }
    let cancelled = false
    setStationStockLoading(true)
    setStationStockData(null)
    void api
      .get<ShopStationStockAvailability>("/inventory/availability/", {
        params: { item_id: stationStockItem.id },
      })
      .then(res => {
        if (!cancelled) setStationStockData(res.data)
      })
      .catch(err => {
        if (!cancelled)
          toast.error(extractErrorMessage(err, "Could not load stock by station"))
      })
      .finally(() => {
        if (!cancelled) setStationStockLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [stationStockItem, toast])

  useEffect(() => {
    if (!limitedPosRegister) return
    if (posMode === "collect" || posMode === "pay") setPosMode("sale")
  }, [limitedPosRegister, posMode])

  useEffect(() => {
    const tid = selectedCompany?.id ?? undefined
    const prev = prevTenantCompanyIdRef.current
    if (prev !== undefined && prev !== tid) {
      setCartEntries([])
      setCustomerId(null)
      setAmountPaidNow("")
      setDepositBankId("")
      setQuantity("")
      setAmount("")
      setVehiclePlate("")
      setShowInvoicePreview(false)
      setPosMode("sale")
    }
    prevTenantCompanyIdRef.current = tid
  }, [selectedCompany?.id])

  useEffect(() => {
    const token = localStorage.getItem("access_token")
    if (!token) {
      router.push("/login")
      return
    }

    loadInitialData()
    // Re-load POS when superadmin switches tenant (localStorage + X-Selected-Company-Id)
  }, [router, selectedCompany?.id])

  useEffect(() => {
    if (!printMenuOpen) return
    const close = (e: MouseEvent) => {
      const el = printMenuRef.current
      if (el && !el.contains(e.target as Node)) setPrintMenuOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [printMenuOpen])

  useEffect(() => {
    if (!showShortcuts) return
    const close = (e: MouseEvent) => {
      const el = shortcutsRef.current
      if (el && !el.contains(e.target as Node)) setShowShortcuts(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [showShortcuts])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      if (!el || !(el instanceof HTMLElement)) return false
      if (el.isContentEditable) return true
      const tag = el.tagName
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showInvoicePreview) {
          e.preventDefault()
          setShowInvoicePreview(false)
        } else if (printMenuOpen) {
          e.preventDefault()
          setPrintMenuOpen(false)
        } else if (showShortcuts) {
          e.preventDefault()
          setShowShortcuts(false)
        }
        return
      }
      if (e.key === "?" && !isEditable(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setShowShortcuts(o => !o)
        return
      }
      if (e.key === "/" && !isEditable(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!showCatalog) return
        e.preventDefault()
        itemSearchRef.current?.focus()
        itemSearchRef.current?.select()
        return
      }
      if (e.key === "F9" || ((e.ctrlKey || e.metaKey) && e.key === "Enter")) {
        if (posMode !== "sale") return
        if (showInvoicePreview || printMenuOpen) return
        if (isEditable(e.target) && e.key !== "F9") return
        if (!canCompleteUnifiedSaleRef.current) return
        e.preventDefault()
        void handleUnifiedSaleRef.current()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [posMode, showInvoicePreview, printMenuOpen, showShortcuts, showCatalog])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem("access_token")
      if (!token) {
        router.push("/login")
        return
      }

      const scope = getPosSaleScope()
      const [nozzleRes, customerRes, vendorRes, companyRes, itemRes, tanksRes, banksRes, stationsRes] =
        await Promise.all([
          scope !== "general" ? api.get("/nozzles/details/") : Promise.resolve({ data: [] }),
          api.get("/customers/"),
          api.get("/vendors/", { params: { skip: 0, limit: 10000 } }),
          api.get("/companies/current/"),
          scope !== "fuel" ? api.get("/items/", { params: { pos_only: "true" } }) : Promise.resolve({ data: [] }),
          scope !== "fuel" ? api.get("/tanks/") : Promise.resolve({ data: [] }),
          api.get("/bank-accounts/"),
          api.get("/stations/"),
        ])

      const banksRaw = Array.isArray(banksRes.data) ? banksRes.data : []
      setBankRegisters(
        banksRaw
          .filter(
            (b: BankRegister & { id?: unknown }) =>
              b &&
              b.is_active !== false &&
              (typeof b.id === "number" || typeof b.id === "string")
          )
          .map((b: BankRegister & { id?: unknown; is_equity_register?: boolean; current_balance?: unknown }) => ({
            ...b,
            id: typeof b.id === "string" ? Number(b.id) : b.id,
            is_equity_register: b.is_equity_register === true,
            current_balance: b.current_balance,
          }))
          .filter((b: BankRegister) => Number.isFinite(b.id))
      )

      const stationsData = Array.isArray(stationsRes.data) ? stationsRes.data : []
      const stationOptions: StationOption[] = stationsData
        .map(
          (s: { id?: unknown; station_name?: string; station_number?: string }) => ({
            id: typeof s.id === "number" ? s.id : Number(s.id),
            station_name: (s.station_name && String(s.station_name).trim()) || "Station",
            station_number: s.station_number != null ? String(s.station_number) : undefined,
          })
        )
        .filter(s => Number.isFinite(s.id))
      setStations(stationOptions)

      const nozzlesData = Array.isArray(nozzleRes.data) ? nozzleRes.data : []
      setNozzles(nozzlesData)
      if (nozzlesData.length === 0) {
        setSelectedNozzle(null)
        setQuantity("")
        setAmount("")
      } else {
        setSelectedNozzle(prev => {
          const match = prev
            ? nozzlesData.find(n => Number(n.id) === Number(prev.id))
            : undefined
          return match ?? nozzlesData[0]
        })
      }

      {
        const firstN = nozzlesData[0] as (Nozzle & { station_id?: number }) | undefined
        const fromNozzle =
          firstN && firstN.station_id != null && Number.isFinite(Number(firstN.station_id))
            ? Number(firstN.station_id)
            : null
        const fromList = stationOptions[0]?.id ?? null
        setPosStationId(fromNozzle ?? fromList)
      }

      setCustomers(Array.isArray(customerRes.data) ? customerRes.data : [])

      const rawVendors = Array.isArray(vendorRes.data) ? vendorRes.data : []
      setVendors(
        rawVendors
          .map((v: { id?: unknown; display_name?: string; company_name?: string; is_active?: boolean }) => {
            const id = typeof v.id === "number" ? v.id : Number(v.id)
            if (!Number.isFinite(id) || v.is_active === false) return null
            const label =
              (v.display_name || v.company_name || `Vendor #${id}`).trim() || `Vendor #${id}`
            return { id, display_name: label }
          })
          .filter((v: Vendor | null): v is Vendor => v != null)
      )

      const mapped = mapCompanyFromApi(companyRes.data as Record<string, unknown>)
      if (mapped) {
        setCompany(mapped)
        const cur = (companyRes.data as { currency?: string })?.currency
        if (cur) {
          setCurrencySymbol(getCurrencySymbol(cur))
        }
      }

      let tankProductIds: Set<number> = new Set()
      const tanksData = Array.isArray(tanksRes.data) ? tanksRes.data : []
      tankProductIds = new Set(
        tanksData
          .map((tank: { product_id?: unknown }) => tank.product_id)
          .filter((id: unknown) => id !== null && id !== undefined)
          .map((id: unknown) => Number(id))
          .filter((id: number) => Number.isFinite(id))
      )

      const rawItems = itemRes.data
      const itemsList = Array.isArray(rawItems) ? rawItems : (rawItems?.items || [])
      const generalItems = itemsList.filter((item: POSItem) => {
        const itemPk = Number(item.id)
        const isNotLinkedToTank = !Number.isFinite(itemPk) || !tankProductIds.has(itemPk)
        const allowedCategories = ["general", "service", "other"]
        const cat = (item.pos_category || "").trim().toLowerCase()
        const hasAllowedCategory = allowedCategories.includes(cat)
        const isAvailable = item.is_pos_available !== false
        const isNotFuel = cat !== "fuel"
        return isNotLinkedToTank && hasAllowedCategory && isAvailable && isNotFuel
      })
      setPosItems(generalItems)
    } catch (error: any) {
      if (error.response?.status === 401) {
        localStorage.removeItem("access_token")
        router.push("/login")
        toast.error("Session expired. Please login again.")
        return
      }
      console.error("Error loading cashier data", error)
      toast.error("Unable to load POS data. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleNozzleSelect = (nozzle: Nozzle) => {
    setSelectedNozzle(nozzle)
    setQuantity("")
    setAmount("")
  }

  const handleQuantityChange = (value: string) => {
    if (!selectedNozzle) {
      setQuantity(value)
      return
    }

    const safeValue = value.replace(/[^0-9.]/g, "")
    setQuantity(safeValue)

    if (!safeValue) {
      setAmount("")
      return
    }

    const qty = parseFloat(safeValue)
    const price = selectedNozzle.product_price || 0
    setAmount(price ? roundTwo(qty * price).toString() : "")
  }

  const handleAmountChange = (value: string) => {
    if (!selectedNozzle) {
      setAmount(value)
      return
    }

    const safeValue = value.replace(/[^0-9.]/g, "")
    setAmount(safeValue)

    if (!safeValue) {
      setQuantity("")
      return
    }

    const amountNumber = parseFloat(safeValue)
    const price = selectedNozzle.product_price || 0
    const qty = price > 0 ? roundTwo(amountNumber / price) : 0
    setQuantity(qty ? qty.toString() : "")
  }

  const addItemToCart = (item: POSItem) => {
    // Set selected item for visual feedback
    setSelectedItem(item)
    
    setCartEntries(prev => {
      const existing = prev.find(entry => entry.item.id === item.id)
      if (existing) {
        return prev.map(entry =>
          entry.item.id === item.id
            ? {
                ...entry,
                quantity: roundTwo(entry.quantity + 1),
                unitPrice: entry.unitPrice || item.unit_price || 0,
              }
            : entry
        )
      }

      return [
        ...prev,
        {
          item,
          quantity: 1,
          unitPrice: item.unit_price || 0,
          discountPercent: 0,
        },
      ]
    })
  }

  const updateCartQuantity = (itemId: number, value: number) => {
    setCartEntries(prev =>
      prev.map(entry =>
        entry.item.id === itemId
          ? { ...entry, quantity: Math.max(value, 0) }
          : entry
      )
    )
  }

  const updateCartPrice = (itemId: number, value: number) => {
    setCartEntries(prev =>
      prev.map(entry =>
        entry.item.id === itemId
          ? { ...entry, unitPrice: Math.max(value, 0) }
          : entry
      )
    )
  }

  const updateCartDiscount = (itemId: number, value: number) => {
    setCartEntries(prev =>
      prev.map(entry =>
        entry.item.id === itemId
          ? {
              ...entry,
              discountPercent: Math.min(Math.max(value, 0), 100),
            }
          : entry
      )
    )
  }

  const removeCartItem = (itemId: number) => {
    setCartEntries(prev => prev.filter(entry => entry.item.id !== itemId))
    // Clear selection if the removed item was selected
    if (selectedItem?.id === itemId) {
      setSelectedItem(null)
    }
  }

  const cartTotals = useMemo(
    () => computeCartTotals(cartEntries),
    [cartEntries]
  )

  const isOnAccount = paymentMethod === "ON_ACCOUNT"
  const paymentMethodLabel =
    PAYMENT_LABELS[paymentMethod] ?? paymentMethod.replace(/_/g, " ")

  const selectedUnit = selectedNozzle?.product_unit || "L"
  const unitPrice = selectedNozzle?.product_price || 0
  const quantityNumber = quantity ? parseFloat(quantity) || 0 : 0
  const computedAmount = roundTwo(quantityNumber * unitPrice)
  const amountNumber = amount ? parseFloat(amount) || 0 : computedAmount
  const pendingFuelAmount =
    selectedNozzle && quantityNumber > 0 ? amountNumber : 0
  const grandTotal = useMemo(
    () => roundTwo(cartTotals.total + pendingFuelAmount),
    [cartTotals.total, pendingFuelAmount]
  )

  const parsedAmountPaidNow = useMemo(() => {
    const t = amountPaidNow.trim()
    if (!t) return null
    const n = parseFloat(t)
    if (!Number.isFinite(n) || n < 0) return null
    return roundTwo(n)
  }, [amountPaidNow])

  const isSplitPayment =
    !isOnAccount &&
    parsedAmountPaidNow !== null &&
    parsedAmountPaidNow > 0 &&
    parsedAmountPaidNow < grandTotal

  const splitBalanceOnAR =
    isSplitPayment && parsedAmountPaidNow !== null
      ? roundTwo(grandTotal - parsedAmountPaidNow)
      : null

  const displayPaymentMethodLabel = isSplitPayment
    ? `${PAYMENT_LABELS.MIXED} (${currencySymbol}${formatNumber(
        parsedAmountPaidNow ?? 0
      )} now, ${currencySymbol}${formatNumber(splitBalanceOnAR ?? 0)} on A/R)`
    : paymentMethodLabel

  /** Must match backend: customer exists for resolved company (avoids 400 after tenant switch / stale id). */
  const hasValidNamedCustomer = useMemo(() => {
    if (customerId == null) return false
    const id = Number(customerId)
    if (!Number.isFinite(id)) return false
    return customers.some(c => Number(c.id) === id)
  }, [customerId, customers])

  const canCompleteUnifiedSale =
    Number.isFinite(grandTotal) &&
    grandTotal > 0 &&
    !(cartEntries.length > 0 && cartTotals.hasNegativeTotal) &&
    !(isOnAccount && !hasValidNamedCustomer) &&
    !(isSplitPayment && !hasValidNamedCustomer)

  canCompleteUnifiedSaleRef.current = canCompleteUnifiedSale

  const meterStart = selectedNozzle?.current_reading || 0
  const meterProjected = roundTwo(meterStart + quantityNumber)
  const tankStart = selectedNozzle?.current_stock || 0
  const tankProjected = roundTwo(Math.max(tankStart - quantityNumber, 0))
  const tankCapacity = selectedNozzle?.tank_capacity || 0
  const tankFillPercent =
    tankCapacity > 0 ? Math.max(0, Math.min(100, (tankStart / tankCapacity) * 100)) : 0
  const tankProjectedPercent =
    tankCapacity > 0
      ? Math.max(0, Math.min(100, (tankProjected / tankCapacity) * 100))
      : 0
  const shouldShowLivePreview = !!selectedNozzle && quantityNumber > 0

  const filteredItems = useMemo(() => {
    if (!itemSearch) return posItems
    const keyword = itemSearch.toLowerCase()
    return posItems.filter(item =>
      [
        item.name,
        item.pos_category || "",
        item.barcode || "",
        item.item_type || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    )
  }, [itemSearch, posItems])

  const filteredCustomers = useMemo(() => {
    const q = customerFilter.trim().toLowerCase()
    let list = !q ? customers : customers.filter(c => c.display_name.toLowerCase().includes(q))
    if (customerId != null) {
      const selected = customers.find(c => c.id === customerId)
      if (selected && !list.some(c => c.id === customerId)) {
        list = [selected, ...list]
      }
    }
    return list
  }, [customers, customerFilter, customerId])

  const applyQuickFuelQty = (qty: number) => {
    if (!selectedNozzle || qty <= 0) return
    handleQuantityChange(String(qty))
  }

  const handleUnifiedSale = async () => {
    const fuelLines: { nozzle_id: number; quantity: number; amount: number }[] = []
    if (selectedNozzle && quantity) {
      const qty = parseFloat(quantity)
      const q = roundTwo(qty)
      const amt = roundTwo(amountNumber)
      if (Number.isFinite(q) && q > 0) {
        fuelLines.push({
          nozzle_id: Number(selectedNozzle.id),
          quantity: q,
          amount: Number.isFinite(amt) ? amt : roundTwo(q * (selectedNozzle.product_price || 0)),
        })
      }
    }

    const validItems = cartEntries
      .filter(entry => entry.quantity > 0)
      .map(entry => ({
        item_id: Number(entry.item.id),
        quantity: roundTwo(entry.quantity),
        unit_price: entry.unitPrice > 0 ? roundTwo(entry.unitPrice) : null,
        discount_percent:
          entry.item.item_type === "discount" ||
          entry.item.item_type === "payment"
            ? 0
            : Math.min(Math.max(entry.discountPercent, 0), 100),
      }))

    const catalogIdSet = new Set(posItems.map(p => Number(p.id)))
    if (validItems.some(row => !catalogIdSet.has(Number(row.item_id)))) {
      toast.error(
        "Cart has products that are not in the current catalog (e.g. after switching company). Clear the cart or reload."
      )
      return
    }

    if (fuelLines.length > 0) {
      const nozzleIdSet = new Set(nozzles.map(n => Number(n.id)))
      if (fuelLines.some(fl => !nozzleIdSet.has(Number(fl.nozzle_id)))) {
        toast.error(
          "Selected nozzle is not valid for this company (e.g. after switching tenant). Clear fuel selection or reload the page."
        )
        return
      }
    }

    if (fuelLines.length === 0 && validItems.length === 0) {
      toast.error(
        "Add fuel (nozzle + quantity) and/or products to the cart before completing the sale."
      )
      return
    }

    if (!Number.isFinite(grandTotal) || grandTotal <= 0) {
      toast.error("Total must be a valid positive amount. Check quantities, prices, and fuel inputs.")
      return
    }

    if (isOnAccount && !hasValidNamedCustomer) {
      toast.error(
        "On-account (A/R) requires a customer from the list for this company. Choose a credit customer (not Walk-in), or refresh after switching company."
      )
      return
    }

    if (isSplitPayment && !hasValidNamedCustomer) {
      toast.error(
        "Split payment (pay part now, rest on account) requires a customer from the list for this company."
      )
      return
    }

    if (!isOnAccount && amountPaidNow.trim() !== "" && parsedAmountPaidNow === null) {
      toast.error('Enter a valid number for "Pay now", or leave it blank for full settlement.')
      return
    }

    try {
      const payload: Record<string, unknown> = {
        sale_type: "general",
        payment_method: paymentMethod.toLowerCase(),
        items: validItems,
        fuel_lines: fuelLines,
      }
      if (hasValidNamedCustomer) {
        payload.customer_id = customerId as number
      }
      if (
        !isOnAccount &&
        depositBankId !== "" &&
        typeof depositBankId === "number" &&
        Number.isFinite(depositBankId) &&
        depositBankId > 0
      ) {
        payload.bank_account_id = depositBankId
      }
      if (isSplitPayment && parsedAmountPaidNow !== null) {
        payload.amount_paid_now = parsedAmountPaidNow
      }
      if (posStationId != null && Number.isFinite(posStationId)) {
        payload.station_id = posStationId
      }

      const res = await api.post("/cashier/pos/", payload)
      const msg = res.data?.detail
      toast.success(typeof msg === "string" ? msg : "Sale completed successfully.")
      setCartEntries([])
      setSelectedItem(null)
      setQuantity("")
      setAmount("")
      setSelectedNozzle(null)
      setCustomerId(null)
      setPaymentMethod("CASH")
      setAmountPaidNow("")
      setVehiclePlate("")
      setShowInvoicePreview(false)
      await loadInitialData()
    } catch (error: unknown) {
      const message = extractErrorMessage(
        error,
        "Sale could not be completed. Check your connection and try again."
      )
      if (
        process.env.NODE_ENV === "development" &&
        error &&
        typeof error === "object" &&
        "response" in error
      ) {
        const res = (error as { response?: { status?: number; data?: unknown } }).response
        if (res?.status === 400) {
          const raw = res.data
          const body =
            raw !== null && typeof raw === "object"
              ? JSON.stringify(raw)
              : String(raw ?? "")
          // Single-line string so DevTools shows the message (objects often render as "Object")
          console.warn(`[cashier/pos] 400 ${body}`)
        }
      }
      toast.error(message)
    }
  }

  handleUnifiedSaleRef.current = handleUnifiedSale

  const handleLogout = () => {
    localStorage.removeItem("access_token")
    localStorage.removeItem("refresh_token")
    localStorage.removeItem("user")
    router.push("/login")
  }

  const posCompanyLabel =
    (company?.company_name || "").trim() || selectedCompany?.name?.trim() || "Company"
  const posCompanyAddress = (company?.address || "").trim()

  const openPosPrintWindow = async (docTitle: string, bodyHtml: string, stationNameOverride?: string | null) => {
    const branding = await loadPrintBranding(api, stationNameOverride)
    const ok = printDocument({ title: docTitle, bodyHtml, branding })
    if (!ok) toast.error("Allow pop-ups in your browser to print.")
    return ok
  }

  const canPrintUnifiedDraft = Number.isFinite(grandTotal) && grandTotal > 0

  const printUnifiedDraft = () => {
    if (!Number.isFinite(grandTotal) || grandTotal <= 0) {
      toast.error("Add fuel and/or products with a positive total before printing.")
      return
    }
    const stationForPrint = (selectedNozzle?.station_name || "").trim() || null
    const custLabel = customerId
      ? customers.find(c => c.id === customerId)?.display_name || `ID ${customerId}`
      : "Walk-in"
    const inv = `POS-${String(Date.now()).slice(-8)}`
    const fuelRow =
      selectedNozzle && quantityNumber > 0
        ? `<tr>
          <td>${escapeHtml(selectedNozzle.product_name)} <span class="muted">(fuel)</span></td>
          <td class="right">${escapeHtml(formatNumber(quantityNumber))} ${escapeHtml(selectedUnit)}</td>
          <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(unitPrice))}</td>
          <td class="right">—</td>
          <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(amountNumber))}</td>
        </tr>`
        : ""
    const productRows = cartEntries
      .map(entry => {
        const lineAmount = roundTwo(entry.quantity * entry.unitPrice)
        const discountAmount = roundTwo(lineAmount * (entry.discountPercent / 100))
        const finalAmount = roundTwo(lineAmount - discountAmount)
        return `<tr>
          <td>${escapeHtml(entry.item.name)}</td>
          <td class="right">${escapeHtml(formatNumber(entry.quantity))} ${escapeHtml(entry.item.unit || "units")}</td>
          <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(entry.unitPrice))}</td>
          <td class="right">${entry.discountPercent > 0 ? escapeHtml(formatNumber(entry.discountPercent)) + "%" : "—"}</td>
          <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(finalAmount))}</td>
        </tr>`
      })
      .join("")
    const body = `
      <div class="co">
        <h1>Invoice (draft) — POS</h1>
        <p class="muted">Printed ${escapeHtml(formatDate(new Date(), true))}</p>
      </div>
      <p class="muted">Customer: ${escapeHtml(custLabel)} · Payment: ${escapeHtml(
      displayPaymentMethodLabel
    )}${vehiclePlate ? ` · Vehicle: ${escapeHtml(vehiclePlate.toUpperCase())}` : ""}</p>
      <p class="muted">Ref ${escapeHtml(inv)}</p>
      <table><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit price</th><th class="right">Disc.</th><th class="right">Amount</th></tr></thead><tbody>
      ${fuelRow}
      ${productRows}
      </tbody></table>
      <table><tbody>
      ${
        pendingFuelAmount > 0 && cartEntries.length > 0
          ? `<tr><td>Products subtotal</td><td class="right">${escapeHtml(currencySymbol)}${escapeHtml(
              formatNumber(cartTotals.total)
            )}</td></tr>`
          : ""
      }
      <tr class="row-total"><td>Total due</td><td class="right">${escapeHtml(currencySymbol)}${escapeHtml(
      formatNumber(grandTotal)
    )}</td></tr>
      </tbody></table>`
    void openPosPrintWindow(`Invoice draft ${inv}`, body, stationForPrint)
  }

  const printDraftFromMenu = () => {
    setPrintMenuOpen(false)
    printUnifiedDraft()
  }

  const printPosSummaryReport = async () => {
    setPrintMenuOpen(false)
    setPrintBusy(true)
    try {
      const [statsRes, coRes] = await Promise.all([
        api.get("/dashboard/stats"),
        api.get("/companies/current/"),
      ])
      const s = statsRes.data || {}
      const today = formatDate(new Date())
      const sym = coRes.data?.currency
        ? getCurrencySymbol(String(coRes.data.currency))
        : currencySymbol
      const body = `
        <div class="co">
          <h1>POS summary report</h1>
          <p class="muted">Business date (server): ${escapeHtml(today)} · Generated ${escapeHtml(
        formatDate(new Date(), true)
      )}</p>
        </div>
        <p class="muted">Figures match the main dashboard for this company (invoice totals and counts).</p>
        <table><tbody>
          <tr><td>Today&apos;s sales (amount)</td><td class="right">${escapeHtml(sym)}${escapeHtml(
        formatNumber(Number(s.today_sales || 0))
      )}</td></tr>
          <tr><td>Today&apos;s invoices (count)</td><td class="right">${escapeHtml(
            String(s.today_sales_count ?? 0)
          )}</td></tr>
          <tr><td>Total customers</td><td class="right">${escapeHtml(String(s.total_customers ?? 0))}</td></tr>
          <tr><td>Total invoices (all time)</td><td class="right">${escapeHtml(String(s.total_invoices ?? 0))}</td></tr>
          <tr class="row-total"><td>Total invoiced revenue (all time)</td><td class="right">${escapeHtml(sym)}${escapeHtml(
        formatNumber(Number(s.total_revenue || 0))
      )}</td></tr>
        </tbody></table>`
      await openPosPrintWindow(`POS summary ${today}`, body, null)
    } catch {
      toast.error("Could not load dashboard figures for printing.")
    } finally {
      setPrintBusy(false)
    }
  }

  const printCustomerLedgerStatement = async () => {
    if (!customerId) {
      toast.error("Select a customer to print an A/R ledger statement.")
      return
    }
    setPrintMenuOpen(false)
    setPrintBusy(true)
    try {
      const res = await api.get<LedgerPayload>(`/customers/${customerId}/ledger/`)
      const data = res.data
      if (!data) {
        toast.error("No ledger data returned.")
        return
      }
      const branding = await loadPrintBranding(api, (selectedNozzle?.station_name || "").trim() || null)
      const ok = printLedgerStatement(
        {
          display_name: data.display_name,
          period_start_balance: data.period_start_balance,
          closing_balance: data.closing_balance,
          start_date: data.start_date ?? null,
          end_date: data.end_date ?? null,
          transactions: data.transactions,
        },
        {
          companyName: branding.companyName,
          companyAddress: branding.companyAddress,
          stationName: branding.stationName,
          currencySymbol,
          documentTitle: "Customer account statement",
          printedAt: formatDate(new Date(), true),
          branding,
        }
      )
      if (!ok) toast.error("Allow pop-ups in your browser to print.")
    } catch {
      toast.error("Could not load customer ledger for printing.")
    } finally {
      setPrintBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="page-with-sidebar flex h-screen bg-background">
        <Sidebar />
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-10 py-12 text-center shadow-sm">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Loading POS</p>
              <p className="mt-1 text-xs text-muted-foreground">{scopeUi.loadingHint}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-with-sidebar flex h-screen bg-background">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border/60 shadow-sm">
        <header className="sticky top-0 z-40 border-b border-border bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6 sm:py-4">
          <div className="mx-auto flex max-w-[1600px] flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Point of sale
                </p>
                <span
                  className={scopeUi.badgeClass}
                  title="This register is configured for your login (POS scope)"
                >
                  {posSaleScope === "both" && (
                    <span className="inline-flex items-center gap-0.5" aria-hidden>
                      <Fuel className="h-3.5 w-3.5 shrink-0 opacity-90" />
                      <Store className="h-3.5 w-3.5 shrink-0 opacity-90" />
                    </span>
                  )}
                  {posSaleScope === "general" && <Store className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />}
                  {posSaleScope === "fuel" && <Fuel className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />}
                  {posSaleScope === "both" && "Fuel & shop"}
                  {posSaleScope === "general" && "Shop only"}
                  {posSaleScope === "fuel" && "Fuel only"}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground sm:text-xs"
                  title="Local time at this workstation"
                >
                  <Clock className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                  <time dateTime={now.toISOString()}>
                    {now.toLocaleString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
              </div>
              <h1 className="mt-2 text-xl font-bold tracking-tight text-foreground sm:mt-1 sm:text-2xl md:text-3xl">
                {posSaleScope === "general" && "Checkout — retail"}
                {posSaleScope === "fuel" && "Checkout — fuel"}
                {posSaleScope === "both" && "Checkout — fuel & retail"}
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                {posSaleScope === "general" && (
                  <>
                    Shop and services only on this register. Credit sales post to A/R; settle later under Payments
                    → Received.
                  </>
                )}
                {posSaleScope === "fuel" && (
                  <>Pump sales only. Credit sales post to A/R; settle later under Payments → Received.</>
                )}
                {posSaleScope === "both" && (
                  <>
                    One ticket for pump dispense and counter items. Credit sales post to A/R; settle later under
                    Payments → Received.
                  </>
                )}
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 min-[400px]:w-auto sm:gap-3 lg:shrink-0">
              <div className="relative" ref={shortcutsRef}>
                <button
                  type="button"
                  onClick={() => setShowShortcuts(o => !o)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 touch-manipulation active:scale-[0.99] sm:min-h-10"
                  aria-expanded={showShortcuts}
                  aria-controls="pos-shortcuts-panel"
                >
                  <Keyboard className="h-4 w-4 text-muted-foreground" aria-hidden />
                  Keys
                </button>
                {showShortcuts ? (
                  <div
                    id="pos-shortcuts-panel"
                    className="absolute right-0 z-[70] mt-1.5 w-[min(100vw-2rem,20rem)] overflow-hidden rounded-xl border border-border bg-popover py-3 px-3 text-popover-foreground shadow-lg ring-1 ring-border"
                    role="region"
                    aria-label="Keyboard shortcuts"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Shortcuts
                    </p>
                    <ul className="mt-2 space-y-2 text-sm">
                      <li className="flex items-start justify-between gap-2">
                        <span className="text-muted-foreground">Product search</span>
                        <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                          /
                        </kbd>
                      </li>
                      <li className="flex items-start justify-between gap-2">
                        <span className="text-muted-foreground">Complete sale</span>
                        <span className="flex max-w-[11rem] shrink-0 flex-wrap items-center justify-end gap-1">
                          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                            F9
                          </kbd>
                          <span className="text-xs text-muted-foreground">or</span>
                          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                            ⌘/Ctrl
                          </kbd>
                          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                            Enter
                          </kbd>
                        </span>
                      </li>
                      <li className="flex items-start justify-between gap-2">
                        <span className="text-muted-foreground">Close dialogs</span>
                        <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                          Esc
                        </kbd>
                      </li>
                      <li className="flex items-start justify-between gap-2">
                        <span className="text-muted-foreground">This panel</span>
                        <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                          ?
                        </kbd>
                      </li>
                    </ul>
                    <p className="mt-3 border-t border-border pt-2 text-[11px] leading-snug text-muted-foreground">
                      Barcode scanners: focus search, scan code — if one match exists, press{" "}
                      <kbd className="rounded border border-border bg-muted px-1 font-mono">Enter</kbd>{" "}
                      to add.
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="relative" ref={printMenuRef}>
                <button
                  type="button"
                  disabled={printBusy}
                  onClick={() => setPrintMenuOpen(o => !o)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 touch-manipulation active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10"
                >
                  {printBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <Printer className="h-4 w-4 text-muted-foreground" />
                  )}
                  Print
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
                {printMenuOpen ? (
                  <div className="absolute right-0 z-[60] mt-1.5 w-64 overflow-hidden rounded-xl border border-border bg-popover py-1.5 shadow-lg ring-1 ring-border">
                    <button
                      type="button"
                      disabled={!canPrintUnifiedDraft}
                      onClick={printDraftFromMenu}
                      className="block w-full px-3 py-2.5 text-left text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="font-medium">Draft invoice</span>
                      <span className="block text-xs text-muted-foreground">
                        Fuel line and shopping cart combined
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void printPosSummaryReport()}
                      className="block w-full px-3 py-2.5 text-left text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="font-medium">POS summary report</span>
                      <span className="block text-xs text-muted-foreground">
                        Today&apos;s sales &amp; dashboard totals
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={!customerId}
                      onClick={() => void printCustomerLedgerStatement()}
                      className="block w-full px-3 py-2.5 text-left text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="font-medium">Customer A/R statement</span>
                      <span className="block text-xs text-muted-foreground">
                        Ledger for selected customer
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="hidden max-w-[14rem] text-right text-sm text-muted-foreground sm:block">
                <div className="inline-flex items-center justify-end gap-1.5 font-medium text-foreground">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{posCompanyLabel}</span>
                </div>
                {posCompanyAddress ? <p className="truncate text-xs">{posCompanyAddress}</p> : null}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-destructive/30 bg-background px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 touch-manipulation active:scale-[0.99] sm:min-h-10"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>
        </header>

        <main
          className="flex-1 overflow-auto px-3 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-6"
          id="pos-workspace"
          aria-label="Point of sale workspace"
        >
          <div
            className={`mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 ${scopeUi.shell}`}
          >
            <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Register mode
            </p>
            <div className="flex min-w-0 w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:min-w-[min(100%,20rem)] sm:max-w-none sm:flex-1 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
              {posMode === "sale" && stations.length > 0 && posSaleScope !== "fuel" ? (
                <div className="w-full min-w-0 sm:max-w-[16rem] sm:shrink-0">
                  <label
                    className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    htmlFor="pos-station-id"
                  >
                    Selling location (shop stock)
                  </label>
                  <select
                    id="pos-station-id"
                    value={posStationId ?? ""}
                    onChange={e =>
                      setPosStationId(e.target.value ? Number(e.target.value) : null)
                    }
                    className={selectClassName}
                  >
                    {stations.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.station_name}
                        {s.station_number ? ` (${s.station_number})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div
                className="-mx-1 flex max-w-full min-w-0 flex-1 flex-nowrap justify-end gap-1 overflow-x-auto overscroll-x-contain rounded-xl border border-border/80 bg-muted/50 p-1.5 [scrollbar-width:thin] sm:mx-0 sm:flex-initial sm:flex-wrap sm:overflow-x-visible"
                role="group"
                aria-label="POS mode"
              >
              <button
                type="button"
                onClick={() => setPosMode("sale")}
                className={`inline-flex min-h-11 shrink-0 touch-manipulation snap-start items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all active:scale-[0.99] sm:min-h-10 sm:rounded-md sm:px-4 ${
                  posMode === "sale"
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                }`}
              >
                <ShoppingCart className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">New sale</span>
              </button>
              {!limitedPosRegister ? (
                <>
                  <button
                    type="button"
                    onClick={() => setPosMode("collect")}
                    className={`inline-flex min-h-11 shrink-0 touch-manipulation snap-start items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all active:scale-[0.99] sm:min-h-10 sm:rounded-md sm:px-4 ${
                      posMode === "collect"
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    }`}
                  >
                    <Wallet className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap">Collect due</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosMode("pay")}
                    className={`inline-flex min-h-11 shrink-0 touch-manipulation snap-start items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all active:scale-[0.99] sm:min-h-10 sm:rounded-md sm:px-4 ${
                      posMode === "pay"
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    }`}
                  >
                    <Banknote className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap">Pay bills</span>
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => setPosMode("donation")}
                className={`inline-flex min-h-11 shrink-0 touch-manipulation snap-start items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all active:scale-[0.99] sm:min-h-10 sm:rounded-md sm:px-4 ${
                  posMode === "donation"
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                }`}
              >
                <HeartHandshake className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">Donation</span>
              </button>
            </div>
            </div>
            {posMode === "sale" && stations.length > 0 && posSaleScope !== "fuel" ? (
              <p className="w-full basis-full text-xs leading-relaxed text-muted-foreground">
                Product lines deduct stock from this station. Fuel uses the selected nozzle’s station. On
                a product, tap <span className="font-medium text-foreground">Stock at all stations</span> to
                see quantities everywhere.
              </p>
            ) : null}
          </div>

          {posMode === "collect" ? (
            <div className={`mx-auto w-full max-w-3xl ${scopeUi.shell}`}>
              <CashierCollectPayment
                customers={customers}
                currencySymbol={currencySymbol}
                bankRegisters={bankRegisters}
                onRecorded={() => loadInitialData()}
              />
            </div>
          ) : null}

          {posMode === "pay" ? (
            <div className={`mx-auto w-full max-w-3xl ${scopeUi.shell}`}>
              <CashierPayBills
                vendors={vendors}
                currencySymbol={currencySymbol}
                bankAccounts={bankRegisters}
                onRecorded={() => loadInitialData()}
              />
            </div>
          ) : null}

          {posMode === "donation" ? (
            <div className={`mx-auto w-full max-w-3xl ${scopeUi.shell}`}>
              <CashierDonation
                currencySymbol={currencySymbol}
                bankAccounts={bankRegisters}
                onRecorded={() => loadInitialData()}
              />
            </div>
          ) : null}

          {posMode === "sale" ? (
          <div className={scopeUi.shell}>
            <div className={scopeUi.grid}>
            <div className={`${scopeUi.primarySpan} space-y-5 sm:space-y-6`}>
              {showNozzleColumn && (
              <section
                className={`relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-amber-500/[0.06] via-card to-muted/25 p-4 text-card-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_12px_40px_-12px_rgba(15,23,42,0.15)] ring-1 ring-amber-500/10 dark:from-amber-500/10 dark:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.45)] dark:ring-amber-500/15 sm:p-6 ${
                  posSaleScope === "fuel" ? "ring-2 ring-amber-500/25" : ""
                } `}
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Pumps
                    </p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Nozzles</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">Select a lane to load pricing and meter context</p>
                  </div>
                  <span className="rounded-full border border-border/80 bg-muted/50 px-3 py-1 text-xs font-medium tabular-nums text-muted-foreground">
                    {nozzles.length} active
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] sm:gap-3">
                  {nozzles.map(nozzle => {
                    const isSelected = selectedNozzle?.id === nozzle.id
                    const capacity = nozzle.tank_capacity || 0
                    const baseStock = Number(nozzle.current_stock || 0)
                    const baseReading = Number(nozzle.current_reading || 0)
                    const liveStock = isSelected ? tankProjected : baseStock
                    const liveReading = isSelected ? meterProjected : baseReading
                    const fillPercent =
                      capacity > 0
                        ? Math.max(0, Math.min(100, (liveStock / capacity) * 100))
                        : 0
                    const accent = (nozzle.color_code || "#3b82f6").trim()

                    return (
                      <button
                        key={nozzle.id}
                        type="button"
                        onClick={() => handleNozzleSelect(nozzle)}
                        style={{ borderLeftColor: isSelected ? accent : undefined } as CSSProperties}
                        className={`relative rounded-xl border border-border/90 bg-card/90 p-4 text-left shadow-sm backdrop-blur-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                          isSelected
                            ? "border-l-[3px] shadow-md ring-1 ring-primary/20"
                            : "border-l-[3px] border-l-transparent hover:border-border hover:shadow-md"
                        } `}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold tabular-nums text-foreground">
                              {nozzle.nozzle_number}
                            </p>
                            {nozzle.nozzle_name && (
                              <p className="truncate text-xs text-muted-foreground">{nozzle.nozzle_name}</p>
                            )}
                            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                              {[nozzle.station_name, nozzle.island_name, nozzle.dispenser_name]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/30"
                            style={{ color: accent }}
                          >
                            <Fuel className="h-4 w-4" />
                          </div>
                        </div>

                        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 font-medium leading-snug text-foreground">{nozzle.product_name}</p>
                            <p className="shrink-0 text-xs font-semibold tabular-nums text-foreground sm:text-sm">
                              {currencySymbol}
                              {formatNumber(Number(nozzle.product_price || 0))}
                              <span className="block text-right text-[10px] font-normal text-muted-foreground">
                                / {nozzle.product_unit || "L"}
                              </span>
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 border-t border-border/50 pt-2 text-xs">
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Meter</p>
                              <p className="font-medium text-foreground">{nozzle.meter_number || "—"}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                                <span className="inline-flex items-center gap-0.5 tabular-nums">
                                  <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                                  {formatNumber(baseReading)}
                                </span>
                                <span className="inline-flex items-center gap-0.5 tabular-nums">
                                  <CheckCircle className="h-3 w-3 shrink-0 text-emerald-600" />
                                  {formatNumber(liveReading)}
                                </span>
                              </div>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tank</p>
                              <p className="font-medium text-foreground">{nozzle.tank_number || "—"}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                                <span className="inline-flex items-center gap-0.5 tabular-nums">
                                  <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                                  {formatNumber(baseStock)}
                                </span>
                                <span className="inline-flex items-center gap-0.5 tabular-nums">
                                  <CheckCircle className="h-3 w-3 shrink-0 text-emerald-600" />
                                  {formatNumber(liveStock)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${fillPercent}%`,
                              backgroundColor: accent,
                            }}
                          />
                        </div>
                      </button>
                    )
                  })}

                  {!nozzles.length && (
                    <div className="col-span-full rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
                      No nozzles configured yet.
                    </div>
                  )}
                </div>
              </section>
              )}

              {showCatalog && (
              <section
                className={`rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm ring-1 ring-emerald-500/10 sm:p-6 dark:ring-emerald-500/15 ${
                  posSaleScope === "general" ? "ring-2 ring-emerald-500/20" : "bg-gradient-to-b from-emerald-500/[0.04] to-card"
                } `}
              >
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Catalog
                    </p>
                    <h2 className="text-lg font-semibold tracking-tight text-foreground">
                      Products &amp; services
                    </h2>
                  </div>
                  <div className="relative w-full sm:max-w-xs sm:flex-1 lg:max-w-sm">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      ref={itemSearchRef}
                      id="pos-product-search"
                      type="search"
                      value={itemSearch}
                      onChange={event => setItemSearch(event.target.value)}
                      onKeyDown={event => {
                        if (event.key !== "Enter") return
                        if (filteredItems.length === 1) {
                          event.preventDefault()
                          addItemToCart(filteredItems[0])
                          setItemSearch("")
                        }
                      }}
                      placeholder="Search or scan barcode — press / to focus"
                      autoComplete="off"
                      className={`${inputClassName} pl-10`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 sm:grid-cols-2 2xl:grid-cols-3">
                  {filteredItems.map(item => {
                    const isSelected = selectedItem?.id === item.id
                    return (
                      <div
                        key={item.id}
                        className={`flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-200 ${
                          isSelected
                            ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary ring-offset-2 ring-offset-background"
                            : "border-border bg-card hover:border-primary/30 hover:shadow-md"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => addItemToCart(item)}
                          className="flex flex-1 flex-col p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        >
                          {getImageUrl(item.image_url) && (
                            <div className="mb-3 flex justify-center">
                              <img
                                src={getImageUrl(item.image_url)!}
                                alt={item.name}
                                className="h-24 w-24 object-contain rounded-lg border border-border bg-muted/30"
                                onError={e => {
                                  ;(e.target as HTMLImageElement).style.display = "none"
                                }}
                              />
                            </div>
                          )}
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p
                                className={`truncate text-sm font-semibold ${
                                  isSelected ? "text-foreground" : "text-foreground"
                                }`}
                              >
                                {item.name}
                              </p>
                              <p className="text-xs uppercase text-muted-foreground">
                                {item.item_type.replace(/_/g, " ")}
                              </p>
                              {item.pos_category && (
                                <p className="text-xs text-muted-foreground">{item.pos_category}</p>
                              )}
                            </div>
                            <PlusCircle
                              className={`h-5 w-5 shrink-0 ${
                                isSelected ? "text-primary" : "text-primary/80"
                              }`}
                            />
                          </div>
                          <p className="mt-3 text-sm font-semibold tabular-nums text-foreground">
                            {currencySymbol}
                            {formatNumber(Number(item.unit_price || 0))}
                            {item.unit && (
                              <span className="text-xs font-normal text-muted-foreground">
                                {" "}
                                / {item.unit}
                              </span>
                            )}
                          </p>
                          {item.quantity_on_hand !== undefined &&
                            item.item_type?.toLowerCase() === "inventory" && (
                              <p className="text-xs text-muted-foreground">
                                In stock: {formatNumber(Number(item.quantity_on_hand))}{" "}
                                {item.unit || "units"}
                              </p>
                            )}
                        </button>
                        {posItemSupportsShopStationStockView(item) && (
                          <div className="border-t border-border/70 bg-muted/30 px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setStationStockItem(item)}
                              className="inline-flex w-full min-h-10 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:justify-start"
                            >
                              <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              Stock at all stations
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {!filteredItems.length && (
                    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center text-sm text-muted-foreground sm:p-6 md:p-8">
                      No matching items found.
                    </div>
                  )}
                </div>
              </section>
              )}
            </div>

            <div
              className={`${scopeUi.checkoutSpan} space-y-5 sm:space-y-6 ${scopeUi.checkoutSticky}`}
            >
              {showFuelDispensePanel && (
              <section className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-amber-500/[0.07] via-card to-muted/20 p-4 text-card-foreground shadow-[0_8px_32px_-12px_rgba(15,23,42,0.14)] ring-1 ring-amber-500/15 dark:shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)] dark:ring-amber-500/20 sm:p-6">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500/40 via-amber-500/20 to-transparent" />
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Dispensed fuel
                  </p>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">Fuel sale</h2>
                </div>
                {selectedNozzle ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">
                      <span className="font-medium">{selectedNozzle.product_name}</span>
                      <span className="text-muted-foreground"> — </span>
                      {currencySymbol}
                      {formatNumber(Number(selectedNozzle.product_price || 0))} per{" "}
                      {selectedNozzle.product_unit || "L"}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        Quantity ({selectedNozzle.product_unit || "L"})
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={quantity}
                        onChange={event => handleQuantityChange(event.target.value)}
                        className={inputClassName}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        Amount ({currencySymbol})
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amount}
                        onChange={event => handleAmountChange(event.target.value)}
                        className={`${inputClassName} min-w-0 text-right tabular-nums`}
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Quick quantity</p>
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Preset fuel quantities">
                        {[1, 5, 10, 20, 50].map(q => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => applyQuickFuelQty(q)}
                            disabled={!selectedNozzle}
                            className="inline-flex min-h-11 min-w-[3.25rem] items-center justify-center rounded-lg border border-border bg-muted/40 px-3 text-sm font-semibold tabular-nums text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {q} {selectedUnit}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        Vehicle plate number (optional)
                      </label>
                      <input
                        type="text"
                        value={vehiclePlate}
                        onChange={event => setVehiclePlate(event.target.value)}
                        placeholder="E.g. DHA-1234"
                        className={inputClassName}
                      />
                    </div>

                    {shouldShowLivePreview && (
                      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-foreground shadow-sm">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <p className="text-xs font-semibold uppercase text-muted-foreground">
                              Meter reading ({selectedUnit})
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-3">
                              <div>
                                <p className="text-muted-foreground">Before sale</p>
                                <p className="font-semibold tabular-nums text-foreground">
                                  {formatNumber(meterStart)}
                                </p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">After sale</p>
                                <p className="font-semibold tabular-nums text-foreground">
                                  {formatNumber(meterProjected)}
                                </p>
                              </div>
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase text-muted-foreground">
                              Tank stock ({selectedUnit})
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-3">
                              <div>
                                <p className="text-muted-foreground">Before sale</p>
                                <p className="font-semibold tabular-nums text-foreground">
                                  {formatNumber(tankStart)}
                                </p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">After sale</p>
                                <p className="font-semibold tabular-nums text-foreground">
                                  {formatNumber(tankProjected)}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2 sm:gap-2">
                      <button
                        type="button"
                        onClick={() => setShowInvoicePreview(true)}
                        className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10"
                        disabled={!Number.isFinite(grandTotal) || grandTotal <= 0}
                      >
                        Invoice Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => printUnifiedDraft()}
                        className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10"
                        disabled={!canPrintUnifiedDraft}
                      >
                        <Printer className="h-4 w-4" />
                        Print draft
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-5 text-center text-sm text-muted-foreground sm:p-6">
                    Select a pump lane above to begin a fuel sale.
                  </div>
                )}
              </section>
              )}

              <section className="rounded-2xl border border-border bg-gradient-to-b from-card to-muted/20 p-4 text-card-foreground shadow-md ring-1 ring-border/50 sm:p-6">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Checkout
                      </p>
                      <h2 className="text-lg font-semibold tracking-tight text-foreground">Cart</h2>
                    </div>
                    {(!!cartEntries.length || pendingFuelAmount > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          setCartEntries([])
                          setSelectedItem(null)
                          setQuantity("")
                          setAmount("")
                          setSelectedNozzle(null)
                        }}
                        className="text-sm font-medium text-destructive transition-colors hover:text-destructive/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {!cartEntries.length && pendingFuelAmount <= 0 && (
                    <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                      {posSaleScope === "both" &&
                        "Enter fuel in the panel above and/or add products from the catalog. Fuel-only or shop-only sales are both supported."}
                      {posSaleScope === "general" && "Add products from the catalog to the cart, then complete checkout."}
                      {posSaleScope === "fuel" && "Set quantity in the fuel panel and add the line, or add fuel to the cart above."}
                    </div>
                  )}
                  {pendingFuelAmount > 0 && selectedNozzle && (
                    <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-4 pl-4 shadow-sm ring-1 ring-inset ring-primary/10">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase text-primary">
                            Fuel
                          </p>
                          <p className="text-sm font-semibold text-foreground">
                            {selectedNozzle.product_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {selectedNozzle.nozzle_number} · {formatNumber(quantityNumber)}{" "}
                            {selectedUnit}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold tabular-nums text-foreground">
                            {currencySymbol}
                            {formatNumber(amountNumber)}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setQuantity("")
                              setAmount("")
                              setSelectedNozzle(null)
                            }}
                            className="mt-1 text-xs font-medium text-destructive transition-colors hover:text-destructive/80"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {cartEntries.length > 0 && (
                    <div className="mt-4 overflow-hidden rounded-xl border border-border divide-y divide-border">
                      {cartEntries.map(entry => {
                        const lineAmount = roundTwo(entry.quantity * entry.unitPrice)
                        const isAdjustment =
                          entry.item.item_type === "discount" ||
                          entry.item.item_type === "payment"

                        return (
                          <div key={entry.item.id} className="bg-card/50 p-4 transition-colors hover:bg-muted/30">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3 flex-1">
                                {/* Item Image in Cart */}
                                {getImageUrl(entry.item.image_url) && (
                                  <img
                                    src={getImageUrl(entry.item.image_url)!}
                                    alt={entry.item.name}
                                    className="h-12 w-12 shrink-0 rounded-md border border-border bg-muted/30 object-contain"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none'
                                    }}
                                  />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-foreground">
                                    {entry.item.name}
                                  </p>
                                  <p className="text-xs uppercase text-muted-foreground">
                                    {entry.item.item_type.replace(/_/g, " ")}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeCartItem(entry.item.id)}
                                className="shrink-0 rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                              <div>
                                <label className="block text-xs font-semibold text-muted-foreground">
                                  Quantity {entry.item.unit && `(${entry.item.unit})`}
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  step={entry.item.unit === 'piece' || entry.item.unit === 'each' || entry.item.unit === 'box' || entry.item.unit === 'pack' ? "1" : "0.01"}
                                  value={entry.quantity}
                                  onChange={event =>
                                    updateCartQuantity(
                                      entry.item.id,
                                      parseFloat(event.target.value) || 0
                                    )
                                  }
                                  className={`${inputClassName} px-2 py-1.5`}
                                />
                              </div>

                              <div>
                                <label className="block text-xs font-semibold text-muted-foreground">
                                  Unit Price ({currencySymbol})
                                  {entry.item.unit && (
                                    <span className="text-muted-foreground/80"> / {entry.item.unit}</span>
                                  )}
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={entry.unitPrice}
                                  onChange={event =>
                                    updateCartPrice(
                                      entry.item.id,
                                      parseFloat(event.target.value) || 0
                                    )
                                  }
                                  className={`${inputClassName} px-2 py-1.5`}
                                />
                              </div>

                              {!isAdjustment && (
                                <div>
                                  <label className="block text-xs font-semibold text-muted-foreground">
                                    Discount %
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.1"
                                    value={entry.discountPercent}
                                    onChange={event =>
                                      updateCartDiscount(
                                        entry.item.id,
                                        parseFloat(event.target.value) || 0
                                      )
                                    }
                                    className={`${inputClassName} px-2 py-1.5`}
                                  />
                                </div>
                              )}
                            </div>

                            <div className="mt-3 flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Line total</span>
                              <span
                                className={`text-base font-semibold tabular-nums ${
                                  lineAmount < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                                }`}
                              >
                                {currencySymbol}{formatNumber(lineAmount)}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {(pendingFuelAmount > 0 || cartEntries.length > 0) && (
                    <div className="mt-4 space-y-4">
                      <div className="space-y-2 rounded-xl bg-muted/50 p-4 text-sm">
                        {pendingFuelAmount > 0 && (
                          <div className="flex items-center justify-between border-b border-border/60 pb-2">
                            <span className="text-muted-foreground">Fuel (this sale)</span>
                            <span className="font-semibold tabular-nums text-foreground">
                              {currencySymbol}
                              {formatNumber(amountNumber)}
                            </span>
                          </div>
                        )}
                        {cartEntries.length > 0 && (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Shop subtotal</span>
                              <span className="font-semibold tabular-nums text-foreground">
                                {currencySymbol}
                                {formatNumber(cartTotals.subtotal)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Discounts</span>
                              <span className="font-semibold tabular-nums text-destructive">
                                -{currencySymbol}
                                {formatNumber(cartTotals.discountTotal)}
                              </span>
                            </div>
                            {cartTotals.paymentTotal > 0 && (
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Payments / deposits</span>
                                <span className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">
                                  -{currencySymbol}
                                  {formatNumber(cartTotals.paymentTotal)}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                        <div
                          className="flex items-center justify-between border-t border-border pt-3"
                          aria-live="polite"
                          aria-atomic="true"
                        >
                          <span className="text-base font-semibold text-foreground">Total due</span>
                          <span
                            className={`text-2xl font-bold tabular-nums ${
                              grandTotal >= 0 ? "text-foreground" : "text-destructive"
                            }`}
                          >
                            {currencySymbol}
                            {formatNumber(grandTotal)}
                          </span>
                        </div>
                        {cartEntries.length > 0 && cartTotals.hasNegativeTotal && (
                          <p className="text-xs text-destructive">
                            Total cannot be negative. Adjust discounts or deposits.
                          </p>
                        )}
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground" htmlFor="pos-customer-filter">
                            Find customer
                          </label>
                          <input
                            id="pos-customer-filter"
                            type="search"
                            value={customerFilter}
                            onChange={event => setCustomerFilter(event.target.value)}
                            placeholder="Filter by name…"
                            autoComplete="off"
                            className={inputClassName}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground" htmlFor="pos-customer-select">
                            {isOnAccount || isSplitPayment
                              ? "Customer (required for on account / split tender)"
                              : "Customer (optional)"}
                          </label>
                          <select
                            id="pos-customer-select"
                            value={customerId || ""}
                            onChange={event =>
                              setCustomerId(
                                event.target.value ? Number(event.target.value) : null
                              )
                            }
                            className={`${selectClassName} ${
                              (isOnAccount || isSplitPayment) && !customerId
                                ? "border-amber-500/80 bg-amber-50 dark:bg-amber-950/30"
                                : ""
                            }`}
                          >
                            <option value="">Walk-in</option>
                            {filteredCustomers.map(customer => (
                              <option key={customer.id} value={customer.id}>
                                {customer.display_name}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-muted-foreground">
                            <Link
                              href="/payments/received/new"
                              className="font-medium text-primary underline underline-offset-2"
                            >
                              Collect payment (old invoices only)
                            </Link>
                            <span className="text-muted-foreground">
                              {" "}
                              — use when the customer pays due balances without a new sale here.
                            </span>
                          </p>
                        </div>

                        <div className="space-y-2">
                          <label
                            className="text-sm font-medium text-foreground"
                            htmlFor="pos-payment-method"
                          >
                            Payment method
                          </label>
                          <select
                            id="pos-payment-method"
                            value={paymentMethod}
                            onChange={event => {
                              const v = event.target.value
                              setPaymentMethod(v)
                              if (v === "ON_ACCOUNT") setAmountPaidNow("")
                            }}
                            className={selectClassName}
                          >
                            <option value="CASH">Cash</option>
                            <option value="CARD">Card</option>
                            <option value="TRANSFER">Bank Transfer</option>
                            <option value="MOBILE_MONEY">Mobile Money</option>
                            <option value="ON_ACCOUNT">
                              On account (A/R) — charge to customer
                            </option>
                          </select>
                          <p className="text-xs text-muted-foreground">
                            <strong className="text-foreground">Credit / charge sale:</strong> choose{" "}
                            <strong>On account (A/R)</strong> here — not in the bank/till list below.
                          </p>
                          {isOnAccount ? (
                            <p className="rounded-md border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                              Posts to <strong>Accounts Receivable</strong>. Record cash,
                              card, or transfer receipts under <strong>Payments → Received</strong>{" "}
                              when the customer pays (full or partial).
                            </p>
                          ) : null}
                        </div>

                        {!isOnAccount ? (
                          <div className="space-y-2">
                            <label
                              className="text-sm font-medium text-foreground"
                              htmlFor="pos-amount-paid-now"
                            >
                              Pay now (optional — split tender)
                            </label>
                            <input
                              id="pos-amount-paid-now"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={amountPaidNow}
                              onChange={event => setAmountPaidNow(event.target.value)}
                              placeholder={
                                grandTotal > 0
                                  ? `Blank = pay full ${currencySymbol}${formatNumber(grandTotal)} with method above`
                                  : "Enter amount collected now"
                              }
                              className={inputClassName}
                            />
                            {isSplitPayment &&
                            parsedAmountPaidNow !== null &&
                            splitBalanceOnAR !== null ? (
                              <p className="rounded-md border border-sky-200/80 bg-sky-50 px-3 py-2 text-xs text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
                                <strong>Split tender:</strong> {currencySymbol}
                                {formatNumber(parsedAmountPaidNow)} taken now;{" "}
                                {currencySymbol}
                                {formatNumber(splitBalanceOnAR)} posts to{" "}
                                <strong>Accounts Receivable</strong> for this customer.
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Less than total = charge the remainder on account (named customer
                                required).
                              </p>
                            )}
                          </div>
                        ) : null}

                        {paymentMethod !== "CARD" &&
                        paymentMethod !== "ON_ACCOUNT" &&
                        bankRegisters.length > 0 ? (
                          <div className="space-y-2">
                            <label
                              className="text-sm font-medium text-foreground"
                              htmlFor="pos-deposit-bank"
                            >
                              Where to record this sale&apos;s cash (optional)
                            </label>
                            <select
                              id="pos-deposit-bank"
                              value={depositBankId === "" ? "" : String(depositBankId)}
                              onChange={event =>
                                setDepositBankId(
                                  event.target.value === ""
                                    ? ""
                                    : Number(event.target.value)
                                )
                              }
                              className={selectClassName}
                            >
                              <option value="">
                                Default — petty cash / undeposited (GL 1010 / 1020)
                              </option>
                              {bankRegisters.map(b => (
                                <option key={b.id} value={b.id}>
                                  {[b.bank_name, b.account_name].filter(Boolean).join(" — ") ||
                                    `Register #${b.id}`}
                                  {b.chart_account_id ? "" : " (link GL in Chart of Accounts)"}
                                </option>
                              ))}
                            </select>
                            <p className="text-xs text-muted-foreground">
                              Picks which <strong>bank or till register</strong> gets debited for{" "}
                              <strong>immediate</strong> payment only. Accounts Receivable is{" "}
                              <strong>not</strong> listed here — use{" "}
                              <strong>Payment method → On account (A/R)</strong> above for credit
                              sales.
                            </p>
                          </div>
                        ) : null}

                        <div className="grid grid-cols-1 gap-2.5 min-[500px]:grid-cols-3 sm:gap-2">
                          <button
                            type="button"
                            onClick={() => setShowInvoicePreview(true)}
                            className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10"
                            disabled={!Number.isFinite(grandTotal) || grandTotal <= 0}
                          >
                            Invoice Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => printUnifiedDraft()}
                            className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10"
                            disabled={!canPrintUnifiedDraft}
                          >
                            <Printer className="h-4 w-4" />
                            Print invoice
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleUnifiedSale()}
                            disabled={!canCompleteUnifiedSale}
                            className="inline-flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 min-[500px]:min-h-11"
                          >
                            <ShoppingCart className="h-4 w-4" />
                            Complete sale
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
              </section>
            </div>
          </div>
          </div>
          ) : null}
        </main>
      </div>

      <Modal
        isOpen={!!stationStockItem}
        onClose={() => {
          setStationStockItem(null)
          setStationStockData(null)
        }}
        title={stationStockItem ? `Stock — ${stationStockItem.name}` : "Stock by station"}
        size="md"
      >
        <div className="text-sm text-card-foreground">
          {stationStockLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              Loading…
            </div>
          )}
          {!stationStockLoading && stationStockData && !stationStockData.tracks_per_station && (
            <p className="text-muted-foreground">
              {stationStockData.message ||
                "This product is not tracked in per-station shop bins (e.g. fuel is in tanks)."}
            </p>
          )}
          {!stationStockLoading && stationStockData?.tracks_per_station && (
            <div className="space-y-4">
              {posStationId != null && (() => {
                const reg = stations.find(s => s.id === posStationId)
                if (!reg) return null
                return (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">This register</span> sells from:{" "}
                    {reg.station_name}
                    {reg.station_number ? ` (${reg.station_number})` : null}
                  </p>
                )
              })()}
              <p className="text-xs text-muted-foreground">
                Total on hand (company):{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {formatNumber(Number(stationStockData.total_on_hand || 0))}{" "}
                  {stationStockData.unit || "units"}
                </span>
              </p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[16rem] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Station</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stationStockData.stations.length ? (
                      stationStockData.stations.map(row => {
                        const isThisRegister = posStationId != null && row.station_id === posStationId
                        return (
                          <tr
                            key={row.station_id}
                            className={isThisRegister ? "bg-primary/5" : ""}
                          >
                            <td className="px-3 py-2.5 text-foreground">
                              {row.station_name}
                              {row.station_number ? ` (${row.station_number})` : ""}
                              {isThisRegister && (
                                <span className="ml-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                                  This register
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-medium text-foreground">
                              {formatNumber(Number(row.quantity || 0))}
                            </td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td colSpan={2} className="px-3 py-6 text-center text-muted-foreground">
                          No station rows yet (quantities are zero or not initialized).
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showInvoicePreview && grandTotal > 0}
        onClose={() => setShowInvoicePreview(false)}
        title="Invoice preview"
        size="lg"
      >
        <div className="space-y-6 text-card-foreground">
          <div className="text-center">
            <h3 className="text-xl font-semibold tracking-tight text-foreground">{posCompanyLabel}</h3>
            {posCompanyAddress ? (
              <div className="mt-1 text-sm text-muted-foreground">
                <p>{posCompanyAddress}</p>
              </div>
            ) : null}
            <div className="mt-3 text-sm text-muted-foreground">
              {customerId ? (
                <p>
                  Customer:{" "}
                  {customers.find(customer => customer.id === customerId)?.display_name ||
                    customerId}
                </p>
              ) : (
                <p>Customer: Walk-in Customer</p>
              )}
              <p>Payment Method: {displayPaymentMethodLabel}</p>
              {vehiclePlate ? <p>Vehicle Plate: {vehiclePlate.toUpperCase()}</p> : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border bg-muted/40 p-4 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Date
              </p>
              <p className="text-foreground">{formatDate(new Date())}</p>
            </div>

            <div className="overflow-x-auto p-4">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2">Item</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Unit</th>
                    <th className="pb-2 text-right">Disc.</th>
                    <th className="pb-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {selectedNozzle && quantityNumber > 0 ? (
                    <tr>
                      <td className="py-3">
                        <p className="font-medium text-foreground">{selectedNozzle.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          Fuel · {selectedNozzle.nozzle_number}
                        </p>
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatNumber(quantityNumber)} {selectedUnit}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {currencySymbol}
                        {formatNumber(Number(unitPrice))}
                      </td>
                      <td className="py-3 text-right">—</td>
                      <td className="py-3 text-right font-semibold tabular-nums text-foreground">
                        {currencySymbol}
                        {formatNumber(Number(amountNumber || 0))}
                      </td>
                    </tr>
                  ) : null}
                  {cartEntries.map(entry => {
                    const lineAmount = roundTwo(entry.quantity * entry.unitPrice)
                    const finalAmount = roundTwo(
                      lineAmount - roundTwo(lineAmount * (entry.discountPercent / 100))
                    )
                    return (
                      <tr key={entry.item.id}>
                        <td className="py-3">
                          <p className="font-medium text-foreground">{entry.item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {entry.item.item_type.replace(/_/g, " ")}
                          </p>
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {formatNumber(entry.quantity)} {entry.item.unit || "units"}
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {currencySymbol}
                          {formatNumber(entry.unitPrice)}
                        </td>
                        <td className="py-3 text-right text-destructive">
                          {entry.discountPercent > 0
                            ? `${formatNumber(entry.discountPercent)}%`
                            : "—"}
                        </td>
                        <td className="py-3 text-right font-semibold tabular-nums text-foreground">
                          {currencySymbol}
                          {formatNumber(finalAmount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end border-t border-border bg-muted/30 p-4 text-sm">
              <div className="min-w-[16rem] space-y-1.5 text-right">
                {pendingFuelAmount > 0 && (
                  <div className="flex items-center justify-between gap-6">
                    <span className="text-muted-foreground">Fuel</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {currencySymbol}
                      {formatNumber(amountNumber)}
                    </span>
                  </div>
                )}
                {cartEntries.length > 0 && (
                  <>
                    <div className="flex items-center justify-between gap-6">
                      <span className="text-muted-foreground">Shop subtotal</span>
                      <span className="font-medium tabular-nums text-foreground">
                        {currencySymbol}
                        {formatNumber(cartTotals.subtotal)}
                      </span>
                    </div>
                    {cartTotals.discountTotal > 0 && (
                      <div className="flex items-center justify-between gap-6">
                        <span className="text-muted-foreground">Discounts</span>
                        <span className="font-medium tabular-nums text-destructive">
                          -{currencySymbol}
                          {formatNumber(cartTotals.discountTotal)}
                        </span>
                      </div>
                    )}
                    {cartTotals.paymentTotal > 0 && (
                      <div className="flex items-center justify-between gap-6">
                        <span className="text-muted-foreground">Payments / deposits</span>
                        <span className="font-medium tabular-nums text-orange-600 dark:text-orange-400">
                          -{currencySymbol}
                          {formatNumber(cartTotals.paymentTotal)}
                        </span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center justify-between gap-6 border-t border-border pt-2 text-base font-semibold text-foreground">
                  <span>Total due</span>
                  <span className="tabular-nums">
                    {currencySymbol}
                    {formatNumber(grandTotal)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            <p>Date/Time: {formatDate(new Date(), true)}</p>
          </div>
          <div className="flex justify-end border-t border-border pt-4">
            <button
              type="button"
              onClick={() => printUnifiedDraft()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Printer className="h-4 w-4" />
              Print invoice
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}


