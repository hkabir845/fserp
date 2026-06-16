import { ModuleHub } from '@/components/ModuleHub'
import { accountingHub } from '@/config/app-modules'

export default function AccountingHubPage() {
  return <ModuleHub {...accountingHub} />
}
