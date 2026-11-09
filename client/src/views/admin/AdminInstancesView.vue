<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api, { type AdminInstanceItem, type AdminPackageItem, type AdminPlanItem, type AdminPurchaserItem } from '@/api'
import { useThemeStore } from '@/stores/theme'
import SkeletonLoader from '@/components/SkeletonLoader.vue'

const { t } = useI18n()
const themeStore = useThemeStore()
type Tab = 'instances' | 'packages' | 'plans' | 'purchasers'
const tab = ref<Tab>('instances')
const search = ref('')
const source = ref<'all' | 'official' | 'hosted'>('all')
const page = ref(1)
const pageSize = ref(25)
const loading = ref(false)
const error = ref('')
const total = ref(0)
const totalPages = ref(1)
const items = ref<Array<AdminInstanceItem | AdminPackageItem | AdminPlanItem | AdminPurchaserItem>>([])
let requestId = 0

const tabs = computed(() => [
  { value: 'instances' as const, label: t('admin.instances.tabs.instances') },
  { value: 'packages' as const, label: t('admin.instances.tabs.packages') },
  { value: 'plans' as const, label: t('admin.instances.tabs.plans') },
  { value: 'purchasers' as const, label: t('admin.instances.tabs.purchasers') }
])
const isDark = computed(() => themeStore.isDark)
const rowClass = computed(() => isDark.value ? 'border-gray-800' : 'border-gray-200')
const mutedClass = computed(() => isDark.value ? 'text-gray-400' : 'text-gray-500')
const sourceLabel = (value: 'official' | 'hosted') => t(`admin.instances.sources.${value}`)
const formatDate = (value: string) => new Date(value).toLocaleString()

async function load() {
  const current = ++requestId
  loading.value = true
  error.value = ''
  try {
    const params = { page: page.value, pageSize: pageSize.value, search: search.value || undefined, source: source.value === 'all' ? undefined : source.value }
    const response = tab.value === 'instances'
      ? await api.admin.adminInstances.list(params)
      : tab.value === 'packages'
        ? await api.admin.adminInstances.packages(params)
        : tab.value === 'plans'
          ? await api.admin.adminInstances.plans(params)
          : await api.admin.adminInstances.purchasers(params)
    if (current !== requestId) return
    items.value = response.items
    total.value = response.total
    totalPages.value = response.totalPages
  } catch (err: any) {
    if (current === requestId) error.value = err?.message || t('admin.instances.loadFailed')
  } finally {
    if (current === requestId) loading.value = false
  }
}

function changeTab(next: Tab) {
  tab.value = next
  page.value = 1
}
function changePage(next: number) {
  page.value = Math.min(totalPages.value, Math.max(1, next))
}
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch([tab, source, pageSize], () => { page.value = 1; void load() })
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; void load() }, 250)
})
watch(page, () => { void load() })
onMounted(load)
</script>

