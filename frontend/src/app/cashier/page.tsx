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
  CheckCircle,
  ChevronDown,
  Fuel,
  Loader2,
  LogOut,
  PlusCircle,
  Printer,
  Search,
  ShoppingCart,
  X,
  XCircle,
} from "lucide-react"

type ActiveTab = "fuel" | "general"

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
  const [activeTab, setActiveTab] = useState<ActiveTab>("fuel")
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
  const [showInvoicePreview, setShowInvoicePreview] = useState(false)
  const [showGeneralInvoicePreview, setShowGeneralInvoicePreview] = useState(false)
  const [printMenuOpen, setPrintMenuOpen] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  const printMenuRef = useRef<HTMLDivElement | null>(null)

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

  const handleTabChange = (nextTab: ActiveTab) => {
    setActiveTab(nextTab)
    if (nextTab === "fuel") {
      setCartEntries([])
      setItemSearch("")
      setSelectedItem(null)
    } else {
      setQuantity("")
      setAmount("")
      setSelectedNozzle(null)
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

  const handleFuelSale = async () => {
    if (!selectedNozzle || !quantity || !amount) {
      toast.error("Select nozzle, quantity, and amount before completing the sale.")
      return
    }

    const qty = parseFloat(quantity)
    if (!qty || qty <= 0) {
      toast.error("Quantity must be greater than zero.")
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
        nozzle_id: selectedNozzle.id,
        quantity: qty,
        amount: parseFloat(amount),
        customer_id: customerId || null,
        payment_method: paymentMethod.toLowerCase(),
      }
      if (
        !isOnAccount &&
        depositBankId !== "" &&
        typeof depositBankId === "number"
      ) {
        payload.bank_account_id = depositBankId
      }
      const res = await api.post("/cashier/sale/", payload)
      const msg = res.data?.detail
      toast.success(
        typeof msg === "string" ? msg : "Fuel sale completed successfully."
      )
      setQuantity("")
      setAmount("")
      setCustomerId(null)
      setPaymentMethod("CASH")
      setVehiclePlate("")
      setShowInvoicePreview(false)
      await loadInitialData()
    } catch (error: any) {
      const msg = error.response?.data?.detail || error.response?.data?.error || (error instanceof Error ? error.message : "Fuel sale failed. Please retry.")
      toast.error(typeof msg === "string" ? msg : "Fuel sale failed. Please retry.")
    }
  }

  const handleGeneralSale = async () => {
    if (!cartEntries.length) {
      toast.error("Add items to the cart before completing the sale.")
      return
    }

    if (cartTotals.hasNegativeTotal || cartTotals.total <= 0) {
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

      if (validItems.length === 0) {
        toast.error("No valid items with quantity > 0 to complete the sale.")
        return
      }

      const payload: Record<string, unknown> = {
        sale_type: "general",
        payment_method: paymentMethod.toLowerCase(),
        items: validItems,
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
      setCustomerId(null)
      setPaymentMethod("CASH")
      await loadInitialData()
    } catch (error: any) {
      const msg = error.response?.data?.detail || error.response?.data?.error || (error instanceof Error ? error.message : "Sale could not be completed. Please retry.")
      toast.error(typeof msg === "string" ? msg : "Sale could not be completed. Please retry.")
    }
  }

  const handleCompleteSale = async () => {
    if (activeTab === "fuel") {
      await handleFuelSale()
    } else {
      await handleGeneralSale()
    }
  }

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

  const canPrintFuelDraft = Boolean(selectedNozzle && quantityNumber > 0)
  const canPrintGeneralDraft = cartEntries.length > 0 && cartTotals.total > 0

  const printFuelDraft = () => {
    if (!selectedNozzle || quantityNumber <= 0) {
      toast.error("Select a nozzle and quantity before printing the fuel invoice.")
      return
    }
    const custLabel = customerId
      ? customers.find(c => c.id === customerId)?.display_name || `ID ${customerId}`
      : "Walk-in"
    const inv = `INV-${(selectedNozzle.nozzle_number || "0000")
      .replace(/[^0-9]/g, "")
      .padStart(6, "0")}`
    const body = `
      <div class="co">
        <h1>Fuel invoice (draft)</h1>
        <div><strong>${escapeHtml(posCompanyLabel)}</strong></div>
        ${posCompanyAddress ? `<div class="muted">${escapeHtml(posCompanyAddress)}</div>` : ""}
        <p class="muted">Printed ${escapeHtml(formatDate(new Date(), true))}</p>
      </div>
      <p class="muted">Customer: ${escapeHtml(custLabel)} · Payment: ${escapeHtml(
      paymentMethodLabel
    )}${vehiclePlate ? ` · Vehicle: ${escapeHtml(vehiclePlate.toUpperCase())}` : ""}</p>
      <table><thead><tr><th>Invoice #</th><th>Nozzle</th></tr></thead><tbody>
      <tr><td>${escapeHtml(inv)}</td><td>${escapeHtml(selectedNozzle.nozzle_number)}</td></tr></tbody></table>
      <table><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit price</th><th class="right">Amount</th></tr></thead><tbody>
      <tr><td>${escapeHtml(selectedNozzle.product_name)}</td><td class="right">${escapeHtml(
      formatNumber(quantityNumber)
    )} ${escapeHtml(selectedUnit)}</td><td class="right">${escapeHtml(currencySymbol)}${escapeHtml(
      formatNumber(unitPrice)
    )}</td><td class="right">${escapeHtml(currencySymbol)}${escapeHtml(
      formatNumber(amountNumber)
    )}</td></tr>
      </tbody></table>
      <table><tbody>
      <tr><td>Subtotal</td><td class="right">${escapeHtml(currencySymbol)}${escapeHtml(
      formatNumber(amountNumber)
    )}</td></tr>
      <tr><td>Tax</td><td class="right">${escapeHtml(currencySymbol)}0.00</td></tr>
      <tr class="row-total"><td>Total due</td><td class="right">${escapeHtml(currencySymbol)}${escapeHtml(
      formatNumber(amountNumber)
    )}</td></tr>
      </tbody></table>`
    openPosPrintWindow(`Fuel invoice ${inv}`, body)
  }

  const printGeneralDraft = () => {
    if (!cartEntries.length || cartTotals.total <= 0) {
      toast.error("Add items to the cart with a positive total before printing.")
      return
    }
    const custLabel = customerId
      ? customers.find(c => c.id === customerId)?.display_name || `ID ${customerId}`
      : "Walk-in"
    const invSuffix =
      cartEntries.length > 0
        ? String(cartEntries[0].item.id).padStart(6, "0")
        : String(Date.now()).slice(-6)
    const inv = `GENERAL-${invSuffix}`
    const rows = cartEntries
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
        <h1>Invoice (draft) — products &amp; services</h1>
        <div><strong>${escapeHtml(posCompanyLabel)}</strong></div>
        ${posCompanyAddress ? `<div class="muted">${escapeHtml(posCompanyAddress)}</div>` : ""}
        <p class="muted">Printed ${escapeHtml(formatDate(new Date(), true))} · ${escapeHtml(
      formatDate(new Date())
    )}</p>
      </div>
      <p class="muted">Customer: ${escapeHtml(custLabel)} · Payment: ${escapeHtml(paymentMethodLabel)}</p>
      <p class="muted">Invoice # ${escapeHtml(inv)}</p>
      <table><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Disc.</th><th class="right">Amount</th></tr></thead><tbody>
      ${rows}
      </tbody></table>
      <table><tbody>
      <tr><td>Subtotal</td><td class="right">${escapeHtml(currencySymbol)}${escapeHtml(
      formatNumber(cartTotals.subtotal)
    )}</td></tr>
      ${
        cartTotals.discountTotal > 0
          ? `<tr><td>Discounts</td><td class="right">-${escapeHtml(currencySymbol)}${escapeHtml(
              formatNumber(cartTotals.discountTotal)
            )}</td></tr>`
          : ""
      }
      ${
        cartTotals.paymentTotal > 0
          ? `<tr><td>Payments / deposits</td><td class="right">-${escapeHtml(currencySymbol)}${escapeHtml(
              formatNumber(cartTotals.paymentTotal)
            )}</td></tr>`
          : ""
      }
      <tr class="row-total"><td>Total due</td><td class="right">${escapeHtml(currencySymbol)}${escapeHtml(
      formatNumber(cartTotals.total)
    )}</td></tr>
      </tbody></table>`
    openPosPrintWindow(`Invoice ${inv}`, body)
  }

  const printDraftInvoiceForActiveTab = () => {
    setPrintMenuOpen(false)
    if (activeTab === "fuel") printFuelDraft()
    else printGeneralDraft()
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
      <div className="flex h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Sidebar />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex flex-col gap-4 border-b border-gray-200 bg-white/80 px-6 py-4 backdrop-blur">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 lg:text-3xl">
                {activeTab === "fuel"
                  ? "POS - Fuel Sales"
                  : "POS - Products & Services"}
              </h1>
              <p className="text-sm text-gray-500">
                {activeTab === "fuel"
                  ? "Select a nozzle, enter quantity and complete the fuel sale. For house / credit customers, use On account (A/R) and record cash later under Payments → Received."
                  : "Browse catalog items, build the cart and complete the invoice. On account posts to accounts receivable; partial payments are applied when the customer pays."}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="relative" ref={printMenuRef}>
                <button
                  type="button"
                  disabled={printBusy}
                  onClick={() => setPrintMenuOpen(o => !o)}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {printBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  ) : (
                    <Printer className="h-4 w-4 text-gray-600" />
                  )}
                  Print
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                </button>
                {printMenuOpen ? (
                  <div className="absolute right-0 z-[60] mt-1 w-64 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      disabled={
                        (activeTab === "fuel" && !canPrintFuelDraft) ||
                        (activeTab === "general" && !canPrintGeneralDraft)
                      }
                      onClick={printDraftInvoiceForActiveTab}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                    >
                      <span className="font-medium">Draft invoice</span>
                      <span className="block text-xs text-gray-500">
                        {activeTab === "fuel" ? "Fuel line (nozzle + qty)" : "Shopping cart"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void printPosSummaryReport()}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                    >
                      <span className="font-medium">POS summary report</span>
                      <span className="block text-xs text-gray-500">
                        Today&apos;s sales &amp; dashboard totals
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={!customerId}
                      onClick={() => void printCustomerLedgerStatement()}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                    >
                      <span className="font-medium">Customer A/R statement</span>
                      <span className="block text-xs text-gray-500">
                        Ledger for selected customer
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="text-right text-sm text-gray-500">
                <p className="font-medium text-gray-700">{posCompanyLabel}</p>
                {posCompanyAddress ? <p>{posCompanyAddress}</p> : null}
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => handleTabChange("fuel")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === "fuel"
                  ? "bg-blue-600 text-white shadow-lg"
                  : "bg-white text-gray-600 hover:bg-blue-50"
              }`}
            >
              Fuel Sale
            </button>
            <button
              onClick={() => handleTabChange("general")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === "general"
                  ? "bg-blue-600 text-white shadow-lg"
                  : "bg-white text-gray-600 hover:bg-blue-50"
              }`}
            >
              General Products
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto px-6 py-6">
          {activeTab === "fuel" ? (
            <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Nozzles</h2>
                  <span className="text-sm text-gray-500">
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
                        className={`relative rounded-xl border p-4 text-left transition ${
                          isSelected
                            ? "border-blue-500 bg-blue-50 shadow-lg"
                            : "border-gray-200 bg-white hover:border-blue-200"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-gray-700">
                              {nozzle.nozzle_number}
                            </p>
                            {nozzle.nozzle_name && (
                              <p className="text-xs text-gray-500">{nozzle.nozzle_name}</p>
                            )}
                            <p className="text-xs text-gray-500">
                              {[nozzle.station_name, nozzle.island_name, nozzle.dispenser_name]
                                .filter(Boolean)
                                .join(" • ")}
                            </p>
                          </div>
                          <Fuel className="h-5 w-5 text-blue-500" />
                        </div>

                        <div className="mt-3 space-y-2 text-sm text-gray-600">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-semibold text-gray-800">
                              {nozzle.product_name}
                            </p>
                            <p className="text-sm font-semibold text-gray-800">
                              {currencySymbol}{formatNumber(Number(nozzle.product_price || 0))} /{" "}
                              {nozzle.product_unit || "L"}
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                            <div>
                              <p className="text-gray-500">Meter</p>
                              <p className="font-medium text-gray-700">
                                {nozzle.meter_number || "-"}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                                <span className="inline-flex items-center gap-1">
                                  <XCircle className="h-3 w-3 text-red-500" />
                                  {formatNumber(baseReading)}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <CheckCircle className="h-3 w-3 text-emerald-500" />
                                  {formatNumber(liveReading)}
                                </span>
                              </div>
                            </div>
                            <div>
                              <p className="text-gray-500">Tank</p>
                              <p className="font-medium text-gray-700">
                                {nozzle.tank_number || "-"}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                                <span className="inline-flex items-center gap-1">
                                  <XCircle className="h-3 w-3 text-red-500" />
                                  {formatNumber(baseStock)}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <CheckCircle className="h-3 w-3 text-emerald-500" />
                                  {formatNumber(liveStock)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 h-1.5 rounded-full bg-gray-100">
                          <div
                            className="h-1.5 rounded-full bg-blue-500 transition-all"
                            style={{ width: `${fillPercent}%` }}
                          />
                        </div>
                      </button>
                    )
                  })}

                  {!nozzles.length && (
                    <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                      No nozzles configured yet.
                    </div>
                  )}
                </div>

              </section>

              <section className="space-y-4">
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-semibold text-gray-900">Fuel Sale</h2>
                  {selectedNozzle ? (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
                        {selectedNozzle.product_name} — {currencySymbol}
                        {formatNumber(Number(selectedNozzle.product_price || 0))} per{" "}
                        {selectedNozzle.product_unit || "L"}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-600">
                          Quantity ({selectedNozzle.product_unit || "L"})
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={quantity}
                          onChange={event => handleQuantityChange(event.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-600">
                          Amount ({currencySymbol})
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={amount}
                          onChange={event => handleAmountChange(event.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-600">
                          {isOnAccount
                            ? "Customer (required for on account)"
                            : "Customer (optional)"}
                        </label>
                        <select
                          value={customerId || ""}
                          onChange={event =>
                            setCustomerId(
                              event.target.value ? Number(event.target.value) : null
                            )
                          }
                          className={`w-full rounded-lg border px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 ${
                            isOnAccount && !customerId
                              ? "border-amber-400 bg-amber-50"
                              : "border-gray-300"
                          }`}
                        >
                          <option value="">Walk-in</option>
                          {customers.map(customer => (
                            <option key={customer.id} value={customer.id}>
                              {customer.display_name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-600">
                          Payment method
                        </label>
                        <select
                          value={paymentMethod}
                          onChange={event => setPaymentMethod(event.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
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
                          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                            Sale posts to <strong>Accounts Receivable</strong> (not cash in
                            drawer). Customer balance increases; use{" "}
                            <strong>Payments → Received</strong> for weekly, monthly, or
                            partial settlements.
                          </p>
                        ) : null}
                      </div>

                      {paymentMethod !== "CARD" &&
                      paymentMethod !== "ON_ACCOUNT" &&
                      bankRegisters.length > 0 ? (
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-600">
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
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
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
                          <p className="text-xs text-gray-500">
                            To put the sale straight on a bank or till account, pick a register
                            linked to your chart (Chart of Accounts → bank details).
                          </p>
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-600">
                          Vehicle plate number (optional)
                        </label>
                        <input
                          type="text"
                          value={vehiclePlate}
                          onChange={event => setVehiclePlate(event.target.value)}
                          placeholder="E.g. DHA-1234"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </div>

                      {shouldShowLivePreview && (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 shadow-sm">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <p className="text-xs font-semibold uppercase text-gray-500">
                                Meter Reading ({selectedUnit})
                              </p>
                              <div className="mt-2 grid grid-cols-2 gap-3">
                                <div>
                                  <p className="text-gray-500">Before Sale</p>
                                  <p className="font-semibold text-gray-900">
                                    {formatNumber(meterStart)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-gray-500">After Sale</p>
                                  <p className="font-semibold text-gray-900">
                                    {formatNumber(meterProjected)}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase text-gray-500">
                                Tank Stock ({selectedUnit})
                              </p>
                              <div className="mt-2 grid grid-cols-2 gap-3">
                                <div>
                                  <p className="text-gray-500">Before Sale</p>
                                  <p className="font-semibold text-gray-900">
                                    {formatNumber(tankStart)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-gray-500">After Sale</p>
                                  <p className="font-semibold text-gray-900">
                                    {formatNumber(tankProjected)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => setShowInvoicePreview(prev => !prev)}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                          disabled={!selectedNozzle || quantityNumber <= 0}
                        >
                          Invoice Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => printFuelDraft()}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!canPrintFuelDraft}
                        >
                          <Printer className="h-4 w-4" />
                          Print invoice
                        </button>
                        <button
                          type="button"
                          onClick={handleFuelSale}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                          disabled={
                            !quantity ||
                            !amount ||
                            parseFloat(quantity) <= 0 ||
                            (isOnAccount && !customerId)
                          }
                        >
                          <Fuel className="h-4 w-4" />
                          Complete Fuel Sale
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                      Select a nozzle to begin a sale.
                    </div>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
              <section className="space-y-4">
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">
                      Products & Services
                    </h2>
                    <div className="relative w-full sm:w-72">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={itemSearch}
                        onChange={event => setItemSearch(event.target.value)}
                        placeholder="Search products, services, or scan barcode"
                        className="w-full rounded-lg border border-gray-300 px-10 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
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
                          className={`rounded-xl border p-4 text-left transition ${
                            isSelected
                              ? "border-blue-500 bg-blue-50 shadow-lg"
                              : "border-gray-200 bg-white hover:border-blue-200 hover:shadow"
                          }`}
                        >
                          {/* Item Image */}
                          {getImageUrl(item.image_url) && (
                            <div className="mb-3 flex justify-center">
                              <img
                                src={getImageUrl(item.image_url)!}
                                alt={item.name}
                                className="h-24 w-24 object-contain rounded-lg border border-gray-200 bg-gray-50"
                                onError={(e) => {
                                  // Hide image on error
                                  (e.target as HTMLImageElement).style.display = 'none'
                                }}
                              />
                            </div>
                          )}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <p className={`text-sm font-semibold ${
                                isSelected ? "text-blue-900" : "text-gray-800"
                              }`}>
                                {item.name}
                              </p>
                              <p className="text-xs uppercase text-gray-500">
                                {item.item_type.replace(/_/g, " ")}
                              </p>
                              {item.pos_category && (
                                <p className="text-xs text-gray-400">{item.pos_category}</p>
                              )}
                            </div>
                            <PlusCircle className={`h-5 w-5 flex-shrink-0 ${
                              isSelected ? "text-blue-600" : "text-blue-500"
                            }`} />
                          </div>
                          <p className={`mt-3 text-sm font-semibold ${
                            isSelected ? "text-blue-900" : "text-gray-800"
                          }`}>
                            {currencySymbol}{formatNumber(Number(item.unit_price || 0))}
                            {item.unit && (
                              <span className="text-xs font-normal text-gray-500"> / {item.unit}</span>
                            )}
                          </p>
                          {item.quantity_on_hand !== undefined && item.item_type?.toLowerCase() === 'inventory' && (
                            <p className="text-xs text-gray-500">
                              In stock: {formatNumber(Number(item.quantity_on_hand))} {item.unit || 'units'}
                            </p>
                          )}
                        </button>
                      )
                    })}

                    {!filteredItems.length && (
                      <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                        No matching items found.
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">Cart</h2>
                    {!!cartEntries.length && (
                      <button
                        type="button"
                        onClick={() => setCartEntries([])}
                        className="text-sm font-medium text-red-600 hover:text-red-700"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {!cartEntries.length ? (
                    <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                      Add products from the catalog to begin a sale.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {cartEntries.map(entry => {
                        const lineAmount = roundTwo(entry.quantity * entry.unitPrice)
                        const isAdjustment =
                          entry.item.item_type === "discount" ||
                          entry.item.item_type === "payment"

                        return (
                          <div
                            key={entry.item.id}
                            className="rounded-lg border border-gray-200 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3 flex-1">
                                {/* Item Image in Cart */}
                                {getImageUrl(entry.item.image_url) && (
                                  <img
                                    src={getImageUrl(entry.item.image_url)!}
                                    alt={entry.item.name}
                                    className="h-12 w-12 object-contain rounded border border-gray-200 bg-gray-50 flex-shrink-0"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none'
                                    }}
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-gray-900">
                                    {entry.item.name}
                                  </p>
                                  <p className="text-xs uppercase text-gray-500">
                                    {entry.item.item_type.replace(/_/g, " ")}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeCartItem(entry.item.id)}
                                className="text-gray-400 hover:text-red-600 flex-shrink-0"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                              <div>
                                <label className="block text-xs font-semibold text-gray-500">
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
                                  className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                />
                              </div>

                              <div>
                                <label className="block text-xs font-semibold text-gray-500">
                                  Unit Price ({currencySymbol})
                                  {entry.item.unit && (
                                    <span className="text-gray-400"> / {entry.item.unit}</span>
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
                                  className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                />
                              </div>

                              {!isAdjustment && (
                                <div>
                                  <label className="block text-xs font-semibold text-gray-500">
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
                                    className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                  />
                                </div>
                              )}
                            </div>

                            <div className="mt-3 flex items-center justify-between text-sm">
                              <span className="text-gray-500">Line total</span>
                              <span
                                className={`text-base font-semibold ${
                                  lineAmount < 0 ? "text-red-600" : "text-green-600"
                                }`}
                              >
                                {currencySymbol}{formatNumber(lineAmount)}
                              </span>
                            </div>
                          </div>
                        )
                      })}

                      <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Subtotal</span>
                          <span className="font-semibold text-gray-900">
                            {currencySymbol}{formatNumber(cartTotals.subtotal)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Discounts</span>
                          <span className="font-semibold text-red-600">
                            -{currencySymbol}{formatNumber(cartTotals.discountTotal)}
                          </span>
                        </div>
                        {cartTotals.paymentTotal > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Payments / Deposits</span>
                            <span className="font-semibold text-orange-600">
                              -{currencySymbol}{formatNumber(cartTotals.paymentTotal)}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-base">
                          <span className="font-semibold text-gray-800">Total Due</span>
                          <span
                            className={`text-lg font-bold ${
                              cartTotals.total >= 0 ? "text-green-600" : "text-red-600"
                            }`}
                          >
                            {currencySymbol}{formatNumber(cartTotals.total)}
                          </span>
                        </div>
                        {cartTotals.hasNegativeTotal && (
                          <p className="text-xs text-red-600">
                            Total cannot be negative. Adjust discounts or deposits.
                          </p>
                        )}
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-600">
                            {isOnAccount
                              ? "Customer (required for on account)"
                              : "Customer (optional)"}
                          </label>
                          <select
                            value={customerId || ""}
                            onChange={event =>
                              setCustomerId(
                                event.target.value ? Number(event.target.value) : null
                              )
                            }
                            className={`w-full rounded-lg border px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 ${
                              isOnAccount && !customerId
                                ? "border-amber-400 bg-amber-50"
                                : "border-gray-300"
                            }`}
                          >
                            <option value="">Walk-in</option>
                            {customers.map(customer => (
                              <option key={customer.id} value={customer.id}>
                                {customer.display_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-600">
                            Payment method
                          </label>
                          <select
                            value={paymentMethod}
                            onChange={event => setPaymentMethod(event.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
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
                            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
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
                            <label className="text-sm font-medium text-gray-600">
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
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
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
                            <p className="text-xs text-gray-500">
                              Choose a linked bank/till register to debit that GL account for this
                              sale.
                            </p>
                          </div>
                        ) : null}

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <button
                            type="button"
                            onClick={() => setShowGeneralInvoicePreview(prev => !prev)}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                            disabled={!cartEntries.length || cartTotals.total <= 0}
                          >
                            Invoice Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => printGeneralDraft()}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!canPrintGeneralDraft}
                          >
                            <Printer className="h-4 w-4" />
                            Print invoice
                          </button>
                          <button
                            type="button"
                            onClick={handleGeneralSale}
                            disabled={
                              !cartEntries.length ||
                              cartTotals.hasNegativeTotal ||
                              cartTotals.total <= 0 ||
                              (isOnAccount && !customerId)
                            }
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            <ShoppingCart className="h-4 w-4" />
                            Complete Sale
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {/* Fuel Invoice Preview Modal */}
      <Modal
        isOpen={showInvoicePreview && !!selectedNozzle && quantityNumber > 0}
        onClose={() => setShowInvoicePreview(false)}
        title="Fuel Invoice Preview"
        size="lg"
      >
        {selectedNozzle ? (
          <div className="space-y-6">
            <div className="text-center">
              <h3 className="text-xl font-semibold text-gray-900">
                {posCompanyLabel}
              </h3>
              {posCompanyAddress ? (
                <div className="mt-1 text-sm text-gray-500">
                  <p>{posCompanyAddress}</p>
                </div>
              ) : null}
              <div className="mt-3 text-sm text-gray-600">
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

            <div className="rounded-lg border border-gray-200">
              <div className="grid grid-cols-2 gap-4 border-b border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                <div>
                  <p className="font-medium text-gray-500 uppercase tracking-wide text-xs">
                    Invoice
                  </p>
                  <p>
                    INV-{(selectedNozzle?.nozzle_number || "0000")
                      .replace(/[^0-9]/g, "")
                      .padStart(6, "0")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-500 uppercase tracking-wide text-xs">
                    Nozzle
                  </p>
                  <p>{selectedNozzle.nozzle_number}</p>
                </div>
              </div>

              <div className="p-4">
                <table className="w-full text-sm text-gray-700">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="pb-2">Item</th>
                      <th className="pb-2 text-right">Quantity</th>
                      <th className="pb-2 text-right">Unit Price</th>
                      <th className="pb-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-gray-200">
                      <td className="py-3">
                        <p className="font-medium text-gray-900">
                          {selectedNozzle.product_name}
                        </p>
                      </td>
                      <td className="py-3 text-right">
                        {formatNumber(quantityNumber)} {selectedUnit}
                      </td>
                      <td className="py-3 text-right">
                        {currencySymbol}{formatNumber(Number(unitPrice))}
                      </td>
                      <td className="py-3 text-right font-semibold text-gray-900">
                        {currencySymbol}{formatNumber(Number(amountNumber || 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-12 border-t border-gray-200 bg-gray-50 p-4 text-sm">
                <div className="space-y-1 text-right">
                  <div className="flex items-center justify-between gap-6">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="font-medium">
                      {currencySymbol}{formatNumber(Number(amountNumber || 0))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <span className="text-gray-600">Tax</span>
                    <span className="font-medium">{currencySymbol}0.00</span>
                  </div>
                  <div className="flex items-center justify-between gap-6 text-base font-semibold text-gray-900">
                    <span>Total Due</span>
                    <span>{currencySymbol}{formatNumber(Number(amountNumber || 0))}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-500">
              <p>
                Date/Time:{" "}
                {formatDate(new Date(), true)}
              </p>
            </div>
            <div className="flex justify-end border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={() => printFuelDraft()}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                <Printer className="h-4 w-4" />
                Print invoice
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* General Products Invoice Preview Modal */}
      <Modal
        isOpen={showGeneralInvoicePreview && cartEntries.length > 0}
        onClose={() => setShowGeneralInvoicePreview(false)}
        title="General Products Invoice Preview"
        size="lg"
      >
        <div className="space-y-6">
          <div className="text-center">
            <h3 className="text-xl font-semibold text-gray-900">
              {posCompanyLabel}
            </h3>
            {posCompanyAddress ? (
              <div className="mt-1 text-sm text-gray-500">
                <p>{posCompanyAddress}</p>
              </div>
            ) : null}
            <div className="mt-3 text-sm text-gray-600">
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
            </div>
          </div>

          <div className="rounded-lg border border-gray-200">
            <div className="grid grid-cols-2 gap-4 border-b border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
              <div>
                <p className="font-medium text-gray-500 uppercase tracking-wide text-xs">
                  Invoice
                </p>
                <p>
                  GENERAL-{cartEntries.length > 0 
                    ? cartEntries[0].item.id.toString().padStart(6, "0")
                    : new Date().getTime().toString().slice(-6)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium text-gray-500 uppercase tracking-wide text-xs">
                  Date
                </p>
                <p>{formatDate(new Date())}</p>
              </div>
            </div>

            <div className="p-4">
              <table className="w-full text-sm text-gray-700">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="pb-2">Item</th>
                    <th className="pb-2 text-right">Quantity</th>
                    <th className="pb-2 text-right">Unit Price</th>
                    <th className="pb-2 text-right">Discount</th>
                    <th className="pb-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {cartEntries.map((entry) => {
                    const lineAmount = roundTwo(entry.quantity * entry.unitPrice)
                    const discountAmount = roundTwo(lineAmount * (entry.discountPercent / 100))
                    const finalAmount = roundTwo(lineAmount - discountAmount)
                    
                    return (
                      <tr key={entry.item.id} className="border-t border-gray-200">
                        <td className="py-3">
                          <p className="font-medium text-gray-900">
                            {entry.item.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {entry.item.item_type.replace(/_/g, " ")}
                          </p>
                        </td>
                        <td className="py-3 text-right">
                          {formatNumber(entry.quantity)} {entry.item.unit || 'units'}
                        </td>
                        <td className="py-3 text-right">
                          {currencySymbol}{formatNumber(entry.unitPrice)}
                        </td>
                        <td className="py-3 text-right text-red-600">
                          {entry.discountPercent > 0 ? `${formatNumber(entry.discountPercent)}%` : '-'}
                        </td>
                        <td className="py-3 text-right font-semibold text-gray-900">
                          {currencySymbol}{formatNumber(finalAmount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-12 border-t border-gray-200 bg-gray-50 p-4 text-sm">
              <div className="space-y-1 text-right">
                <div className="flex items-center justify-between gap-6">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium">
                    {currencySymbol}{formatNumber(cartTotals.subtotal)}
                  </span>
                </div>
                {cartTotals.discountTotal > 0 && (
                  <div className="flex items-center justify-between gap-6">
                    <span className="text-gray-600">Discounts</span>
                    <span className="font-medium text-red-600">
                      -{currencySymbol}{formatNumber(cartTotals.discountTotal)}
                    </span>
                  </div>
                )}
                {cartTotals.paymentTotal > 0 && (
                  <div className="flex items-center justify-between gap-6">
                    <span className="text-gray-600">Payments / Deposits</span>
                    <span className="font-medium text-orange-600">
                      -{currencySymbol}{formatNumber(cartTotals.paymentTotal)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-6 text-base font-semibold text-gray-900">
                  <span>Total Due</span>
                  <span>{currencySymbol}{formatNumber(cartTotals.total)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-500">
            <p>
              Date/Time:{" "}
              {formatDate(new Date(), true)}
            </p>
          </div>
          <div className="flex justify-end border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => printGeneralDraft()}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
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


