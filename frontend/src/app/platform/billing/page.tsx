import { ModuleHub } from '@/components/ModuleHub'

const LINKS = [
  { title: 'Invoices', href: '/platform/invoices', icon: '🧾', description: 'Platform billing invoices' },
  { title: 'Payments', href: '/platform/payments', icon: '💵', description: 'Recorded payments' },
]

export default function PlatformBillingHubPage() {
  return (
    <ModuleHub
      layout="platform"
      title="Billing"
      subtitle="Platform-level invoices and payments."
      links={LINKS}
    />
  )
}