<template>
  <div class="p-4 md:p-6 max-w-[1600px] mx-auto">
    <div class="flex flex-wrap items-start justify-between gap-4 mb-5">
      <div>
        <h1 class="text-xl font-semibold" :class="isDark ? 'text-gray-100' : 'text-gray-900'">{{ t('admin.instances.title') }}</h1>
        <p class="text-sm mt-1" :class="mutedClass">{{ t('admin.instances.description') }}</p>
      </div>
      <button class="px-3 py-2 text-sm border rounded" :class="isDark ? 'border-gray-700 text-gray-200' : 'border-gray-300 text-gray-700'" :disabled="loading" @click="load">
        {{ t('admin.instances.refresh') }}
      </button>
    </div>

    <div class="flex flex-wrap gap-1 border-b mb-4" :class="rowClass">
      <button v-for="item in tabs" :key="item.value" class="px-3 py-2 text-sm border-b-2 -mb-px" :class="tab === item.value ? 'border-blue-500 text-blue-500' : `border-transparent ${mutedClass}`" @click="changeTab(item.value)">{{ item.label }}</button>
    </div>

    <div class="flex flex-wrap gap-2 mb-4">
      <input v-model="search" type="search" :placeholder="t('admin.instances.searchPlaceholder')" class="w-full sm:w-80 px-3 py-2 text-sm rounded border bg-transparent" :class="isDark ? 'border-gray-700 text-gray-100' : 'border-gray-300 text-gray-900'" />
      <select v-model="source" class="px-3 py-2 text-sm rounded border bg-transparent" :class="isDark ? 'border-gray-700 text-gray-100' : 'border-gray-300 text-gray-900'">
        <option value="all">{{ t('admin.instances.sources.all') }}</option>
        <option value="official">{{ sourceLabel('official') }}</option>
        <option value="hosted">{{ sourceLabel('hosted') }}</option>
      </select>
      <select v-model.number="pageSize" class="px-3 py-2 text-sm rounded border bg-transparent" :class="isDark ? 'border-gray-700 text-gray-100' : 'border-gray-300 text-gray-900'">
        <option :value="25">25</option><option :value="50">50</option><option :value="100">100</option>
      </select>
    </div>

    <div v-if="error" class="mb-4 p-3 rounded border border-red-300 text-red-600 text-sm">{{ error }}</div>
    <div class="rounded border overflow-x-auto" :class="isDark ? 'border-gray-800' : 'border-gray-200'">
      <SkeletonLoader v-if="loading" :count="5" class="p-4" />
      <table v-else class="min-w-full text-sm">
        <thead :class="isDark ? 'bg-gray-900 text-gray-300' : 'bg-gray-50 text-gray-600'"><tr class="text-left">
          <th v-if="tab === 'instances'" class="px-3 py-3">{{ t('admin.instances.columns.instance') }}</th>
          <th v-if="tab === 'instances'" class="px-3 py-3">{{ t('admin.instances.columns.user') }}</th>
          <th v-if="tab === 'instances'" class="px-3 py-3">{{ t('admin.instances.columns.host') }}</th>
          <th v-if="tab === 'instances'" class="px-3 py-3">{{ t('admin.instances.columns.package') }}</th>
          <th v-if="tab === 'packages'" class="px-3 py-3">{{ t('admin.instances.columns.package') }}</th>
          <th v-if="tab === 'packages'" class="px-3 py-3">{{ t('admin.instances.columns.owner') }}</th>
          <th v-if="tab === 'packages'" class="px-3 py-3">{{ t('admin.instances.columns.usage') }}</th>
          <th v-if="tab === 'plans'" class="px-3 py-3">{{ t('admin.instances.columns.plan') }}</th>
          <th v-if="tab === 'plans'" class="px-3 py-3">{{ t('admin.instances.columns.package') }}</th>
          <th v-if="tab === 'plans'" class="px-3 py-3">{{ t('admin.instances.columns.price') }}</th>
          <th v-if="tab === 'purchasers'" class="px-3 py-3">{{ t('admin.instances.columns.user') }}</th>
          <th v-if="tab === 'purchasers'" class="px-3 py-3">{{ t('admin.instances.columns.paidInstances') }}</th>
          <th v-if="tab === 'purchasers'" class="px-3 py-3">{{ t('admin.instances.columns.source') }}</th>
          <th class="px-3 py-3">{{ t('common.createdAt') }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" class="border-t" :class="rowClass">
            <template v-if="tab === 'instances'">
              <td class="px-3 py-3"><div class="font-medium">{{ (item as AdminInstanceItem).name }}</div><div class="text-xs" :class="mutedClass">#{{ item.id }} · {{ (item as AdminInstanceItem).status }}</div></td>
              <td class="px-3 py-3">{{ (item as AdminInstanceItem).user.username }}</td>
              <td class="px-3 py-3"><div>{{ (item as AdminInstanceItem).host.name }}</div><div class="text-xs" :class="mutedClass">{{ sourceLabel((item as AdminInstanceItem).host.source) }} · {{ (item as AdminInstanceItem).host.owner.username }}</div></td>
              <td class="px-3 py-3"><div>{{ (item as AdminInstanceItem).package?.name || t('common.none') }}</div><div v-if="(item as AdminInstanceItem).plan" class="text-xs" :class="mutedClass">{{ (item as AdminInstanceItem).plan?.name }}</div></td>
            </template>
            <template v-else-if="tab === 'packages'"><td class="px-3 py-3"><div class="font-medium">{{ (item as AdminPackageItem).name }}</div><div class="text-xs" :class="mutedClass">{{ sourceLabel((item as AdminPackageItem).source) }}</div></td><td class="px-3 py-3">{{ (item as AdminPackageItem).owner.username }}</td><td class="px-3 py-3">{{ (item as AdminPackageItem).counts.instances }} / {{ (item as AdminPackageItem).counts.plans }} / {{ (item as AdminPackageItem).counts.packageHosts }}</td></template>
            <template v-else-if="tab === 'plans'"><td class="px-3 py-3"><div class="font-medium">{{ (item as AdminPlanItem).name }}</div><div class="text-xs" :class="mutedClass">{{ (item as AdminPlanItem).active ? t('admin.instances.active') : t('admin.instances.inactive') }}</div></td><td class="px-3 py-3"><div>{{ (item as AdminPlanItem).package.name }}</div><div class="text-xs" :class="mutedClass">{{ sourceLabel((item as AdminPlanItem).package.source) }} · {{ (item as AdminPlanItem).package.owner.username }}</div></td><td class="px-3 py-3">¥{{ (item as AdminPlanItem).price.toFixed(2) }} / {{ (item as AdminPlanItem).billingCycle }}{{ t('common.month') }} · {{ (item as AdminPlanItem).purchasedInstances }}</td></template>
            <template v-else><td class="px-3 py-3"><div class="font-medium">{{ (item as AdminPurchaserItem).username }}</div><div class="text-xs" :class="mutedClass">#{{ item.id }} · {{ (item as AdminPurchaserItem).status }}</div></td><td class="px-3 py-3">{{ (item as AdminPurchaserItem).paidInstanceCount }}</td><td class="px-3 py-3">{{ sourceLabel((item as AdminPurchaserItem).source) }}</td></template>
            <td class="px-3 py-3 whitespace-nowrap" :class="mutedClass">{{ formatDate(item.createdAt) }}</td>
          </tr>
          <tr v-if="!items.length && !loading"><td colspan="8" class="px-3 py-10 text-center" :class="mutedClass">{{ t('admin.instances.empty') }}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="flex items-center justify-between gap-3 mt-4 text-sm" :class="mutedClass">
      <span>{{ t('common.totalCount', { count: total }) }}</span>
      <div class="flex items-center gap-2"><button class="px-2 py-1 border rounded" :disabled="page <= 1" @click="changePage(page - 1)">{{ t('common.prevPage') }}</button><span>{{ page }} / {{ totalPages }}</span><button class="px-2 py-1 border rounded" :disabled="page >= totalPages" @click="changePage(page + 1)">{{ t('common.nextPage') }}</button></div>
    </div>
  </div>
</template>
