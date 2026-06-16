import { ModulesLauncher } from '@/components/ModulesLauncher'
import { erpModuleApps } from '@/config/module-apps'

export default function ModulesIndexPage() {
  return <ModulesLauncher erpModuleCount={erpModuleApps.length} />
}
