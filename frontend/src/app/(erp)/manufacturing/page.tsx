import { ModuleHub } from '@/components/ModuleHub'
import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { manufacturingHub } from '@/config/app-modules'

export default function ManufacturingHubPage() {
  return (
    <div className="space-y-4 p-4">
      <ReportingHubBreadcrumb current="Manufacturing hub" />
      <ModuleHub {...manufacturingHub} />
    </div>
  )
}
