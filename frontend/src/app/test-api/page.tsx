import { notFound } from 'next/navigation'

/** Dev-only route removed — returns 404. Restore from version control if you need the old tester UI. */
export default function TestAPIPage() {
  notFound()
}
