import { useConfigStore } from '@/stores/config'

export function useBrand() {
  const configStore = useConfigStore()

  return {
    get brandName() {
      return configStore.brandName?.trim() || 'Incudal'
    },
    get brandSubtitle() {
      return configStore.brandSubtitle?.trim() || '稳定易用的云主机服务'
    },
    get brandLogoUrl() {
      return configStore.brandLogoUrl?.trim() || '/incudal_logo.webp'
    }
  }
}
