'use client'

import { useParams } from 'next/navigation'
import ContactLedgerPage from '@/components/ContactLedgerPage'

export default function CustomerLedgerPage() {
  const params = useParams()
  const id = Number(params?.id)
  if (!Number.isFinite(id)) {
    return null
  }
  return (
    <ContactLedgerPage
      entity="customers"
      entityId={id}
      backHref="/customers"
      backLabel="Customers"
    />
  )
}
