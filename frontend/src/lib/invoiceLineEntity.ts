/** Invoice line entity scope — same shape as vendor bill lines. */
export {
  applyBillLineEntityKey as applyInvoiceLineEntityKey,
  billLineEntityKey as invoiceLineEntityKey,
  billLineEntityKind as invoiceLineEntityKind,
  billLineExpenseReportingKind,
  type BillLineEntityFields as InvoiceLineEntityFields,
} from '@/lib/billLineEntity'
