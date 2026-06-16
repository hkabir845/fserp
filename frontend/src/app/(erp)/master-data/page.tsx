import { ModuleHub } from '@/components/ModuleHub'
import { masterDataHub } from '@/config/app-modules'

export default function MasterDataHubPage() {
  return <ModuleHub {...masterDataHub} />
}
