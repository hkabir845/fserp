"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Sidebar from "@/components/Sidebar"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/Toast"
import Modal from "@/components/ui/Modal"
import api, { getApiBaseUrl } from "@/lib/api"
import { useCompany } from "@/contexts/CompanyContext"
import { getCurrencySymbol, formatNumber } from "@/utils/currency"
import { formatDate } from "@/utils/date"
import { escapeHtml, printDocument, printLedgerStatement } from "@/utils/printDocument"
import type { LedgerPayload } from "@/components/ContactLedgerPage"
import {
  Building2,
  CheckCircle,
  ChevronDown,
  Clock,
  Fuel,
  Keyboard,
  Loader2,
  LogOut,
  PlusCircle,
  Printer,
  Search,
  ShoppingCart,
  X,
  XCircle,
} from "lucide-react"

const inputClassName =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
const selectClassName =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

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

const roundTwo = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100

/** POS payment method → API sends lowercase (e.g. on_account). */
const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  TRANSFER: "Bank transfer",
  MOBILE_MONEY: "Mobile money",
  ON_ACCOUNT: "On account (A/R)",
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
  const [nozzles, setNozzles] = useState<Nozzle[]>([])
  const [posItems, setPosItems] = useState<POSItem[]>([])

  const [selectedNozzle, setSelectedNozzle] = useState<Nozzle | null>(null)
  const [selectedItem, setSelectedItem] = useState<POSItem | null>(null)
  const [quantity, setQuantity] = useState("")
  const [amount, setAmount] = useState("")
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [paymentMethod, setPaymentMethod] = useState("CASH")
  /** When set, GL debits this bank register's chart line (see Chart of Accounts → bank link). */
  const [depositBankId, setDepositBankId] = useState<number | "">("")
  const [bankRegisters, setBankRegisters] = useState<BankRegister[]>([])
  const [vehiclePlate, setVehiclePlate] = useState("")

  const [cartEntries, setCartEntries] = useState<CartEntry[]>([])
  const [itemSearch, setItemSearch] = useState("")
  const [customerFilter, setCustomerFilter] = useState("")
  const [now, setNow] = useState(() => new Date())
  const [showShortcuts, setShowShortcuts] = useState(false)
  const itemSearchRef = useRef<HTMLInputElement | null>(null)
  const [showInvoicePreview, setShowInvoicePreview] = useState(false)
  const [printMenuOpen, setPrintMenuOpen] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  const printMenuRef = useRef<HTMLDivElement | null>(null)
  const shortcutsRef = useRef<HTMLDivElement | null>(null)
  const handleUnifiedSaleRef = useRef<() => Promise<void>>(async () => {})

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
        e.preventDefault()
        itemSearchRef.current?.focus()
        itemSearchRef.current?.select()
        return
      }
      if (e.key === "F9" || ((e.ctrlKey || e.metaKey) && e.key === "Enter")) {
        if (showInvoicePreview || printMenuOpen) return
        if (isEditable(e.target) && e.key !== "F9") return
        e.preventDefault()
        void handleUnifiedSaleRef.current()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [showInvoicePreview, printMenuOpen, showShortcuts])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem("access_token")
      if (!token) {
        router.push("/login")
        return
      }

      const [nozzleRes, customerRes, companyRes, itemRes, tanksRes, banksRes] =
        await Promise.all([
          api.get("/nozzles/details/"),
          api.get("/customers/"),
          api.get("/companies/current/"),
          api.get("/items/", { params: { pos_only: "true" } }),
          api.get("/tanks/"),
          api.get("/bank-accounts/"),
        ])

      const banksRaw = Array.isArray(banksRes.data) ? banksRes.data : []
      setBankRegisters(
        banksRaw.filter(
          (b: BankRegister) => b && typeof b.id === "number" && b.is_active !== false
        )
      )

      const nozzlesData = Array.isArray(nozzleRes.data) ? nozzleRes.data : []
      setNozzles(nozzlesData)
      if (nozzlesData.length > 0) {
        setSelectedNozzle(nozzlesData[0])
      }

      setCustomers(Array.isArray(customerRes.data) ? customerRes.data : [])

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
          .map((tank: any) => tank.product_id)
          .filter((id: any) => id !== null && id !== undefined)
      )

      const rawItems = itemRes.data
      const itemsList = Array.isArray(rawItems) ? rawItems : (rawItems?.items || [])
      const generalItems = itemsList.filter((item: POSItem) => {
        const isNotLinkedToTank = !tankProductIds.has(item.id)
        const allowedCategories = ["general", "service", "other"]
        const hasAllowedCategory = item.pos_category && allowedCategories.includes(item.pos_category.toLowerCase())
        const isAvailable = item.is_pos_available !== false
        const isNotFuel = item.pos_category?.toLowerCase() !== "fuel"
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
      if (qty > 0) {
        fuelLines.push({
          nozzle_id: selectedNozzle.id,
          quantity: roundTwo(qty),
          amount: roundTwo(amountNumber),
        })
      }
    }

    const validItems = cartEntries
      .filter(entry => entry.quantity > 0)
      .map(entry => ({
        item_id: entry.item.id,
        quantity: roundTwo(entry.quantity),
        unit_price: entry.unitPrice > 0 ? roundTwo(entry.unitPrice) : null,
        discount_percent:
          entry.item.item_type === "discount" ||
          entry.item.item_type === "payment"
            ? 0
            : Math.min(Math.max(entry.discountPercent, 0), 100),
      }))

    if (fuelLines.length === 0 && validItems.length === 0) {
      toast.error(
        "Add fuel (nozzle + quantity) and/or products to the cart before completing the sale."
      )
      return
    }

    if (grandTotal <= 0) {
      toast.error("Total must be positive to complete the sale.")
      return
    }

    if (isOnAccount && !customerId) {
      toast.error(
        "On-account (A/R) requires a customer. Choose a credit customer, not Walk-in."
      )
      return
    }

    try {
      const payload: Record<string, unknown> = {
        sale_type: "general",
        payment_method: paymentMethod.toLowerCase(),
        items: validItems,
        fuel_lines: fuelLines,
      }
      if (customerId !== null && customerId !== undefined) {
        payload.customer_id = customerId
      }
      if (
        !isOnAccount &&
        depositBankId !== "" &&
        typeof depositBankId === "number"
      ) {
        payload.bank_account_id = depositBankId
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
      setVehiclePlate("")
      setShowInvoicePreview(false)
      await loadInitialData()
    } catch (error: any) {
      const msg =
        error.response?.data?.detail ||
        error.response?.data?.error ||
        (error instanceof Error ? error.message : "Sale could not be completed. Please retry.")
      toast.error(typeof msg === "string" ? msg : "Sale could not be completed. Please retry.")
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

  const openPosPrintWindow = (docTitle: string, bodyHtml: string) => {
    const ok = printDocument({ title: docTitle, bodyHtml })
    if (!ok) toast.error("Allow pop-ups in your browser to print.")
    return ok
  }

  const canPrintUnifiedDraft = grandTotal > 0

  const printUnifiedDraft = () => {
    if (grandTotal <= 0) {
      toast.error("Add fuel and/or products with a positive total before printing.")
      return
    }
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
        <div><strong>${escapeHtml(posCompanyLabel)}</strong></div>
        ${posCompanyAddress ? `<div class="muted">${escapeHtml(posCompanyAddress)}</div>` : ""}
        <p class="muted">Printed ${escapeHtml(formatDate(new Date(), true))}</p>
      </div>
      <p class="muted">Customer: ${escapeHtml(custLabel)} · Payment: ${escapeHtml(
      paymentMethodLabel
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
    openPosPrintWindow(`Invoice draft ${inv}`, body)
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
          <div><strong>${escapeHtml(posCompanyLabel)}</strong></div>
          ${posCompanyAddress ? `<div class="muted">${escapeHtml(posCompanyAddress)}</div>` : ""}
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
      openPosPrintWindow(`POS summary ${today}`, body)
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
          companyName: posCompanyLabel,
          companyAddress: posCompanyAddress || undefined,
          currencySymbol,
          documentTitle: "Customer account statement",
          printedAt: formatDate(new Date(), true),
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
              <p className="mt-1 text-xs text-muted-foreground">Preparing catalog and pumps…</p>
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
        <header className="sticky top-0 z-40 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Point of sale
                </p>
                <span
                  className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"
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
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Checkout — fuel &amp; retail
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                One ticket for pump dispense and counter items. Credit sales post to A/R; settle later
                under Payments → Received.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 lg:shrink-0">
              <div className="relative" ref={shortcutsRef}>
                <button
                  type="button"
                  onClick={() => setShowShortcuts(o => !o)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-destructive/30 bg-background px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>
        </header>

        <main
          className="flex-1 overflow-auto px-4 py-6 sm:px-6"
          id="pos-workspace"
          aria-label="Point of sale workspace"
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
            <div className="space-y-6">
              <section className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Pumps
                    </p>
                    <h2 className="text-lg font-semibold tracking-tight text-foreground">Nozzles</h2>
                  </div>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {nozzles.length} nozzle{nozzles.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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

                    return (
                      <button
                        key={nozzle.id}
                        type="button"
                        onClick={() => handleNozzleSelect(nozzle)}
                        className={`relative rounded-xl border p-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                          isSelected
                            ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary ring-offset-2 ring-offset-background"
                            : "border-border bg-card hover:border-primary/30 hover:shadow-md"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {nozzle.nozzle_number}
                            </p>
                            {nozzle.nozzle_name && (
                              <p className="text-xs text-muted-foreground">{nozzle.nozzle_name}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {[nozzle.station_name, nozzle.island_name, nozzle.dispenser_name]
                                .filter(Boolean)
                                .join(" • ")}
                            </p>
                          </div>
                          <Fuel className="h-5 w-5 shrink-0 text-primary" />
                        </div>

                        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-medium text-foreground">{nozzle.product_name}</p>
                            <p className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                              {currencySymbol}
                              {formatNumber(Number(nozzle.product_price || 0))} /{" "}
                              {nozzle.product_unit || "L"}
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                            <div>
                              <p className="text-muted-foreground">Meter</p>
                              <p className="font-medium text-foreground">
                                {nozzle.meter_number || "-"}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <XCircle className="h-3 w-3 text-destructive" />
                                  {formatNumber(baseReading)}
                                </span>
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <CheckCircle className="h-3 w-3 text-emerald-600" />
                                  {formatNumber(liveReading)}
                                </span>
                              </div>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Tank</p>
                              <p className="font-medium text-foreground">
                                {nozzle.tank_number || "-"}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <XCircle className="h-3 w-3 text-destructive" />
                                  {formatNumber(baseStock)}
                                </span>
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <CheckCircle className="h-3 w-3 text-emerald-600" />
                                  {formatNumber(liveStock)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 h-1.5 rounded-full bg-muted">
                          <div
                            className="h-1.5 rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${fillPercent}%` }}
                          />
                        </div>
                      </button>
                    )
                  })}

                  {!nozzles.length && (
                    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                      No nozzles configured yet.
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Dispensed fuel
                  </p>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">Fuel sale</h2>
                </div>
                {selectedNozzle ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">
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
                        className={inputClassName}
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

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setShowInvoicePreview(true)}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={grandTotal <= 0}
                      >
                        Invoice Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => printUnifiedDraft()}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!canPrintUnifiedDraft}
                      >
                        <Printer className="h-4 w-4" />
                        Print draft
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                    Select a nozzle to begin a sale.
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
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

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredItems.map(item => {
                    const isSelected = selectedItem?.id === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addItemToCart(item)}
                        className={`rounded-xl border p-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                          isSelected
                            ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary ring-offset-2 ring-offset-background"
                            : "border-border bg-card hover:border-primary/30 hover:shadow-md"
                        }`}
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
                    )
                  })}

                  {!filteredItems.length && (
                    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                      No matching items found.
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="lg:sticky lg:top-[var(--pos-header-offset)] lg:max-h-[calc(100vh-var(--pos-header-offset)-1.5rem)] lg:overflow-y-auto lg:self-start lg:pr-0.5">
              <section className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
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
                      Add fuel above and/or products from the catalog. Fuel-only or shop-only sales are
                      both supported.
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
                            {isOnAccount
                              ? "Customer (required for on account)"
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
                              isOnAccount && !customerId
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
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground">
                            Payment method
                          </label>
                          <select
                            value={paymentMethod}
                            onChange={event => setPaymentMethod(event.target.value)}
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
                          {isOnAccount ? (
                            <p className="rounded-md border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                              Posts to <strong>Accounts Receivable</strong>. Record cash,
                              card, or transfer receipts under <strong>Payments → Received</strong>{" "}
                              when the customer pays (full or partial).
                            </p>
                          ) : null}
                        </div>

                        {paymentMethod !== "CARD" &&
                        paymentMethod !== "ON_ACCOUNT" &&
                        bankRegisters.length > 0 ? (
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">
                              Record receipt in (optional)
                            </label>
                            <select
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
                              Choose a linked bank/till register to debit that GL account for this
                              sale.
                            </p>
                          </div>
                        ) : null}

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <button
                            type="button"
                            onClick={() => setShowInvoicePreview(true)}
                            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={grandTotal <= 0}
                          >
                            Invoice Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => printUnifiedDraft()}
                            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!canPrintUnifiedDraft}
                          >
                            <Printer className="h-4 w-4" />
                            Print invoice
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleUnifiedSale()}
                            disabled={
                              grandTotal <= 0 ||
                              (cartEntries.length > 0 && cartTotals.hasNegativeTotal) ||
                              (isOnAccount && !customerId)
                            }
                            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1"
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
        </main>
      </div>

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
              <p>Payment Method: {paymentMethodLabel}</p>
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


