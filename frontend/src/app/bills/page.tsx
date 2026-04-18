'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Edit, Trash2, Search, X, PlusCircle, Eye, Edit2, FileText } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getApiBaseUrl } from '@/lib/api'
import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'
import { getCurrencySymbol } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import { AMOUNT_LINE_COL_CLASS, AMOUNT_READ_ONLY_INPUT_CLASS } from '@/utils/amountFieldStyles'
import { extractErrorMessage } from '@/utils/errorHandler'

interface BillLineItem {
  id?: number
  line_number: number
  description?: string
  item_id?: number
  expense_account_id?: number
  tank_id?: number  // For fuel items - specifies which tank to receive fuel into
  tank_name?: string | null
  quantity: number
  unit_cost?: number
  unit_price?: number
  amount: number
  tax_amount: number
}

interface Bill {
  id: number
  bill_number: string
  vendor_id: number
  vendor_name?: string
  vendor_number?: string
  bill_date: string
  due_date?: string
  vendor_reference?: string
  memo?: string
  status: string
  subtotal?: number | string
  tax_amount?: number | string
  tax_total?: number | string
  total_amount?: number | string
  total?: number | string
  amount_paid?: number | string
  balance_due?: number | string
  created_at?: string
  updated_at?: string
  lines: BillLineItem[]
}

