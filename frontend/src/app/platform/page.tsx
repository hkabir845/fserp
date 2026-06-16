import { ModuleHub } from '@/components/ModuleHub'
import { platformHub } from '@/config/app-modules'

export default function PlatformHubPage() {
  return <ModuleHub layout="platform" {...platformHub} />
}
