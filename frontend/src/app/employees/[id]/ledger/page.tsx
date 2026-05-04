'use client'

import { useParams } from 'next/navigation'
import ContactLedgerPage from '@/components/ContactLedgerPage'

export default function EmployeeLedgerPage() {
  const params = useParams()
  const id = Number(params?.id)
  if (!Number.isFinite(id)) {
    return null
  }
  return (
    <ContactLedgerPage
      entity="employees"
      entityId={id}
      backHref="/employees"
      backLabel="Employees"
      allowManualEntries
    />
  )
}