function parseMoney(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function billTotal(b: Bill): number {
  return parseMoney(b.total_amount ?? b.total)
}

function billTax(b: Bill): number {
  return parseMoney(b.tax_amount ?? b.tax_total)
}

function billPaid(b: Bill): number {
  return parseMoney(b.amount_paid)
}

function billBalance(b: Bill): number {
  if (b.balance_due !== undefined && b.balance_due !== null && b.balance_due !== '') {
    return parseMoney(b.balance_due)
  }
  return Math.max(0, billTotal(b) - billPaid(b))
}

function billSubtotal(b: Bill): number {
  return parseMoney(b.subtotal)
}

/** Collapse spaces so "Diesel Tank 1" matches "Diesel  Tank  1". */
function normalizeStockLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Default receiving tank: name match (e.g. Diesel → Diesel Tank 1), else first by tank_name. */
function defaultTankIdForProduct(itemId: number, itemList: Item[], tankList: Tank[]): number | undefined {
  const productTanks = tankList
    .filter((t) => t.product_id === itemId)
    .slice()
    .sort((a, b) =>
      a.tank_name.localeCompare(b.tank_name, undefined, { sensitivity: 'base', numeric: true })
    )
  if (productTanks.length === 0) return undefined
  const item = itemList.find((i) => i.id === itemId)
  const name = normalizeStockLabel(item?.name || '')
  if (name) {
    const byPrefix = productTanks.find((t) => normalizeStockLabel(t.tank_name).startsWith(name))
    if (byPrefix) return byPrefix.id
    const byContains = productTanks.find((t) => normalizeStockLabel(t.tank_name).includes(name))
    if (byContains) return byContains.id
    const words = name.replace(/-/g, ' ').split(/\s+/).filter((w) => w.length > 1)
    for (const w of words) {
      const hit = productTanks.find((t) => normalizeStockLabel(t.tank_name).includes(w))
      if (hit) return hit.id
    }
  }
  return productTanks[0].id
}

function formatBillStatusLabel(status: string): string {
  const s = (status || '').toLowerCase()
  const map: Record<string, string> = {
    partial: 'Partially paid',
    partially_paid: 'Partially paid',
    open: 'Open',
    draft: 'Draft',
    paid: 'Paid',
    overdue: 'Overdue',
    void: 'Void',
  }
  return (map[s] || s.replace(/_/g, ' ') || '—').toUpperCase()
}

interface Vendor {
  id: number
  vendor_number: string
  display_name: string
  is_active: boolean
}

interface Item {
  id: number
  item_number: string
  name: string
  cost: number
  unit: string
  item_type: string  // 'inventory', 'non_inventory', 'service'
  pos_category?: string  // 'fuel', 'general', etc.
  quantity_on_hand?: number | string
}

interface Tank {
  id: number
  tank_number: string
  tank_name: string
  product_id: number
  capacity: number
  current_stock: number
  station_name?: string
  unit_of_measure?: string
}

function parseQtyLoose(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

interface TankIssueRow {
  tankId: number
  tankName: string
  unit: string
  capacity: number
  currentStock: number
  remainingUllage: number
  receiptQty: number
  projected: number
  overBy: number
}

interface CatalogLineRow {
  itemName: string
  billQty: number
  quantityOnHand: number | null
  unit: string
}

/** Resolve receiving tank for a bill line (matches backend routing). */
function resolveLineTank(
  line: BillLineItem,
  itemList: Item[],
  tankList: Tank[]
): Tank | undefined {
  if (!line.item_id) return undefined
  const itemTanks = tankList.filter(t => t.product_id === line.item_id)
  if (itemTanks.length === 0) return undefined
  if (line.tank_id) {
    const byId = itemTanks.find(t => t.id === line.tank_id)
    if (byId) return byId
  }
  const defId = defaultTankIdForProduct(line.item_id, itemList, tankList)
  if (defId) {
    const t = itemTanks.find(x => x.id === defId)
    if (t) return t
  }
  return itemTanks.slice().sort((a, b) => a.tank_name.localeCompare(b.tank_name))[0]
}

/**
 * When fuel receipt would exceed tank capacity, return rows for the warning modal.
 * Only lines that map to a tank with capacity > 0 are considered.
 */
function buildTankOverfillReview(
  lines: BillLineItem[],
  itemList: Item[],
  tankList: Tank[]
): { tankIssues: TankIssueRow[]; catalogLines: CatalogLineRow[] } | null {
  const totals = new Map<number, number>()
  for (const line of lines) {
    const tank = resolveLineTank(line, itemList, tankList)
    if (!tank) continue
    const cap = parseQtyLoose(tank.capacity)
    if (!(cap > 0)) continue
    const q = parseQtyLoose(line.quantity)
    if (q <= 0) continue
    totals.set(tank.id, (totals.get(tank.id) || 0) + q)
  }
  const tankIssues: TankIssueRow[] = []
  for (const [tankId, receiptQty] of totals) {
    const t = tankList.find(x => x.id === tankId)
    if (!t) continue
    const cap = parseQtyLoose(t.capacity)
    const cur = parseQtyLoose(t.current_stock)
    const projected = cur + receiptQty
    if (projected <= cap) continue
    const u = (t.unit_of_measure || 'L').trim() || 'L'
    const rem = Math.max(0, cap - cur)
    tankIssues.push({
      tankId,
      tankName: t.tank_name || t.tank_number || `Tank #${tankId}`,
      unit: u,
      capacity: cap,
      currentStock: cur,
      remainingUllage: rem,
      receiptQty,
      projected,
      overBy: projected - cap,
    })
  }
  if (tankIssues.length === 0) return null
  const catalogLines: CatalogLineRow[] = []
  for (const line of lines) {
    if (!line.item_id) continue
    const it = itemList.find(i => i.id === line.item_id)
    if (!it) continue
    const qohRaw = it.quantity_on_hand
    const qoh =
      qohRaw === undefined || qohRaw === null || qohRaw === ''
        ? null
        : parseQtyLoose(qohRaw)
    catalogLines.push({
      itemName: it.name,
      billQty: parseQtyLoose(line.quantity),
      quantityOnHand: qoh,
      unit: (it.unit || 'units').trim() || 'units',
    })
  }
  return { tankIssues, catalogLines }
}

interface ExpenseAccount {
  id: number
  account_code: string
  account_name: string
  account_type: string
  account_sub_type?: string
}

export default function BillsPage() {
  const router = useRouter()
  const toast = useToast()
  const [bills, setBills] = useState<Bill[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [expenseAccounts, setExpenseAccounts] = useState<ExpenseAccount[]>([])
  const [tanks, setTanks] = useState<Tank[]>([])  // All tanks for the company
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [showModal, setShowModal] = useState(false)
  const [approveBill, setApproveBill] = useState(false)
  const [postDraftBillOnUpdate, setPostDraftBillOnUpdate] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingBill, setEditingBill] = useState<Bill | null>(null)
  const [viewingBill, setViewingBill] = useState<Bill | null>(null)
  /** Tank capacity / stock review before save (warning only; posting may send acknowledge_tank_overfill). */
  const [stockReviewOpen, setStockReviewOpen] = useState(false)
  const [stockReviewPayload, setStockReviewPayload] = useState<{
    mode: 'create' | 'edit'
    tankIssues: TankIssueRow[]
    catalogLines: CatalogLineRow[]
    needsServerAck: boolean
    draftNote: boolean
  } | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [formData, setFormData] = useState(() => {
    const billDate = new Date().toISOString().split('T')[0]
    const due = new Date(`${billDate}T12:00:00`)
    due.setDate(due.getDate() + 30)
    return {
      vendor_id: 0,
      bill_date: billDate,
      due_date: due.toISOString().split('T')[0],
      vendor_reference: '',
      memo: '',
      lines: [] as BillLineItem[],
    }
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    
    // Get user role from localStorage
    const userStr = localStorage.getItem('user')
    if (userStr) {
      try {
        const user = JSON.parse(userStr)
        setUserRole(user.role?.toLowerCase() || null)
      } catch (error) {
        console.error('Error parsing user data:', error)
      }
    }
    
    fetchData()
  }, [router, statusFilter])

  // Fetch vendors when modal opens if not already loaded
  useEffect(() => {
    if (showModal && vendors.length === 0 && !loading) {
      const fetchVendorsOnly = async () => {
        try {
          const token = localStorage.getItem('access_token')
          const baseUrl = getApiBaseUrl()
          const response = await fetch(`${baseUrl}/vendors/`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          if (response.ok) {
            const vendorsData = await response.json()
            setVendors(vendorsData.filter((v: Vendor) => v.is_active))
          } else {
            console.error('❌ Failed to load vendors:', response.status)
            toast.error('Failed to load vendors')
          }
        } catch (error) {
          console.error('❌ Error fetching vendors:', error)
        }
      }
      fetchVendorsOnly()
    }
  }, [showModal, vendors.length, loading])

  const fetchData = async () => {
    try {
      // Fetch company currency
      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        console.error('Error fetching company currency:', error)
      }

      const [billsRes, vendorsRes, itemsRes, accountsRes, tanksRes] = await Promise.allSettled([
        api.get(`/bills/?status_filter=${statusFilter || ''}`),
        api.get('/vendors/'),
        api.get('/items/'),
        api.get('/chart-of-accounts/'),
        api.get('/tanks/')
      ])

      if (billsRes.status === 'fulfilled') {
        setBills(billsRes.value.data)
      } else {
        console.error('Failed to load bills:', billsRes)
        toast.error('Failed to load bills')
      }

      if (vendorsRes.status === 'fulfilled') {
        const vendorsData = vendorsRes.value.data
        const activeVendors = vendorsData.filter((v: Vendor) => v.is_active)
        setVendors(activeVendors)
      } else {
        console.error('❌ Failed to load vendors:', vendorsRes)
        toast.error('Failed to load vendors')
      }

      if (itemsRes.status === 'fulfilled') {
        try {
          const itemsData = itemsRes.value?.data || []
          if (Array.isArray(itemsData)) {
            setItems(itemsData)
            if (itemsData.length === 0) {
              console.warn('⚠️ No items found in database')
            }
          } else {
            console.error('❌ Items data is not an array:', itemsData)
            toast.error('Items data format error')
          }
        } catch (err: any) {
          console.error('❌ Error processing items:', err)
          console.error('❌ Items response:', itemsRes.value)
          toast.error('Failed to process items data')
        }
      } else {
        console.error('❌ Failed to load items:', itemsRes.reason)
        const errorMsg = itemsRes.reason?.response?.data?.detail || itemsRes.reason?.message || 'Unknown error'
        console.error('❌ Items API error details:', errorMsg)
        toast.error(`Failed to load items: ${errorMsg}`)
      }

      if (accountsRes.status === 'fulfilled') {
        const accountsData = accountsRes.value.data
        // Filter for expense accounts
        setExpenseAccounts(accountsData.filter((acc: ExpenseAccount) => 
          acc.account_type.toLowerCase() === 'expense'
        ))
      }

      if (tanksRes.status === 'fulfilled') {
        const tanksData = tanksRes.value.data
        setTanks(Array.isArray(tanksData) ? tanksData : [])
      } else {
        console.error('❌ Failed to load tanks:', tanksRes)
        setTanks([])
        toast.error(
          'Could not load tanks. Fuel bills need tanks to receive stock — refresh the page or check the Tanks API.'
        )
      }
    } catch (error) {
      console.error('Error fetching data:', error)
      toast.error('Error connecting to server')
    } finally {
      setLoading(false)
    }
  }

  const calculateLineAmount = (quantity: number, unitCost: number) => {
    return quantity * unitCost
  }

  const calculateTotals = () => {
    const subtotal = formData.lines.reduce((sum, line) => sum + (line.amount || 0), 0)
    const taxAmount = formData.lines.reduce((sum, line) => sum + (line.tax_amount || 0), 0)
    const total = subtotal + taxAmount
    return { subtotal, taxAmount, total }
  }

  const handleAddLine = () => {
    setFormData({
      ...formData,
      lines: [
        ...formData.lines,
        {
          line_number: formData.lines.length + 1,
          description: '',
          item_id: undefined,
          expense_account_id: undefined,
          tank_id: undefined,
          quantity: 1,
          unit_cost: 0,
          amount: 0,
          tax_amount: 0
        }
      ]
    })
  }

  const handleRemoveLine = (index: number) => {
    const newLines = formData.lines.filter((_, i) => i !== index)
      .map((line, i) => ({ ...line, line_number: i + 1 }))
    setFormData({ ...formData, lines: newLines })
  }

  const handleLineChange = (index: number, field: string, value: any) => {
    const newLines = [...formData.lines]
    newLines[index] = { ...newLines[index], [field]: value }
    
    // If item is selected, clear expense account, set default tank for fuel, update cost/description
    if (field === 'item_id' && value) {
      const item = items.find(i => i.id === value)
      if (item) {
        newLines[index].expense_account_id = undefined
        newLines[index].unit_cost = item.cost || 0
        newLines[index].description = item.name
        const defTank = defaultTankIdForProduct(value, items, tanks)
        newLines[index].tank_id = defTank
      }
    }
    
    // If expense account is selected, clear item and tank
    if (field === 'expense_account_id' && value) {
      newLines[index].item_id = undefined
      newLines[index].tank_id = undefined
      const account = expenseAccounts.find(a => a.id === value)
      if (account) {
        newLines[index].description = account.account_name
      }
    }
    
    if (field === 'quantity' || field === 'unit_cost') {
      const quantity =
        field === 'quantity' ? parseFloat(value) || 0 : Number(newLines[index].quantity ?? 0)
      const unitCost =
        field === 'unit_cost' ? parseFloat(value) || 0 : Number(newLines[index].unit_cost ?? 0)
      newLines[index].amount = calculateLineAmount(quantity, unitCost)
    }
    
    setFormData({ ...formData, lines: newLines })
  }
  
  // Get tanks for a specific item (fuel items)
  // An item is considered a fuel item if it has associated tanks
  const getTanksForItem = (itemId?: number): Tank[] => {
    if (!itemId) return []
    
    // Return tanks that use this product
    // If an item has tanks, it's a fuel item and needs tank selection
    const itemTanks = tanks.filter(tank => tank.product_id === itemId)
    
    return itemTanks
  }

  const performCreate = async (confirm?: { acknowledgeTankOverfill: boolean }) => {
    const { subtotal, taxAmount, total } = calculateTotals()

    const over = buildTankOverfillReview(formData.lines, items, tanks)
    if (over && confirm === undefined) {
      setStockReviewPayload({
        mode: 'create',
        tankIssues: over.tankIssues,
        catalogLines: over.catalogLines,
        needsServerAck: approveBill,
        draftNote: !approveBill,
      })
      setStockReviewOpen(true)
      return
    }

    const sendAck = !!(confirm && confirm.acknowledgeTankOverfill)
    await api.post('/bills/', {
      vendor_id: formData.vendor_id,
      bill_date: formData.bill_date,
      due_date: formData.due_date || null,
      vendor_reference: formData.vendor_reference || null,
      memo: formData.memo || null,
      subtotal: subtotal,
      tax_amount: taxAmount,
      total_amount: total,
      status: approveBill ? 'open' : 'draft',
      acknowledge_tank_overfill: sendAck ? true : undefined,
      lines: formData.lines.map((line, idx) => ({
        line_number: idx + 1,
        description: line.description || null,
        item_id: line.item_id || null,
        expense_account_id: line.expense_account_id || null,
        tank_id: line.tank_id || null,
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        amount: line.amount,
        tax_amount: line.tax_amount || 0
      }))
    })

    toast.success(approveBill ? 'Bill approved and posted (Open).' : 'Bill saved as draft.')
    setShowModal(false)
    setStockReviewOpen(false)
    setStockReviewPayload(null)
    resetForm()
    fetchData()
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.vendor_id) {
      toast.error('Please select a vendor')
      return
    }

    if (formData.lines.length === 0) {
      toast.error('Please add at least one line item')
      return
    }

    for (let i = 0; i < formData.lines.length; i++) {
      const line = formData.lines[i]
      if (line.item_id) {
        const item = items.find(it => it.id === line.item_id)
        const availableTanks = getTanksForItem(line.item_id)
        if (availableTanks.length > 0 && !line.tank_id) {
          toast.error(`Please select a tank for fuel item "${item?.name || 'Unknown'}" in line ${i + 1}`)
          return
        }
      }
    }

    try {
      await performCreate()
    } catch (error: unknown) {
      console.error('Error creating bill:', error)
      toast.error(extractErrorMessage(error, 'Could not save the bill. Check your connection and try again.'))
    }
  }

  const handleEdit = async (bill: Bill) => {
    try {
      // Fetch full bill details with line items
      const response = await api.get(`/bills/${bill.id}`)
      if (response.status === 200) {
        const fullBill = response.data
        setEditingBill(fullBill)
        setPostDraftBillOnUpdate(false)
        setFormData({
          vendor_id: fullBill.vendor_id,
          bill_date: fullBill.bill_date.split('T')[0],
          due_date: fullBill.due_date ? fullBill.due_date.split('T')[0] : '',
          vendor_reference: fullBill.vendor_reference || '',
          memo: fullBill.memo || '',
          lines: fullBill.lines?.map((line: BillLineItem) => ({
            id: line.id,
            line_number: line.line_number,
            description: line.description || '',
            item_id: line.item_id || undefined,
            expense_account_id: line.expense_account_id || undefined,
            tank_id: line.tank_id || undefined,
            quantity: Number(line.quantity),
            unit_cost: Number(line.unit_cost ?? line.unit_price ?? 0),
            amount: Number(line.amount),
            tax_amount: Number(line.tax_amount || 0)
          })) || []
        })
        setShowEditModal(true)
      } else {
        toast.error('Failed to load bill details')
      }
    } catch (error: any) {
      console.error('Error loading bill for edit:', error)
      toast.error(error.response?.data?.detail || 'Error loading bill')
    }
  }

  const performUpdate = async (confirm?: { acknowledgeTankOverfill: boolean }) => {
    if (!editingBill) return

    const { subtotal, taxAmount, total } = calculateTotals()
    const nextStatus =
      editingBill.status === 'draft' && postDraftBillOnUpdate ? 'open' : editingBill.status

    const willPostReceipt = ['open', 'paid', 'partial', 'overdue'].includes(
      (nextStatus || '').toLowerCase()
    )

    const over = buildTankOverfillReview(formData.lines, items, tanks)
    if (over && confirm === undefined) {
      setStockReviewPayload({
        mode: 'edit',
        tankIssues: over.tankIssues,
        catalogLines: over.catalogLines,
        needsServerAck: willPostReceipt,
        draftNote: !willPostReceipt,
      })
      setStockReviewOpen(true)
      return
    }

    const sendAck = !!(confirm && confirm.acknowledgeTankOverfill)
    await api.put(`/bills/${editingBill.id}`, {
      vendor_id: formData.vendor_id,
      bill_date: formData.bill_date,
      due_date: formData.due_date || null,
      vendor_reference: formData.vendor_reference || null,
      memo: formData.memo || null,
      subtotal: subtotal,
      tax_amount: taxAmount,
      total_amount: total,
      status: nextStatus,
      acknowledge_tank_overfill: sendAck ? true : undefined,
      lines: formData.lines.map((line, idx) => ({
        line_number: idx + 1,
        description: line.description || null,
        item_id: line.item_id || null,
        expense_account_id: line.expense_account_id || null,
        tank_id: line.tank_id || null,
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        amount: line.amount,
        tax_amount: line.tax_amount || 0
      }))
    })

    toast.success(
      postDraftBillOnUpdate && editingBill.status === 'draft'
        ? 'Bill approved and posted (Open).'
        : 'Bill updated successfully!'
    )
    setShowEditModal(false)
    setEditingBill(null)
    setStockReviewOpen(false)
    setStockReviewPayload(null)
    resetForm()
    fetchData()
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingBill) return

    for (let i = 0; i < formData.lines.length; i++) {
      const line = formData.lines[i]
      if (line.item_id) {
        const item = items.find(it => it.id === line.item_id)
        const availableTanks = getTanksForItem(line.item_id)
        if (availableTanks.length > 0 && !line.tank_id) {
          toast.error(`Please select a tank for fuel item "${item?.name || 'Unknown'}" in line ${i + 1}`)
          return
        }
      }
    }

    try {
      await performUpdate()
    } catch (error: unknown) {
      console.error('Error updating bill:', error)
      toast.error(extractErrorMessage(error, 'Could not update the bill. Check your connection and try again.'))
    }
  }

  const confirmStockReview = async () => {
    const p = stockReviewPayload
    if (!p) return
    const ack = p.needsServerAck
    try {
      if (p.mode === 'create') {
        await performCreate({ acknowledgeTankOverfill: ack })
      } else {
        await performUpdate({ acknowledgeTankOverfill: ack })
      }
    } catch (error: unknown) {
      console.error('Bill save after stock review:', error)
      toast.error(extractErrorMessage(error, 'Could not save the bill. Check your connection and try again.'))
      setStockReviewOpen(false)
      setStockReviewPayload(null)
    }
  }

  const handleDelete = async (billId: number, billNumber: string) => {
    if (!confirm(`Are you sure you want to delete bill ${billNumber}? This will reverse all effects (inventory, journal entries, payments) and cannot be undone.`)) {
      return
    }

    try {
      const response = await api.delete(`/bills/${billId}`)

      if (response.status === 204 || response.status === 200) {
        toast.success(`Bill ${billNumber} deleted successfully!`)
        fetchData()
      } else {
        console.error('Failed to delete bill:', response.status)
        toast.error('Failed to delete bill')
      }
    } catch (error: any) {
      console.error('Error deleting bill:', error)
      const errorMessage = error.response?.data?.detail || 'Error deleting bill'
      toast.error(errorMessage)
    }
  }

  const handleViewBill = async (billId: number) => {
    try {
      const response = await api.get(`/bills/${billId}`)
      if (response.status === 200) {
        setViewingBill(response.data)
        setShowViewModal(true)
      } else {
        toast.error('Failed to load bill details')
      }
    } catch (error: any) {
      console.error('Error viewing bill:', error)
      toast.error(error.response?.data?.detail || 'Error loading bill')
    }
  }

  const handleCloseViewModal = () => {
    setShowViewModal(false)
    setViewingBill(null)
  }

  const handleCloseEditModal = () => {
    setShowEditModal(false)
    setEditingBill(null)
    setPostDraftBillOnUpdate(false)
    resetForm()
  }

  const resetForm = () => {
    const billDate = new Date().toISOString().split('T')[0]
    const due = new Date(`${billDate}T12:00:00`)
    due.setDate(due.getDate() + 30)
    setFormData({
      vendor_id: 0,
      bill_date: billDate,
      due_date: due.toISOString().split('T')[0],
      vendor_reference: '',
      memo: '',
      lines: []
    })
    setEditingBill(null)
    setApproveBill(false)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const isAdmin = userRole === 'admin'
  const isAccountant = userRole === 'accountant'
  const canEditDelete = isAdmin || isAccountant

  /** Normalize API/UI status variants (e.g. partially_paid, Partially paid). */
  const billStatusNorm = (status: string | undefined) =>
    (status || '').toLowerCase().replace(/\s+/g, '_')

  /** Any user who can open Bills may edit non-final bills (incl. partial) to fix lines / inventory. */
  const canEditBillRow = (bill: Bill) => {
    const s = billStatusNorm(bill.status)
    if (s === 'paid' || s === 'void') return false
    return true
  }

  const canDeleteBillRow = (bill: Bill) => {
    const s = billStatusNorm(bill.status)
    if (s === 'paid' || s === 'void') return false
    if (s === 'draft') return true
    return canEditDelete
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'open':
        return 'bg-blue-100 text-blue-800'
      case 'paid':
        return 'bg-green-100 text-green-800'
      case 'partial':
      case 'partially_paid':
        return 'bg-yellow-100 text-yellow-800'
      case 'overdue':
        return 'bg-red-100 text-red-800'
      case 'draft':
        return 'bg-gray-100 text-gray-800'
      case 'void':
        return 'bg-gray-100 text-gray-600'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const filteredBills = bills.filter(bill =>
    bill.bill_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bill.vendor_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bill.vendor_reference?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const { subtotal, taxAmount, total } = calculateTotals()

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Bills (Accounts Payable)</h1>
          <p className="text-gray-600 mt-1">Track vendor bills and manage accounts payable</p>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search bills..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Status</option>
              <option value="draft">Draft</option>
              <option value="open">Open</option>
              <option value="paid">Paid</option>
              <option value="partial">Partially Paid</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              resetForm()
              setShowModal(true)
            }}
            className="ml-4 flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-5 w-5" />
            <span>Add Bill</span>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Bill #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Vendor
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Bill Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Due Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Balance
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredBills.map((bill) => (
                  <tr key={bill.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {bill.bill_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {bill.vendor_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {formatDateOnly(bill.bill_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {bill.due_date ? formatDateOnly(bill.due_date) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {currencySymbol}{billTotal(bill).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {currencySymbol}{billBalance(bill).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(bill.status)}`}>
                        {formatBillStatusLabel(bill.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleViewBill(bill.id)}
                          className="text-blue-600 hover:text-blue-900 transition-colors"
                          title="View bill"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {canEditBillRow(bill) && (
                          <button
                            type="button"
                            onClick={() => handleEdit(bill)}
                            className="text-indigo-600 hover:text-indigo-900 transition-colors"
                            title="Edit bill"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {canDeleteBillRow(bill) && (
                          <button
                            type="button"
                            onClick={() => handleDelete(bill.id, bill.bill_number)}
                            className="text-red-600 hover:text-red-900 transition-colors"
                            title="Delete bill"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredBills.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <p>No bills found</p>
              </div>
            )}
          </div>
        )}

        {/* View Bill Modal */}
        {showViewModal && viewingBill && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto my-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Bill Details</h2>
                <button
                  onClick={handleCloseViewModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Bill Header */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Bill Number</p>
                    <p className="text-lg font-semibold">{viewingBill.bill_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Status</p>
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(viewingBill.status)}`}>
                      {formatBillStatusLabel(viewingBill.status)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Vendor</p>
                    <p className="text-lg">{viewingBill.vendor_name || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Bill Date</p>
                    <p className="text-lg">{formatDateOnly(viewingBill.bill_date)}</p>
                  </div>
                  {viewingBill.due_date && (
                    <div>
                      <p className="text-sm text-gray-600">Due Date</p>
                      <p className="text-lg">{formatDateOnly(viewingBill.due_date)}</p>
                    </div>
                  )}
                </div>

                {/* Line Items */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">Line Items</h3>
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tank</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Cost</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {viewingBill.lines?.map((item: BillLineItem) => (
                        <tr key={item.id}>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {items.find(i => i.id === item.item_id)?.name || expenseAccounts.find(a => a.id === item.expense_account_id)?.account_name || 'N/A'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{item.description || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {item.tank_name ||
                              (item.tank_id
                                ? tanks.find((t) => t.id === item.tank_id)?.tank_name || `Tank #${item.tank_id}`
                                : '—')}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">{Number(item.quantity).toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">{currencySymbol}{Number(item.unit_cost ?? item.unit_price ?? 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">{currencySymbol}{Number(item.amount || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="border-t pt-4">
                  <div className="flex justify-end space-x-8">
                    <div className="text-right">
                      <p className="text-sm text-gray-600">Subtotal:</p>
                      <p className="text-sm text-gray-600">Tax:</p>
                      <p className="text-lg font-semibold text-gray-900">Total:</p>
                      <p className="text-sm text-gray-600 mt-2">Amount paid:</p>
                      <p className="text-sm font-medium text-gray-800">Balance due:</p>
                    </div>
                    <div className="text-right min-w-[120px]">
                      <p className="text-sm text-gray-900">{currencySymbol}{billSubtotal(viewingBill).toFixed(2)}</p>
                      <p className="text-sm text-gray-900">{currencySymbol}{billTax(viewingBill).toFixed(2)}</p>
                      <p className="text-lg font-semibold text-gray-900">{currencySymbol}{billTotal(viewingBill).toFixed(2)}</p>
                      <p className="text-sm text-gray-900 mt-2">{currencySymbol}{billPaid(viewingBill).toFixed(2)}</p>
                      <p className="text-sm font-medium text-gray-900">{currencySymbol}{billBalance(viewingBill).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                {canEditBillRow(viewingBill) && (
                  <button
                    type="button"
                    onClick={() => {
                      const b = viewingBill
                      handleCloseViewModal()
                      void handleEdit(b)
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                  >
                    Edit bill
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCloseViewModal}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Bill Modal */}
        {showEditModal && editingBill && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg p-8 max-w-7xl w-full max-h-[90vh] overflow-y-auto my-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Edit Bill {editingBill.bill_number}</h2>
                <button
                  onClick={handleCloseEditModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleUpdate}>
                {/* Edit Bill Form Content - reuse same form structure as Create Modal */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Vendor *
                    </label>
                    <select
                      required
                      value={formData.vendor_id}
                      onChange={(e) => setFormData({ ...formData, vendor_id: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="0">Select Vendor</option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.display_name} ({vendor.vendor_number})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Bill Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.bill_date}
                      onChange={(e) => setFormData({ ...formData, bill_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Vendor Reference
                    </label>
                    <input
                      type="text"
                      value={formData.vendor_reference}
                      onChange={(e) => setFormData({ ...formData, vendor_reference: e.target.value })}
                      placeholder="Vendor invoice number"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Memo/Notes
                    </label>
                    <textarea
                      value={formData.memo}
                      onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                      placeholder="Additional notes"
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Line Items */}
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Line Items</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setFormData({
                          ...formData,
                          lines: [
                            ...formData.lines,
                            {
                              line_number: formData.lines.length + 1,
                              description: '',
                              item_id: undefined,
                              expense_account_id: undefined,
                              tank_id: undefined,
                              quantity: 1,
                              unit_cost: 0,
                              amount: 0,
                              tax_amount: 0,
                            },
                          ],
                        })
                      }}
                      className="flex items-center space-x-1 px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      <PlusCircle className="h-4 w-4" />
                      <span>Add Line</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {formData.lines.map((line, index) => {
                      const availableTanks = getTanksForItem(line.item_id)
                      return (
                        <div key={index} className="border border-gray-200 rounded-lg p-2 min-w-0">
                          <div className="flex flex-wrap lg:flex-nowrap items-end gap-2 min-w-0">
                            <div className="min-w-0 flex-[1.4] basis-[min(100%,14rem)]">
                              <label className="block text-xs font-medium text-gray-700 mb-1">Item/Account</label>
                              <select
                                value={line.item_id || line.expense_account_id || ''}
                                onChange={(e) => {
                                  const value = parseInt(e.target.value)
                                  if (!value) return
                                  const item = items.find((i) => i.id === value)
                                  const account = expenseAccounts.find((a) => a.id === value)
                                  const newLines = [...formData.lines]
                                  if (item) {
                                    const uc = item.cost || 0
                                    const qty = Number(newLines[index].quantity ?? 0)
                                    newLines[index] = {
                                      ...newLines[index],
                                      item_id: value,
                                      expense_account_id: undefined,
                                      tank_id: defaultTankIdForProduct(value, items, tanks),
                                      unit_cost: uc,
                                      description: item.name,
                                      amount: calculateLineAmount(qty, uc),
                                    }
                                  } else if (account) {
                                    newLines[index] = {
                                      ...newLines[index],
                                      expense_account_id: value,
                                      item_id: undefined,
                                      tank_id: undefined,
                                      description: account.account_name,
                                    }
                                  }
                                  setFormData({ ...formData, lines: newLines })
                                }}
                                className="w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="">Select Item/Account...</option>
                                <optgroup label="Items">
                                  {items.map((item) => (
                                    <option key={`item-${item.id}`} value={item.id}>
                                      {item.name} ({item.item_number})
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label="Expense Accounts">
                                  {expenseAccounts.map((account) => (
                                    <option key={`account-${account.id}`} value={account.id}>
                                      {formatCoaOptionLabel(account)}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>
                            {availableTanks.length > 0 && (
                              <div className="min-w-0 flex-1 basis-[min(100%,10rem)]">
                                <label className="block text-xs font-medium text-gray-700 mb-1">Tank</label>
                                <select
                                  value={line.tank_id || ''}
                                  onChange={(e) => handleLineChange(index, 'tank_id', e.target.value ? parseInt(e.target.value) : undefined)}
                                  className="w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                                >
                                  <option value="">Select Tank...</option>
                                  {availableTanks.map((tank) => (
                                    <option key={`tank-${tank.id}`} value={tank.id}>
                                      {tank.tank_name} ({tank.tank_number}) {tank.station_name ? `- ${tank.station_name}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            <div className="min-w-0 flex-1 basis-[min(100%,12rem)]">
                              <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                              <input
                                type="text"
                                value={line.description || ''}
                                onChange={(e) => handleLineChange(index, 'description', e.target.value)}
                                className="w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div className="w-[4.5rem] shrink-0">
                              <label className="block text-xs font-medium text-gray-700 mb-1">Qty</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.quantity}
                                onChange={(e) => handleLineChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div className="w-[5.25rem] shrink-0">
                              <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.unit_cost}
                                onChange={(e) => handleLineChange(index, 'unit_cost', parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div className={AMOUNT_LINE_COL_CLASS}>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
                              <input
                                type="text"
                                value={line.amount.toFixed(2)}
                                readOnly
                                title={`${currencySymbol}${line.amount.toFixed(2)}`}
                                className={AMOUNT_READ_ONLY_INPUT_CLASS}
                              />
                            </div>
                            <div className="shrink-0 pb-px">
                              <label className="block text-xs font-medium text-transparent mb-1 select-none">—</label>
                              <button
                                type="button"
                                onClick={() => {
                                  const newLines = formData.lines.filter((_, i) => i !== index)
                                    .map((line, i) => ({ ...line, line_number: i + 1 }))
                                  setFormData({ ...formData, lines: newLines })
                                }}
                                className="px-2 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors h-[30px] flex items-center justify-center"
                                aria-label="Remove line"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {formData.lines.length === 0 && (
                    <p className="text-center text-gray-500 py-4">No line items added. Click "Add Line" to add items.</p>
                  )}
                </div>

                {/* Totals */}
                {formData.lines.length > 0 && (
                  <div className="border-t pt-4 mb-6">
                    <div className="flex justify-end space-x-8">
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Subtotal:</p>
                        <p className="text-sm text-gray-600">Tax:</p>
                        <p className="text-lg font-semibold text-gray-900">Total:</p>
                      </div>
                      <div className="text-right min-w-[120px]">
                        <p className="text-sm text-gray-900">{currencySymbol}{calculateTotals().subtotal.toFixed(2)}</p>
                        <p className="text-sm text-gray-900">{currencySymbol}{calculateTotals().taxAmount.toFixed(2)}</p>
                        <p className="text-lg font-semibold text-gray-900">{currencySymbol}{calculateTotals().total.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {editingBill.status === 'draft' && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={postDraftBillOnUpdate}
                        onChange={(e) => setPostDraftBillOnUpdate(e.target.checked)}
                      />
                      <span>
                        <span className="font-medium">Approve on save</span>
                        <span className="block text-gray-600">
                          Mark Open and post this bill to the general ledger when you save.
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                {/* Form Actions */}
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {postDraftBillOnUpdate && editingBill.status === 'draft' ? 'Save & approve' : 'Update Bill'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tank capacity / stock review (warning — user may continue, e.g. drums) */}
        {stockReviewOpen && stockReviewPayload && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] overflow-y-auto p-4">
            <div
              className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 border border-amber-200"
              role="dialog"
              aria-labelledby="stock-review-title"
            >
              <h3 id="stock-review-title" className="text-lg font-semibold text-amber-900 mb-2">
                Tank capacity notice
              </h3>
              <p className="text-sm text-gray-700 mb-4">
                This bill would receive more fuel than fits in the tank(s) below (current stock + this bill &gt; tank
                capacity). You can still continue if overflow will be stored elsewhere (for example in drums).
              </p>
              {stockReviewPayload.draftNote && (
                <p className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-md px-3 py-2 mb-4">
                  You are saving as draft — inventory is not received until the bill is posted (Open).
                </p>
              )}
              <div className="overflow-x-auto mb-4">
                <table className="min-w-full text-sm border border-gray-200 rounded-md">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium text-gray-700">Tank</th>
                      <th className="px-3 py-2 font-medium text-gray-700 text-right">In tank</th>
                      <th className="px-3 py-2 font-medium text-gray-700 text-right">Capacity</th>
                      <th className="px-3 py-2 font-medium text-gray-700 text-right">Free space</th>
                      <th className="px-3 py-2 font-medium text-gray-700 text-right">This bill</th>
                      <th className="px-3 py-2 font-medium text-gray-700 text-right">Over by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockReviewPayload.tankIssues.map((row) => (
                      <tr key={row.tankId} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-900">{row.tankName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.currentStock.toFixed(2)} {row.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.capacity.toFixed(2)} {row.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-800">
                          {row.remainingUllage.toFixed(2)} {row.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.receiptQty.toFixed(2)} {row.unit}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-amber-800">
                          {row.overBy.toFixed(2)} {row.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {stockReviewPayload.catalogLines.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">Items on this bill</p>
                  <ul className="text-sm text-gray-800 space-y-1 border border-gray-100 rounded-md px-3 py-2 bg-gray-50/80">
                    {stockReviewPayload.catalogLines.map((row, i) => (
                      <li key={i}>
                        <span className="font-medium">{row.itemName}</span>
                        {' — '}
                        bill qty {row.billQty.toFixed(2)} {row.unit}
                        {row.quantityOnHand !== null && (
                          <span className="text-gray-600">
                            {' '}
                            · current stock (system) {row.quantityOnHand.toFixed(2)} {row.unit}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setStockReviewOpen(false)
                    setStockReviewPayload(null)
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmStockReview()}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                >
                  {stockReviewPayload.needsServerAck ? 'Continue and confirm overflow' : 'Continue'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg p-8 max-w-7xl w-full max-h-[90vh] overflow-y-auto my-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Add New Bill</h2>
                <button
                  onClick={handleCloseModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleCreate}>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Vendor *
                    </label>
                    <select
                      required
                      value={formData.vendor_id}
                      onChange={(e) => setFormData({ ...formData, vendor_id: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="0">Select Vendor</option>
                      {vendors.length === 0 ? (
                        <option value="0" disabled>No active vendors available</option>
                      ) : (
                        vendors.map((vendor) => (
                          <option key={vendor.id} value={vendor.id}>
                            {vendor.display_name} ({vendor.vendor_number})
                          </option>
                        ))
                      )}
                    </select>
                    {vendors.length === 0 && (
                      <p className="mt-1 text-xs text-red-600">
                        No active vendors found. Please create a vendor first or check if vendors are active.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Bill Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.bill_date}
                      onChange={(e) => setFormData({ ...formData, bill_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Vendor Reference
                    </label>
                    <input
                      type="text"
                      value={formData.vendor_reference}
                      onChange={(e) => setFormData({ ...formData, vendor_reference: e.target.value })}
                      placeholder="Vendor invoice number"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Memo/Notes
                    </label>
                    <textarea
                      value={formData.memo}
                      onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Line Items */}
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Line Items</h3>
                    <button
                      type="button"
                      onClick={handleAddLine}
                      className="flex items-center space-x-1 px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      <PlusCircle className="h-4 w-4" />
                      <span>Add Line</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {formData.lines.map((line, index) => {
                      const availableTanks = getTanksForItem(line.item_id)
                      const isFuelItem = availableTanks.length > 0
                      const selectedTank =
                        line.tank_id && isFuelItem
                          ? availableTanks.find((t) => t.id === line.tank_id)
                          : undefined
                      const tankTitle =
                        selectedTank != null
                          ? `Current: ${(Number(selectedTank.current_stock) || 0).toFixed(2)}L / Capacity: ${(Number(selectedTank.capacity) || 0).toFixed(2)}L`
                          : undefined

                      return (
                        <div key={index} className="border border-gray-200 rounded-lg p-2 bg-gray-50 min-w-0">
                          <div className="flex flex-wrap lg:flex-nowrap items-end gap-2 min-w-0">
                            <div className="min-w-0 flex-[1.25] basis-[min(100%,13rem)]">
                              <label className="block text-xs font-medium text-gray-700 mb-1">Item/Account</label>
                              <select
                                value={line.item_id || line.expense_account_id || ''}
                                onChange={(e) => {
                                  const value = parseInt(e.target.value)
                                  if (!value) return
                                  const opt = e.target.selectedOptions[0]
                                  const newLines = [...formData.lines]
                                  if (opt?.dataset.type === 'item') {
                                    const item = items.find((i) => i.id === value)
                                    if (!item) return
                                    const uc = item.cost || 0
                                    const qty = Number(newLines[index].quantity ?? 0)
                                    newLines[index] = {
                                      ...newLines[index],
                                      item_id: value,
                                      expense_account_id: undefined,
                                      tank_id: defaultTankIdForProduct(value, items, tanks),
                                      unit_cost: uc,
                                      description: item.name,
                                      amount: calculateLineAmount(qty, uc),
                                    }
                                  } else {
                                    const account = expenseAccounts.find((a) => a.id === value)
                                    newLines[index] = {
                                      ...newLines[index],
                                      expense_account_id: value,
                                      item_id: undefined,
                                      tank_id: undefined,
                                      description: account?.account_name || '',
                                    }
                                  }
                                  setFormData({ ...formData, lines: newLines })
                                }}
                                className="w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="">Select...</option>
                                <optgroup label="Items">
                                  {items.length === 0 ? (
                                    <option value="" disabled>No items available</option>
                                  ) : (
                                    items.map((item) => (
                                      <option key={`item-${item.id}`} value={item.id} data-type="item">
                                        {item.name} ({item.item_number})
                                      </option>
                                    ))
                                  )}
                                </optgroup>
                                <optgroup label="Expense Accounts">
                                  {expenseAccounts.map((account) => (
                                    <option key={`acc-${account.id}`} value={account.id} data-type="account">
                                      {formatCoaOptionLabel(account)}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>

                            {isFuelItem && (
                              <div className="min-w-0 flex-1 basis-[min(100%,9rem)]">
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                  Tank <span className="text-red-500">*</span>
                                </label>
                                <select
                                  value={line.tank_id || ''}
                                  title={tankTitle}
                                  onChange={(e) =>
                                    handleLineChange(index, 'tank_id', e.target.value ? parseInt(e.target.value) : undefined)
                                  }
                                  className="w-full min-w-0 px-2 py-1 text-sm border border-yellow-400 rounded focus:ring-1 focus:ring-yellow-500 bg-yellow-50"
                                  required={isFuelItem}
                                >
                                  <option value="">Select Tank...</option>
                                  {availableTanks.map((tank) => (
                                    <option key={`tank-${tank.id}`} value={tank.id}>
                                      {tank.tank_name} ({tank.tank_number}) {tank.station_name ? `- ${tank.station_name}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            <div className="min-w-0 flex-1 basis-[min(100%,11rem)]">
                              <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                              <input
                                type="text"
                                value={line.description || ''}
                                onChange={(e) => handleLineChange(index, 'description', e.target.value)}
                                className="w-full min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div className="w-[4.25rem] shrink-0">
                              <label className="block text-xs font-medium text-gray-700 mb-1">Qty</label>
                              <input
                                type="number"
                                step="0.01"
                                value={line.quantity}
                                onChange={(e) => handleLineChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div className="w-[4.75rem] shrink-0">
                              <label className="block text-xs font-medium text-gray-700 mb-1">Rate</label>
                              <input
                                type="number"
                                step="0.01"
                                value={line.unit_cost}
                                onChange={(e) => handleLineChange(index, 'unit_cost', parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div className="w-[4.75rem] shrink-0">
                              <label className="block text-xs font-medium text-gray-700 mb-1">Tax</label>
                              <input
                                type="number"
                                step="0.01"
                                value={line.tax_amount}
                                onChange={(e) => handleLineChange(index, 'tax_amount', parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div className={AMOUNT_LINE_COL_CLASS}>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
                              <input
                                type="text"
                                readOnly
                                inputMode="decimal"
                                value={(Number(line.amount) || 0).toFixed(2)}
                                title={`${currencySymbol}${(Number(line.amount) || 0).toFixed(2)}`}
                                className={AMOUNT_READ_ONLY_INPUT_CLASS}
                              />
                            </div>
                            <div className="shrink-0 pb-px">
                              <label className="block text-xs font-medium text-transparent mb-1 select-none">—</label>
                              <button
                                type="button"
                                onClick={() => handleRemoveLine(index)}
                                className="px-2 py-1 text-sm text-red-600 hover:bg-red-50 rounded h-[30px] flex items-center justify-center"
                                aria-label="Remove line"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {formData.lines.length === 0 && (
                    <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 rounded-lg">
                      <p>No line items. Click "Add Line" to add items or expense accounts.</p>
                    </div>
                  )}
                </div>

                {/* Totals */}
                <div className="border-t pt-4 mb-6">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                    <label className="flex items-start gap-2 text-sm text-gray-700 max-w-md cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={approveBill}
                        onChange={(e) => setApproveBill(e.target.checked)}
                      />
                      <span>
                        <span className="font-medium text-gray-900">Approve for payment</span>
                        <span className="block text-gray-600">
                          Mark as Open and post to the general ledger (A/P). Leave unchecked to save as a draft you can edit later.
                        </span>
                      </span>
                    </label>
                    <div className="w-full sm:w-64 space-y-2 sm:text-right">
                      <div className="flex justify-between text-sm sm:flex sm:justify-between">
                        <span className="text-gray-600">Subtotal:</span>
                        <span className="font-medium">{currencySymbol}{(Number(subtotal) || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm sm:flex sm:justify-between">
                        <span className="text-gray-600">Tax:</span>
                        <span className="font-medium">{currencySymbol}{(Number(taxAmount) || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-lg font-bold border-t pt-2 sm:flex sm:justify-between">
                        <span>Total:</span>
                        <span>{currencySymbol}{(Number(total) || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {approveBill ? 'Save & approve' : 'Save as draft'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
