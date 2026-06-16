import { ModuleHub } from '@/components/ModuleHub'
import { crmHub } from '@/config/app-modules'

export default function CrmHubPage() {
  return <ModuleHub {...crmHub} />
}
