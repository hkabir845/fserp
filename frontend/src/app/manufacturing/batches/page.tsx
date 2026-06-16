import { redirect } from 'next/navigation'

// Plan B: in feed manufacturing, "batches" are executed via production orders.
export default function ManufacturingBatchesPage() {
  redirect('/manufacturing/production-orders')
}

