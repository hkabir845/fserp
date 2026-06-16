import { ModuleHub } from '@/components/ModuleHub'
import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { procurementHub } from '@/config/app-modules'

export default function ProcurementHubPage() {
  return (
    <div className="space-y-4 p-4">
      <ReportingHubBreadcrumb current="Procurement hub" />
      <ModuleHub {...procurementHub} />
    </div>
  )
}
