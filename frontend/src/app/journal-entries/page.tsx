'use client'

import { useEffect, useState, Fragment, useRef, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { CompanyDateInput, type CompanyDateInputHandle } from '@/components/CompanyDateInput'
import { OffsetPaginationControls } from '@/components/ui/OffsetPaginationControls'
import { Plus, Edit2, Trash2, X, Eye, CheckCircle, XCircle, AlertCircle, Search, Filter, AlertTriangle, RefreshCw, ScrollText } from 'lucide-react'
import { DocumentExportButtons } from '@/components/DocumentExportButtons'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import api, { getBackendOrigin } from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'
import { formatDate, formatDateOnly } from '@/utils/date'
import {
  buildJournalEntryDetailCsv,
  buildJournalEntryListCsv,
  buildJournalEntryPrintHtml,
  downloadCsvFile,
  downloadJsonFile,
  printHtmlDocument,
} from '@/utils/businessDocumentExport'
import { loadPrintBranding } from '@/utils/printBranding'
import { printListView } from '@/utils/printListView'
import { escapeHtml } from '@/utils/printDocument'
import { AMOUNT_JE_LINE_CLASS } from '@/utils/amountFieldStyles'
import {
  accountNeedsEntityTag,
  lineHasBusinessEntityTag,
  resolveJournalLinePondId,
  type JournalEntryDefaultEntity,
} from '@/utils/entityGlScoping'
import {
  applyJournalLineEntityKey,
  HEAD_OFFICE_SCOPE_KEY,
  inferJournalDefaultEntityKey,
  inferLineEntityKeyFromSaved,
  journalLineEntitySelectValue,
  parseJournalDefaultEntityKey,
} from '@/lib/journalEntryEntityScope'
import { JournalDefaultEntitySelect } from '@/components/journal/JournalDefaultEntitySelect'
import { BillLineEntitySelect } from '@/components/bills/BillLineEntitySelect'
import { useCompany } from '@/contexts/CompanyContext'
import { fetchJournalEntityScopeDirectory } from '@/lib/entityScopeDirectory'
import type { BillReceiptLocationPond, BillReceiptLocationStation } from '@/lib/billReceiptLocation'
import { countBusinessEntities, formatEntityCountSummary } from '@/lib/billLineEntity'
import {
  applyJournalQuickEntryTemplate,
  JOURNAL_QUICK_ENTRY_TEMPLATES,
  JOURNAL_RECOMMENDED_ACCOUNT_CODES,
  type JournalQuickEntryKind,
} from '@/lib/journalEntryTemplates'
import { coaPickFromRows } from '@/lib/coaSuggestForm'
import { isOffsetPagedPayload, offsetListParams, REFERENCE_FETCH_LIMIT } from '@/lib/pagination'
import {
  hasTransactionTextSearch,
  transactionAmountParams,
  transactionDateParams,
} from '@/lib/transactionListFilters'

interface JournalEntryLine {
  id?: number
  line_number: number
  description?: string
  debit_account_id?: number | null
  credit_account_id?: number | null
  amount: number
  debit?: number | string
  credit?: number | string
  debit_account_name?: string
  credit_account_name?: string
  debit_account_code?: string
  credit_account_code?: string
  station_id?: number | null
  station_name?: string
  aquaculture_pond_id?: number | null
  pond_name?: string
}

interface JournalEntry {
  id: number
  entry_number: string
  entry_date: string
  reference?: string
  description?: string
  station_id?: number | null
  station_name?: string
  total_debit: number | string
  total_credit: number | string
  is_posted: boolean
  created_by?: number
  created_at: string
  updated_at: string
  lines: JournalEntryLine[]
}

interface Account {
  id: number
  account_code: string
  account_name: string
  account_type: string
  account_sub_type?: string
  is_active?: boolean
}

type StationRow = BillReceiptLocationStation
type PondRow = BillReceiptLocationPond
type LineForm = Omit<
  JournalEntryLine,
  | 'id'
  | 'debit_account_name'
  | 'credit_account_name'
  | 'debit_account_code'
  | 'credit_account_code'
  | 'station_name'
  | 'station_id'
  | 'pond_name'
  | 'aquaculture_pond_id'
> & {
  station_id?: number | ''
  aquaculture_pond_id?: number | ''
  /** `__inherit__` = use entry default; `ho` = explicit head office; else station/pond key */
  entity_key?: string
}

/** Resolve per-line site at save: line override, else entry default, else untagged. */
function resolveJournalLineStationId(
  lineStationId: number | '' | null | undefined,
  entryStationId: number | '' | null | undefined
): number | null {
  if (lineStationId !== '' && lineStationId != null) {
    return Number(lineStationId)
  }
  if (entryStationId !== '' && entryStationId != null) {
    return Number(entryStationId)
  }
  return null
}

function resolveLineEntityForSave(
  line: LineForm,
  entryDefault: JournalEntryDefaultEntity
): { station_id: number | null; aquaculture_pond_id: number | null } {
  if (line.entity_key === HEAD_OFFICE_SCOPE_KEY) {
    return { station_id: null, aquaculture_pond_id: null }
  }
  const inherit =
    line.entity_key === '__inherit__' ||
    line.entity_key === '' ||
    line.entity_key == null
  if (inherit) {
    return {
      station_id: resolveJournalLineStationId(line.station_id, entryDefault.stationId),
      aquaculture_pond_id: resolveJournalLinePondId(line.aquaculture_pond_id, entryDefault.pondId),
    }
  }
  return {
    station_id: resolveJournalLineStationId(line.station_id, ''),
    aquaculture_pond_id: resolveJournalLinePondId(line.aquaculture_pond_id, ''),
  }
}

function validateEntityScopingForLines(
  lines: LineForm[],
  entryDefaultKey: string,
  accounts: Account[]
): string | null {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  for (const line of lines) {
    const accId = line.debit_account_id || line.credit_account_id
    if (!accId || !(Number(line.amount) > 0)) continue
    const acc = byId.get(accId)
    if (!accountNeedsEntityTag(acc)) continue
    if (!lineHasBusinessEntityTag(line, entryDefaultKey)) {
      const label = acc ? formatCoaOptionLabel(acc) : `account #${accId}`
      return (
        `${label} is income, COGS, or expense — assign a fuel station, shop hub (e.g. Premium Agro), ` +
        'or pond on that line (or set Default entity for the entry). Head office is for balance-sheet lines only.'
      )
    }
  }
  return null
}

function entryOutsideListDateFilter(
  entryDate: string,
  start: string,
  end: string,
  skipDateFilter: boolean
): boolean {
  if (skipDateFilter || !entryDate) return false
  if (start && entryDate < start) return true
  if (end && entryDate > end) return true
  return false
}

export default function JournalEntriesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const { selectedCompany } = useCompany()
  const companyName = selectedCompany?.name?.trim() || ''
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [initialLoad, setInitialLoad] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalCount, setTotalCount] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [quickEntryKind, setQuickEntryKind] = useState<JournalQuickEntryKind | ''>('')
  const [showViewModal, setShowViewModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null)
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null)
  const [viewingEntry, setViewingEntry] = useState<JournalEntry | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [stations, setStations] = useState<StationRow[]>([])
  const [ponds, setPonds] = useState<PondRow[]>([])
  const [entityDirectoryLoading, setEntityDirectoryLoading] = useState(false)
  const [entityDirectoryError, setEntityDirectoryError] = useState<string | null>(null)
  const entryDateInputRef = useRef<CompanyDateInputHandle>(null)

  // Filter states
  const [filterColumn, setFilterColumn] = useState<string>('all')
  const [filterValue, setFilterValue] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [minAmount, setMinAmount] = useState<string>('')
  const [maxAmount, setMaxAmount] = useState<string>('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [formData, setFormData] = useState<{
    entry_date: string
    reference: string
    description: string
    defaultEntityKey: string
    lines: LineForm[]
  }>({
    entry_date: new Date().toISOString().split('T')[0],
    reference: '',
    description: '',
    defaultEntityKey: '',
    lines: [
      {
        line_number: 1,
        description: '',
        debit_account_id: null,
        credit_account_id: null,
        amount: 0,
        station_id: '',
        aquaculture_pond_id: '',
        entity_key: '__inherit__',
      },
      {
        line_number: 2,
        description: '',
        debit_account_id: null,
        credit_account_id: null,
        amount: 0,
        station_id: '',
        aquaculture_pond_id: '',
        entity_key: '__inherit__',
      },
    ],
  })

  const showEntityCol = true
  const lineTableMetaCols = 4 + (showEntityCol ? 1 : 0)
  const entryDefault = useMemo(
    () => parseJournalDefaultEntityKey(formData.defaultEntityKey),
    [formData.defaultEntityKey]
  )
  const showDefaultEntitySelect = true
  const entityCountSummary = useMemo(
    () => formatEntityCountSummary(countBusinessEntities(stations, ponds)),
    [stations, ponds]
  )

  const loadEntityDirectory = useCallback(async () => {
    setEntityDirectoryLoading(true)
    setEntityDirectoryError(null)
    try {
      const { stations: st, ponds: pd } = await fetchJournalEntityScopeDirectory()
      setStations(st)
      setPonds(pd)
      if (st.length === 0 && pd.length === 0) {
        setEntityDirectoryError('No stations or ponds found for this company.')
      }
    } catch (error) {
      console.error('Failed to load journal entity directory:', error)
      setEntityDirectoryError('Could not load entity list (stations / ponds).')
      setStations([])
      setPonds([])
    } finally {
      setEntityDirectoryLoading(false)
    }
  }, [])

  const coaPickOptions = coaPickFromRows(accounts)
  const recommendedAccountIds = new Set(
    JOURNAL_RECOMMENDED_ACCOUNT_CODES.map((code) => {
      const a = accounts.find((x) => String(x.account_code || '').trim() === code)
      return a?.id
    }).filter((id): id is number => id != null && id > 0)
  )
  const recommendedAccounts = accounts.filter((a) => recommendedAccountIds.has(a.id))
  const otherAccounts = accounts.filter((a) => !recommendedAccountIds.has(a.id))

  const applyQuickEntry = (kind: JournalQuickEntryKind) => {
    const applied = applyJournalQuickEntryTemplate(kind, coaPickOptions, {
      defaultStationId: entryDefault.stationId,
      defaultPondId: entryDefault.pondId,
    })
    if (!applied) {
      toast.error('Could not apply template — check that template GL accounts exist in Chart of Accounts.')
      return
    }
    setFormData((prev) => {
      const nextDefaultKey =
        applied.station_id !== ''
          ? String(applied.station_id)
          : prev.defaultEntityKey
      return {
        ...prev,
        description: prev.description.trim() ? prev.description : applied.description,
        defaultEntityKey: nextDefaultKey,
        lines: applied.lines,
      }
    })
    setQuickEntryKind(kind)
    toast.success('Suggested accounts and entity tags applied — enter amounts and review entity tags.')
  }

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    void fetchReferenceData()
    void loadEntityDirectory()
  }, [router, loadEntityDirectory])

  useEffect(() => {
    if (!showModal) return
    void loadEntityDirectory()
  }, [showModal, loadEntityDirectory])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filterValue.trim()), 350)
    return () => clearTimeout(t)
  }, [filterValue])

  const hasTextSearch = hasTransactionTextSearch({ q: debouncedSearch, filterColumn, filterValue: debouncedSearch })

  useEffect(() => {
    setListPage(1)
  }, [filterColumn, debouncedSearch, startDate, endDate, minAmount, maxAmount, pageSize])

  const journalListParams = useCallback(
    (page: number, size: number) =>
      offsetListParams({
        page,
        pageSize: size,
        extra: {
          ...transactionDateParams(startDate, endDate, hasTextSearch),
          ...transactionAmountParams(minAmount, maxAmount),
          q: filterColumn === 'all' && debouncedSearch ? debouncedSearch : undefined,
          filter_column: filterColumn !== 'all' && debouncedSearch ? filterColumn : undefined,
          filter_value: filterColumn !== 'all' && debouncedSearch ? debouncedSearch : undefined,
        },
      }),
    [startDate, endDate, minAmount, maxAmount, filterColumn, debouncedSearch, hasTextSearch],
  )

  const fetchReferenceData = async () => {
    try {
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }

      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        console.error('Error fetching company currency:', error)
      }

      const [accountsRes] = await Promise.allSettled([
        api.get('/chart-of-accounts/'),
      ])

      if (accountsRes.status === 'fulfilled') {
        const accountsData = accountsRes.value.data
        setAccounts(accountsData.filter((acc: Account) => acc.is_active))
      } else {
        console.error('Failed to load chart of accounts:', accountsRes.reason)
      }
    } catch (error: unknown) {
      console.error('Error fetching reference data:', error)
    }
  }

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }

      const params = journalListParams(listPage, pageSize)
      const entriesRes = await api.get('/journal-entries/', { params, timeout: 15000 })
      const data = entriesRes.data

      if (isOffsetPagedPayload(data)) {
        setEntries(data.results as JournalEntry[])
        setTotalCount(data.count)
        const totalPages = Math.max(1, Math.ceil(data.count / pageSize))
        if (listPage > totalPages) {
          setListPage(totalPages)
        }
      } else if (Array.isArray(data)) {
        setEntries(data)
        setTotalCount(data.length)
      } else {
        setEntries([])
        setTotalCount(0)
      }
      setError(null)
    } catch (error: unknown) {
      console.error('Error fetching journal entries:', error)
      const err = error as { response?: { status?: number } }
      if (err.response?.status === 401 || err.response?.status === 403) {
        localStorage.removeItem('access_token')
        router.push('/login')
        return
      }
      const userMessage = extractErrorMessage(error, 'Could not load journal entries. Check your connection and try again.')
      setError(userMessage)
      toast.error(userMessage)
    } finally {
      setLoading(false)
      setInitialLoad(false)
    }
  }, [journalListParams, listPage, pageSize, router, toast])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return
    void fetchEntries()
  }, [fetchEntries])

  const fetchAllFilteredEntries = async (): Promise<JournalEntry[]> => {
    const params = {
      ...journalListParams(1, 2000),
      limit: '2000',
      skip: '0',
    }
    const res = await api.get('/journal-entries/', { params, timeout: 30000 })
    const data = res.data
    if (isOffsetPagedPayload(data)) return data.results as JournalEntry[]
    if (Array.isArray(data)) return data
    return []
  }

  const calculateTotals = () => {
    const totalDebit = formData.lines
      .filter(line => line.debit_account_id)
      .reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
    
    const totalCredit = formData.lines
      .filter(line => line.credit_account_id)
      .reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
    
    return { totalDebit, totalCredit }
  }

  const isBalanced = () => {
    const { totalDebit, totalCredit } = calculateTotals()
    return Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0
  }

  const addLine = () => {
    setFormData({
      ...formData,
      lines: [
        ...formData.lines,
        {
          line_number: formData.lines.length + 1,
          description: '',
          debit_account_id: null,
          credit_account_id: null,
          amount: 0,
          station_id: '',
          aquaculture_pond_id: '',
          entity_key: '__inherit__',
        },
      ],
    })
  }

  const removeLine = (index: number) => {
    if (formData.lines.length <= 2) {
      toast.error('Journal entry must have at least 2 lines')
      return
    }
    const newLines = formData.lines.filter((_, i) => i !== index).map((line, i) => ({
      ...line,
      line_number: i + 1
    }))
    setFormData({ ...formData, lines: newLines })
  }

  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...formData.lines]
    const applyDefaultEntityIfNeeded = (lineIdx: number, accountId: number | null) => {
      if (!accountId) return
      const acc = accounts.find((a) => a.id === accountId)
      if (!accountNeedsEntityTag(acc)) return
      const line = newLines[lineIdx]
      if (lineHasBusinessEntityTag(line, formData.defaultEntityKey)) return
      if (entryDefault.isHeadOffice) return
      if (entryDefault.stationId !== '' && entryDefault.stationId != null) {
        newLines[lineIdx] = {
          ...line,
          entity_key: '__inherit__',
          station_id: '',
          aquaculture_pond_id: '',
        }
      } else if (entryDefault.pondId !== '' && entryDefault.pondId != null) {
        newLines[lineIdx] = {
          ...line,
          entity_key: '__inherit__',
          station_id: '',
          aquaculture_pond_id: '',
        }
      }
    }
    if (field === 'debit_account_id') {
      const accountId = value ? parseInt(value) : null
      newLines[index] = { ...newLines[index], debit_account_id: accountId, credit_account_id: null }
      applyDefaultEntityIfNeeded(index, accountId)
    } else if (field === 'credit_account_id') {
      const accountId = value ? parseInt(value) : null
      newLines[index] = { ...newLines[index], credit_account_id: accountId, debit_account_id: null }
      applyDefaultEntityIfNeeded(index, accountId)
    } else {
      newLines[index] = { ...newLines[index], [field]: value }
    }
    setFormData({ ...formData, lines: newLines })
  }

  const updateLineEntity = (index: number, key: string) => {
    const newLines = [...formData.lines]
    const line = newLines[index]
    if (key === '') {
      newLines[index] = {
        ...line,
        entity_key: '__inherit__',
        station_id: '',
        aquaculture_pond_id: '',
      }
    } else if (key === HEAD_OFFICE_SCOPE_KEY) {
      newLines[index] = {
        ...line,
        entity_key: HEAD_OFFICE_SCOPE_KEY,
        station_id: '',
        aquaculture_pond_id: '',
      }
    } else {
      const applied = applyJournalLineEntityKey(line, key)
      newLines[index] = { ...applied, entity_key: key }
    }
    setFormData({ ...formData, lines: newLines })
  }

  const lineEntityScopeWarning = (line: LineForm): string | null => {
    const accId = line.debit_account_id || line.credit_account_id
    if (!accId || !(Number(line.amount) > 0)) return null
    const acc = accounts.find((a) => a.id === accId)
    if (!accountNeedsEntityTag(acc)) return null
    if (lineHasBusinessEntityTag(line, formData.defaultEntityKey)) return null
    if (line.entity_key === HEAD_OFFICE_SCOPE_KEY) {
      return 'Head office is for balance-sheet lines. Pick a fuel station, shop hub, or pond for P&L.'
    }
    return 'Assign an entity (fuel station, shop hub, or pond) so this amount appears on entity P&L.'
  }

  const commitEntryDate = (): boolean => {
    if (!entryDateInputRef.current?.commit()) {
      toast.error('Enter a valid entry date (use the company date format, then save again).')
      return false
    }
    return true
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!commitEntryDate()) return

    if (!isBalanced()) {
      toast.error('Journal entry must be balanced (Total Debit = Total Credit)')
      return
    }

    const linesToSubmit = formData.lines.filter(line => 
      (line.debit_account_id || line.credit_account_id) && Number(line.amount) > 0
    )

    if (linesToSubmit.length < 2) {
      toast.error('Journal entry must have at least 2 lines')
      return
    }

    const scopeErr = validateEntityScopingForLines(linesToSubmit, formData.defaultEntityKey, accounts)
    if (scopeErr) {
      toast.error(scopeErr)
      return
    }

    try {
      const body: Record<string, unknown> = {
        entry_date: formData.entry_date,
        reference: formData.reference || null,
        description: formData.description || null,
        lines: linesToSubmit.map((line) => {
          const resolved = resolveLineEntityForSave(line, entryDefault)
          return {
            line_number: line.line_number,
            description: line.description || null,
            debit_account_id: line.debit_account_id || null,
            credit_account_id: line.credit_account_id || null,
            amount: Number(line.amount),
            station_id: resolved.station_id,
            aquaculture_pond_id: resolved.aquaculture_pond_id,
          }
        }),
      }
      body.station_id =
        entryDefault.isHeadOffice || entryDefault.stationId === ''
          ? null
          : Number(entryDefault.stationId)
      await api.post('/journal-entries/', body)
      const savedDate = String(body.entry_date || '')
      toast.success('Journal entry saved as draft.')
      toast.info(
        'Post the entry (green check icon) so it appears in Trial Balance, P&L, and other GL reports.'
      )
      if (entryOutsideListDateFilter(savedDate, startDate, endDate, hasTextSearch)) {
        toast.info(
          'Entry date is outside your current list date filter — clear the date range to find it here.'
        )
      }
      setShowModal(false)
      resetForm()
      fetchEntries()
    } catch (error) {
      console.error('Error creating journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to create journal entry'))
    }
  }

  const handleEdit = (entry: JournalEntry) => {
    if (entry.is_posted) {
      toast.error('Cannot edit posted journal entry')
      return
    }
    setEditingEntry(entry)
    const defaultEntityKey = inferJournalDefaultEntityKey(entry)
    const entryDefaultForEdit = parseJournalDefaultEntityKey(defaultEntityKey)
    setFormData({
      entry_date: entry.entry_date.split('T')[0],
      reference: entry.reference || '',
      description: entry.description || '',
      defaultEntityKey,
      lines: entry.lines.map((line) => {
        const lineStationId =
          line.station_id != null && line.station_id !== undefined ? Number(line.station_id) : ''
        const linePondId =
          line.aquaculture_pond_id != null && line.aquaculture_pond_id !== undefined
            ? Number(line.aquaculture_pond_id)
            : ''
        const entityKey = inferLineEntityKeyFromSaved(
          { station_id: lineStationId, aquaculture_pond_id: linePondId },
          defaultEntityKey
        )
        const matchesEntryStationDefault =
          entityKey === '__inherit__' &&
          entryDefaultForEdit.stationId !== '' &&
          lineStationId !== '' &&
          lineStationId === entryDefaultForEdit.stationId
        const matchesEntryPondDefault =
          entityKey === '__inherit__' &&
          entryDefaultForEdit.pondId !== '' &&
          linePondId !== '' &&
          linePondId === entryDefaultForEdit.pondId
        return {
          line_number: line.line_number,
          description: line.description || '',
          debit_account_id: line.debit_account_id || null,
          credit_account_id: line.credit_account_id || null,
          amount: Number(line.amount),
          entity_key: entityKey,
          station_id:
            matchesEntryStationDefault || entityKey === '__inherit__' || entityKey === HEAD_OFFICE_SCOPE_KEY
              ? ''
              : lineStationId,
          aquaculture_pond_id:
            matchesEntryPondDefault || entityKey === '__inherit__' || entityKey === HEAD_OFFICE_SCOPE_KEY
              ? ''
              : linePondId === ''
                ? ''
                : linePondId,
        }
      }),
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingEntry) return

    if (!commitEntryDate()) return

    if (!isBalanced()) {
      toast.error('Journal entry must be balanced (Total Debit = Total Credit)')
      return
    }

    const linesToSubmit = formData.lines.filter(line => 
      (line.debit_account_id || line.credit_account_id) && Number(line.amount) > 0
    )

    if (linesToSubmit.length < 2) {
      toast.error('Journal entry must have at least 2 lines')
      return
    }

    const scopeErr = validateEntityScopingForLines(linesToSubmit, formData.defaultEntityKey, accounts)
    if (scopeErr) {
      toast.error(scopeErr)
      return
    }

    try {
      const body: Record<string, unknown> = {
        entry_date: formData.entry_date,
        reference: formData.reference || null,
        description: formData.description || null,
        lines: linesToSubmit.map((line) => {
          const resolved = resolveLineEntityForSave(line, entryDefault)
          return {
            line_number: line.line_number,
            description: line.description || null,
            debit_account_id: line.debit_account_id || null,
            credit_account_id: line.credit_account_id || null,
            amount: Number(line.amount),
            station_id: resolved.station_id,
            aquaculture_pond_id: resolved.aquaculture_pond_id,
          }
        }),
      }
      body.station_id =
        entryDefault.isHeadOffice || entryDefault.stationId === ''
          ? null
          : Number(entryDefault.stationId)
      await api.put(`/journal-entries/${editingEntry.id}/`, body)
      toast.success('Journal entry updated successfully!')
      setShowModal(false)
      setEditingEntry(null)
      resetForm()
      await fetchEntries()
    } catch (error) {
      console.error('Error updating journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to update journal entry'))
    }
  }

  const handlePost = async (entryId: number) => {
    try {
      await api.post(`/journal-entries/${entryId}/post/`)
      toast.success('Journal entry posted successfully!')
      await fetchEntries()
    } catch (error) {
      console.error('Error posting journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to post journal entry'))
    }
  }

  const handleUnpost = async (entryId: number) => {
    try {
      await api.post(`/journal-entries/${entryId}/unpost/`, {})
      toast.success('Journal entry unposted successfully!')
      await fetchEntries()
    } catch (error) {
      console.error('Error unposting journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to unpost journal entry'))
    }
  }

  const handleDelete = async (entryId: number) => {
    try {
      await api.delete(`/journal-entries/${entryId}/`)
      toast.success('Journal entry deleted successfully!')
      setShowDeleteConfirm(null)
      await fetchEntries()
    } catch (error) {
      console.error('Error deleting journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to delete journal entry'))
    }
  }

  const handleView = async (entryId: number) => {
    try {
      const response = await api.get(`/journal-entries/${entryId}/`)
      setViewingEntry(response.data)
      setShowViewModal(true)
    } catch (error) {
      console.error('Error loading journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to load journal entry'))
    }
  }

  const viewDeepLinkConsumed = useRef(false)
  useEffect(() => {
    if (viewDeepLinkConsumed.current || loading) return
    const raw = searchParams.get('view')
    if (!raw || !/^\d+$/.test(raw)) return
    const id = parseInt(raw, 10)
    if (!Number.isFinite(id) || id <= 0) return
    viewDeepLinkConsumed.current = true
    void handleView(id)
    window.history.replaceState({}, '', '/journal-entries')
  }, [loading, searchParams])

  const resetForm = () => {
    setFormData({
      entry_date: new Date().toISOString().split('T')[0],
      reference: '',
      description: '',
      defaultEntityKey: '',
      lines: [
        {
          line_number: 1,
          description: '',
          debit_account_id: null,
          credit_account_id: null,
          amount: 0,
          station_id: '',
          aquaculture_pond_id: '',
          entity_key: '__inherit__',
        },
        {
          line_number: 2,
          description: '',
          debit_account_id: null,
          credit_account_id: null,
          amount: 0,
          station_id: '',
          aquaculture_pond_id: '',
          entity_key: '__inherit__',
        },
      ],
    })
    setEditingEntry(null)
    setQuickEntryKind('')
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const { totalDebit, totalCredit } = calculateTotals()
  const balanceDifference = Math.abs(totalDebit - totalCredit)

  const handlePrintList = async () => {
    const exportEntries = entries.length > 0 && entries.length < totalCount
      ? await fetchAllFilteredEntries()
      : entries
    if (exportEntries.length === 0) {
      toast.error('No journal entries to print for the current filter.')
      return
    }
    const sub = [
      startDate && `From ${startDate}`,
      endDate && `To ${endDate}`,
      minAmount && `Min ${minAmount}`,
      maxAmount && `Max ${maxAmount}`,
      filterValue && `Filter: ${filterColumn}=${filterValue}`,
      `Generated ${formatDate(new Date(), true)}`,
    ]
      .filter(Boolean)
      .join(' · ')
    const rows = exportEntries
      .map(
        (e) => `<tr>
          <td>${escapeHtml(e.entry_number)}</td>
          <td>${escapeHtml(formatDateOnly(e.entry_date))}</td>
          <td>${escapeHtml(e.reference || '—')}</td>
          <td>${escapeHtml(e.description || '—')}</td>
          <td>${escapeHtml(e.station_name?.trim() || '—')}</td>
          <td>${escapeHtml(e.is_posted ? 'Posted' : 'Draft')}</td>
          <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(Number(e.total_debit)))}</td>
          <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(Number(e.total_credit)))}</td>
        </tr>`,
      )
      .join('')
    const ok = await printListView({
      title: 'Journal entries',
      subtitle: sub,
      tableHtml: `<table><thead><tr><th>Entry #</th><th>Date</th><th>Reference</th><th>Description</th><th>Site</th><th>Status</th><th class="right">Debit</th><th class="right">Credit</th></tr></thead><tbody>${rows}</tbody></table>`,
    })
    if (!ok) toast.error('Allow pop-ups to print, or check your browser settings.')
  }

  const handleDownloadListCsv = async () => {
    const exportEntries = entries.length > 0 && entries.length < totalCount
      ? await fetchAllFilteredEntries()
      : entries
    if (exportEntries.length === 0) {
      toast.error('No journal entries to export.')
      return
    }
    downloadCsvFile(
      `journal_entries_${new Date().toISOString().slice(0, 10)}.csv`,
      buildJournalEntryListCsv(exportEntries, { formatDate: formatDateOnly }),
    )
  }

  const handleDownloadListJson = async () => {
    const exportEntries = entries.length > 0 && entries.length < totalCount
      ? await fetchAllFilteredEntries()
      : entries
    if (exportEntries.length === 0) {
      toast.error('No journal entries to export.')
      return
    }
    downloadJsonFile(`journal_entries_${new Date().toISOString().slice(0, 10)}.json`, exportEntries)
  }

  const handlePrintViewingEntry = async () => {
    if (!viewingEntry) return
    const branding = await loadPrintBranding(api)
    const bodyHtml = buildJournalEntryPrintHtml(viewingEntry, {
      currencySymbol,
      formatDateOnly,
      formatDateTime: (d) => formatDate(d, true),
      formatNumber,
    })
    const ok = await printHtmlDocument(`Journal ${viewingEntry.entry_number}`, bodyHtml, branding)
    if (!ok) toast.error('Allow pop-ups to print, or check your browser settings.')
  }

  const handleDownloadViewingEntryCsv = () => {
    if (!viewingEntry) return
    downloadCsvFile(
      `journal_${viewingEntry.entry_number}.csv`,
      buildJournalEntryDetailCsv(viewingEntry),
    )
  }

  const handleDownloadViewingEntryJson = () => {
    if (!viewingEntry) return
    downloadJsonFile(`journal_${viewingEntry.entry_number}.json`, viewingEntry)
  }

  if (initialLoad && loading) {
    return (
      <PageLayout className="bg-background">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="erp-loading-spinner h-12 w-12"></div>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout className="bg-background">
      <ErpPageShell
        showBackLink={false}
        titleId="journal-entries-title"
        eyebrow={pageMeta.eyebrow}
        eyebrowIcon={pageMeta.eyebrow ? ScrollText : undefined}
        title={pageMeta.title}
        titleIcon={ScrollText}
        description={pageMeta.description ?? undefined}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center space-x-2 px-4 py-2 border border-white/25 bg-card/10 text-white rounded-lg hover:bg-card/15 transition-colors"
            >
              <Filter className="h-5 w-5" />
              <span>Filter</span>
            </button>
            <DocumentExportButtons
              onPrint={() => void handlePrintList()}
              onDownloadCsv={() => void handleDownloadListCsv()}
              onDownloadJson={() => void handleDownloadListJson()}
              printLabel="Print list"
            />
            <button
              onClick={() => {
                resetForm()
                setShowModal(true)
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-accent0 transition-colors"
            >
              <Plus className="h-5 w-5" />
              <span>New Journal Entry</span>
            </button>
          </div>
        }
      >
          {error ? (
            <div className="rounded-lg border border-red-900/50 bg-red-950/40 p-6 text-center">
              <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-red-200 mb-2">Error Loading Journal Entries</h3>
              <p className="text-red-300 mb-4">{error}</p>
              <button
                onClick={() => void fetchEntries()}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-destructive text-white rounded-lg hover:bg-destructive/90 transition-colors"
              >
                <RefreshCw className="h-5 w-5" />
                <span>Retry</span>
              </button>
            </div>
          ) : (
            <Fragment>

          {/* Filter Panel */}
          {showFilters && (
            <div className="bg-card rounded-lg shadow-md p-6 mb-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Filter Transactions</h2>
                <button
                  onClick={() => {
                    setFilterColumn('all')
                    setFilterValue('')
                    setStartDate('')
                    setEndDate('')
                    setMinAmount('')
                    setMaxAmount('')
                    setShowFilters(false)
                  }}
                  className="text-sm text-muted-foreground hover:text-muted-foreground"
                >
                  Clear All
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                {/* Date Range */}
                <div className="md:col-span-2 lg:col-span-2">
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Date range
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="flex-1 px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                      placeholder="From Date"
                    />
                    <span className="text-muted-foreground">to</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="flex-1 px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                      placeholder="To Date"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Leave blank to include all dates, including back-dated entries.</p>
                </div>

                {/* Amount Range */}
                <div className="md:col-span-2 lg:col-span-2">
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Amount range (entry total)
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={minAmount}
                      onChange={(e) => setMinAmount(e.target.value)}
                      className="flex-1 px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                      placeholder="Min amount"
                    />
                    <span className="text-muted-foreground">to</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={maxAmount}
                      onChange={(e) => setMaxAmount(e.target.value)}
                      className="flex-1 px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                      placeholder="Max amount"
                    />
                  </div>
                </div>

                {/* Filter Column Dropdown */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Filter By Column
                  </label>
                  <select
                    value={filterColumn}
                    onChange={(e) => {
                      setFilterColumn(e.target.value)
                      setFilterValue('')
                    }}
                    className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                  >
                    <option value="all">All Columns</option>
                    <option value="entry_number">Entry Number</option>
                    <option value="reference">Reference</option>
                    <option value="description">Description</option>
                    <option value="account">Account (Name/Code)</option>
                    <option value="amount">Amount</option>
                    <option value="is_posted">Status (Posted/Draft)</option>
                  </select>
                </div>

                {/* Filter Value Input */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    {filterColumn === 'all' ? 'Search Value' : `Search ${filterColumn.replace('_', ' ')}`}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={filterValue}
                      onChange={(e) => setFilterValue(e.target.value)}
                      placeholder={
                        filterColumn === 'all'
                          ? 'Search entry #, description, account, site…'
                          : filterColumn === 'amount'
                            ? 'e.g., 1000 or 100-500'
                            : filterColumn === 'is_posted'
                              ? 'true/false or posted/draft'
                              : 'Enter search value'
                      }
                      className="w-full px-3 py-2 pr-10 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                    />
                    <Search className="absolute right-3 top-2.5 h-5 w-5 text-muted-foreground/80" />
                  </div>
                  {filterColumn === 'all' && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Searches all dates — old and new entries. Date range is ignored while searching.
                    </p>
                  )}
                  {filterColumn === 'amount' && (
                    <p className="text-xs text-muted-foreground mt-1">Enter amount or range (e.g., 100-500)</p>
                  )}
                  {filterColumn === 'is_posted' && (
                    <p className="text-xs text-muted-foreground mt-1">Enter: true/false, posted/draft, yes/no</p>
                  )}
                  {filterColumn !== 'all' && filterColumn !== 'amount' && filterColumn !== 'is_posted' && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Column search includes all dates; clear search to apply the date range again.
                    </p>
                  )}
                </div>
              </div>
              
              {/* Active Filters Display */}
              {(hasTextSearch || startDate || endDate || minAmount || maxAmount) && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">Active Filters:</span>
                    {hasTextSearch && (
                      <span className="px-2 py-1 bg-amber-100 text-warning-foreground rounded text-xs">
                        Search: {debouncedSearch}
                        {filterColumn !== 'all' ? ` (${filterColumn.replace('_', ' ')})` : ' (all columns)'}
                        <button
                          onClick={() => setFilterValue('')}
                          className="ml-1 hover:text-warning-foreground"
                        >
                          ×
                        </button>
                      </span>
                    )}
                    {startDate && !hasTextSearch && (
                      <span className="px-2 py-1 bg-blue-950/50 text-blue-200 rounded text-xs">
                        From: {formatDateOnly(startDate)}
                        <button
                          onClick={() => setStartDate('')}
                          className="ml-1 hover:text-primary"
                        >
                          ×
                        </button>
                      </span>
                    )}
                    {endDate && !hasTextSearch && (
                      <span className="px-2 py-1 bg-blue-950/50 text-blue-200 rounded text-xs">
                        To: {formatDateOnly(endDate)}
                        <button
                          onClick={() => setEndDate('')}
                          className="ml-1 hover:text-primary"
                        >
                          ×
                        </button>
                      </span>
                    )}
                    {hasTextSearch && (startDate || endDate) && (
                      <span className="px-2 py-1 bg-muted text-muted-foreground rounded text-xs italic">
                        Date range paused during search
                      </span>
                    )}
                    {minAmount && (
                      <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs">
                        Min: {minAmount}
                        <button
                          onClick={() => setMinAmount('')}
                          className="ml-1 hover:text-purple-600"
                        >
                          ×
                        </button>
                      </span>
                    )}
                    {maxAmount && (
                      <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs">
                        Max: {maxAmount}
                        <button
                          onClick={() => setMaxAmount('')}
                          className="ml-1 hover:text-purple-600"
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {totalCount} matching {totalCount === 1 ? 'entry' : 'entries'} — use pagination below to browse all results.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="bg-card rounded-lg shadow overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Entry #</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Reference</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Description</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Site</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Debit</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Credit</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-muted">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {entry.entry_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateOnly(entry.entry_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {entry.reference || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">
                      {entry.description || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground max-w-[14rem] truncate" title={entry.station_name?.trim() || undefined}>
                      {entry.station_name?.trim() ? entry.station_name : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-foreground tabular-nums">
                      {currencySymbol}{formatNumber(Number(entry.total_debit || 0))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-foreground tabular-nums">
                      {currencySymbol}{formatNumber(Number(entry.total_credit || 0))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        entry.is_posted 
                          ? 'bg-success/15 text-success' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {entry.is_posted ? 'Posted' : 'Draft'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => handleView(entry.id)}
                          className="text-primary hover:text-blue-900"
                          title="View"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {!entry.is_posted && (
                          <>
                            <button
                              onClick={() => handleEdit(entry)}
                              className="text-primary hover:text-blue-900"
                              title="Edit"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setShowDeleteConfirm(entry.id)}
                              className="text-destructive hover:text-red-900"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {entry.is_posted ? (
                          <button
                            onClick={() => handleUnpost(entry.id)}
                            className="text-orange-600 hover:text-orange-900"
                            title="Unpost"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePost(entry.id)}
                            className="text-success hover:text-green-900"
                            title="Post"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                No journal entries found. Create your first entry to get started.
              </div>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
            <OffsetPaginationControls
              page={listPage}
              pageSize={pageSize}
              total={totalCount}
              onPageChange={setListPage}
              onPageSizeChange={setPageSize}
              disabled={loading}
            />
          </div>

          {/* Delete Confirmation Modal */}
          {showDeleteConfirm && (
        <div className="erp-modal-backdrop">
          <div className="bg-card rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">Delete Journal Entry</h2>
            <p className="text-muted-foreground mb-6">
              Are you sure you want to delete this journal entry? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 border border-input rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="erp-btn-danger"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {showViewModal && viewingEntry && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-card rounded-lg app-modal-pad max-w-[1440px] w-full max-h-[96vh] overflow-y-auto my-8">
            <div className="flex flex-wrap justify-between items-start gap-3 mb-6">
              <h2 className="text-2xl font-bold text-foreground">Journal Entry: {viewingEntry.entry_number}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <DocumentExportButtons
                  size="compact"
                  onPrint={() => void handlePrintViewingEntry()}
                  onDownloadCsv={handleDownloadViewingEntryCsv}
                  onDownloadJson={handleDownloadViewingEntryJson}
                  printLabel="Print"
                />
                <button
                  onClick={() => {
                    setShowViewModal(false)
                    setViewingEntry(null)
                  }}
                  className="text-muted-foreground/80 hover:text-muted-foreground"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Date</label>
                <p className="text-foreground">{formatDateOnly(viewingEntry.entry_date)}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Reference</label>
                <p className="text-foreground">{viewingEntry.reference || '-'}</p>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-muted-foreground mb-1">Description</label>
                <p className="text-foreground">{viewingEntry.description || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Default entity</label>
                <p className="text-foreground">
                  {viewingEntry.station_name?.trim() ? viewingEntry.station_name : 'Head office / not set'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Status</label>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  viewingEntry.is_posted 
                    ? 'bg-success/15 text-success' 
                    : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {viewingEntry.is_posted ? 'Posted' : 'Draft'}
                </span>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-lg font-semibold mb-4">Entry Lines</h3>
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Line</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Account</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Description</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Entity</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Debit</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Credit</th>
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-border">
                  {viewingEntry.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-4 py-2 text-sm text-foreground">{line.line_number}</td>
                      <td className="px-4 py-2 text-sm text-foreground">
                        {line.debit_account_id 
                          ? `${line.debit_account_code} - ${line.debit_account_name}`
                          : line.credit_account_id
                          ? `${line.credit_account_code} - ${line.credit_account_name}`
                          : '-'
                        }
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">{line.description || '-'}</td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">
                        {line.station_name?.trim()
                          ? line.station_name
                          : line.pond_name?.trim()
                            ? line.pond_name
                            : 'Head office'}
                      </td>
                      <td className="px-4 py-2 text-sm text-right font-medium text-foreground tabular-nums">
                        {Number(line.debit) > 0
                          ? `${currencySymbol}${formatNumber(Number(line.debit))}`
                          : '-'}
                      </td>
                      <td className="px-4 py-2 text-sm text-right font-medium text-foreground tabular-nums">
                        {Number(line.credit) > 0
                          ? `${currencySymbol}${formatNumber(Number(line.credit))}`
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted">
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-sm font-semibold text-foreground text-right">Total:</td>
                    <td className="px-4 py-2 text-sm font-semibold text-foreground text-right">
                      {currencySymbol}{formatNumber(Number(viewingEntry.total_debit))}
                    </td>
                    <td className="px-4 py-2 text-sm font-semibold text-foreground text-right">
                      {currencySymbol}{formatNumber(Number(viewingEntry.total_credit))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
          )}

          {/* Create/Edit Modal */}
          {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-card rounded-lg app-modal-pad max-w-[1440px] w-full max-h-[96vh] overflow-y-auto my-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-foreground">
                {editingEntry ? 'Edit Journal Entry' : 'New Journal Entry'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="text-muted-foreground/80 hover:text-muted-foreground"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={editingEntry ? handleUpdate : handleCreate}>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Entry Date *
                  </label>
                  <CompanyDateInput
                    ref={entryDateInputRef}
                    required
                    value={formData.entry_date}
                    onChange={(iso) => setFormData({ ...formData, entry_date: iso })}
                    className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Past dates (including years back) are allowed. Tab out of the date field or press
                    Enter before Save. Then post the draft so GL reports include it.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Reference
                  </label>
                  <input
                    type="text"
                    value={formData.reference}
                    onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                    className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                    placeholder="Optional reference"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                    placeholder="Optional description"
                  />
                </div>
                {showDefaultEntitySelect ? (
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-muted-foreground mb-2">
                      Default entity for lines (optional)
                    </label>
                    <JournalDefaultEntitySelect
                      value={formData.defaultEntityKey}
                      onChange={(defaultEntityKey) =>
                        setFormData({
                          ...formData,
                          defaultEntityKey,
                        })
                      }
                      stations={stations}
                      ponds={ponds}
                      companyName={companyName}
                      className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Fuel station, shop hub (Premium Agro), head office, or pond. Per-line entity
                      overrides the default. Income, COGS, and expense lines need a station, shop hub, or
                      pond tag for entity P&amp;L — head office is for balance-sheet lines (cash, AP, AR).
                    </p>
                    {entityDirectoryLoading ? (
                      <p className="mt-1 text-xs text-primary">Loading entity list…</p>
                    ) : entityDirectoryError ? (
                      <p className="mt-1 text-xs text-warning-foreground">{entityDirectoryError}</p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">{entityCountSummary}</p>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="mb-6 rounded-lg border border-indigo-800/60 bg-indigo-950/40 p-4">
                <label className="block text-sm font-medium text-indigo-100 mb-2">
                  Quick entry (suggested GL + entity tags)
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    value={quickEntryKind}
                    onChange={(e) => {
                      const v = e.target.value as JournalQuickEntryKind | ''
                      setQuickEntryKind(v)
                      if (v) applyQuickEntry(v)
                    }}
                    className="min-w-[14rem] flex-1 rounded-lg border border-indigo-700/50 bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="">— Choose a pattern —</option>
                    {JOURNAL_QUICK_ENTRY_TEMPLATES.map((t) => (
                      <option key={t.kind} value={t.kind}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {quickEntryKind ? (
                    <p className="text-xs text-indigo-200/90 sm:max-w-md">
                      {JOURNAL_QUICK_ENTRY_TEMPLATES.find((t) => t.kind === quickEntryKind)?.hint}
                    </p>
                  ) : (
                    <p className="text-xs text-indigo-300/90">
                      Pre-fills debit/credit from the fuel-station + aquaculture chart template. Income, COGS,
                      and expense lines get a fuel station, shop hub, or pond tag when required.
                    </p>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Entry Lines</h3>
                  <button
                    type="button"
                    onClick={addLine}
                    className="px-3 py-1 text-sm bg-primary text-white rounded hover:bg-primary"
                  >
                    Add Line
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Line</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Account</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Type</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Description</th>
                        {showEntityCol ? (
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">
                            Entity
                          </th>
                        ) : null}
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Amount</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="bg-card divide-y divide-border">
                      {formData.lines.map((line, index) => (
                        <tr key={index}>
                          <td className="px-3 py-2 text-sm text-foreground">{line.line_number}</td>
                          <td className="px-3 py-2">
                            <select
                              value={line.debit_account_id || line.credit_account_id || ''}
                              onChange={(e) => {
                                const value = e.target.value ? parseInt(e.target.value) : null
                                if (value) {
                                  // Determine if it's debit or credit based on which field is empty
                                  if (!line.debit_account_id && !line.credit_account_id) {
                                    // First time selecting - default to debit
                                    updateLine(index, 'debit_account_id', value)
                                  } else if (line.debit_account_id) {
                                    updateLine(index, 'debit_account_id', value)
                                  } else {
                                    updateLine(index, 'credit_account_id', value)
                                  }
                                } else {
                                  updateLine(index, 'debit_account_id', null)
                                  updateLine(index, 'credit_account_id', null)
                                }
                              }}
                              className="w-full px-2 py-1 text-sm border border-input rounded bg-background text-foreground focus:ring-2 focus:ring-ring"
                              required
                            >
                              <option value="">Select Account</option>
                              {recommendedAccounts.length > 0 ? (
                                <optgroup label="Recommended for this ERP">
                                  {recommendedAccounts.map((account) => (
                                    <option key={account.id} value={account.id}>
                                      {formatCoaOptionLabel(account)}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                              {otherAccounts.length > 0 ? (
                                <optgroup label="All accounts">
                                  {otherAccounts.map((account) => (
                                    <option key={account.id} value={account.id}>
                                      {formatCoaOptionLabel(account)}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={line.debit_account_id ? 'debit' : line.credit_account_id ? 'credit' : ''}
                              onChange={(e) => {
                                const accountId = line.debit_account_id || line.credit_account_id
                                if (accountId) {
                                  if (e.target.value === 'debit') {
                                    updateLine(index, 'debit_account_id', accountId)
                                  } else {
                                    updateLine(index, 'credit_account_id', accountId)
                                  }
                                }
                              }}
                              className="w-full px-2 py-1 text-sm border border-input rounded bg-background text-foreground focus:ring-2 focus:ring-ring"
                              required
                            >
                              <option value="">Select Type</option>
                              <option value="debit">Debit</option>
                              <option value="credit">Credit</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={line.description}
                              onChange={(e) => updateLine(index, 'description', e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-input rounded bg-background text-foreground focus:ring-2 focus:ring-ring"
                              placeholder="Optional"
                            />
                          </td>
                          {showEntityCol ? (
                            <td className="px-3 py-2 min-w-[12rem]">
                              <BillLineEntitySelect
                                value={journalLineEntitySelectValue(line, formData.defaultEntityKey)}
                                onChange={(key) => updateLineEntity(index, key)}
                                stations={stations}
                                ponds={ponds}
                                companyName={companyName}
                                showHeadOffice
                                unsetOption={{
                                  label: formData.defaultEntityKey
                                    ? '— Use entry default —'
                                    : '— Not set —',
                                }}
                                className="w-full px-2 py-1 text-sm border border-input rounded bg-background text-foreground focus:ring-2 focus:ring-ring"
                                placeholder="Entity…"
                              />
                            </td>
                          ) : null}
                          <td className="px-3 py-2 min-w-[10rem]">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.amount}
                              onChange={(e) => updateLine(index, 'amount', e.target.value)}
                              className={AMOUNT_JE_LINE_CLASS}
                              placeholder="0.00"
                              required
                            />
                            {lineEntityScopeWarning(line) ? (
                              <p className="mt-1 text-xs text-warning-foreground">{lineEntityScopeWarning(line)}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {formData.lines.length > 2 && (
                              <button
                                type="button"
                                onClick={() => removeLine(index)}
                                className="text-destructive hover:text-red-900"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted">
                      <tr>
                        <td
                          colSpan={lineTableMetaCols}
                          className="px-3 py-2 text-sm font-semibold text-foreground text-right"
                        >
                          Total:
                        </td>
                        <td colSpan={2} className="px-3 py-2">
                          <div className="flex justify-between text-sm">
                            <span className="font-semibold">Debit: {currencySymbol}{formatNumber(totalDebit)}</span>
                            <span className="font-semibold">Credit: {currencySymbol}{formatNumber(totalCredit)}</span>
                          </div>
                          {balanceDifference > 0.01 && (
                            <div className="mt-1 text-xs text-destructive flex items-center">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              Difference: {currencySymbol}{formatNumber(balanceDifference)}
                            </div>
                          )}
                          {isBalanced() && (
                            <div className="mt-1 text-xs text-success flex items-center">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Balanced
                            </div>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 border border-input rounded-lg hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isBalanced()}
                  className={`px-4 py-2 rounded-lg ${
                    isBalanced()
                      ? 'bg-primary text-white hover:bg-primary'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  }`}
                >
                  {editingEntry ? 'Update Entry' : 'Create Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
          )}
        </Fragment>
          )}
      </ErpPageShell>
    </PageLayout>
  )
}
