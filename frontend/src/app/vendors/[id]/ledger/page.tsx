'use client'

import { useParams } from 'next/navigation'
import ContactLedgerPage from '@/components/ContactLedgerPage'

export default function VendorLedgerPage() {
  const params = useParams()
  const id = Number(params?.id)
  if (!Number.isFinite(id)) {
    return null
  }
  return (
    <ContactLedgerPage
      entity="vendors"
      entityId={id}
      backHref="/vendors"
      backLabel="Vendors"
    />
  )
}
