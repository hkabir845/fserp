import { ModuleHub } from '@/components/ModuleHub'

const LINKS = [
  { title: 'All Tenants', href: '/platform/tenants/browse', icon: '📋', description: 'Search and manage tenants' },
  { title: 'New Tenant', href: '/platform/tenants/new', icon: '➕', description: 'Provision a new tenant' },
]

export default function PlatformTenantsHubPage() {
  return (
    <ModuleHub
      layout="platform"
      title="Tenants"
      subtitle="Navigate tenant administration screens."
      links={LINKS}
    />
  )
}
