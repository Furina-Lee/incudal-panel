<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'

const { t, d } = useI18n()
const loading = ref(true)
const failed = ref(false)
const data = ref<Awaited<ReturnType<typeof api.status.get>> | null>(null)
onMounted(async () => {
  try { data.value = await api.status.get() } catch { failed.value = true } finally { loading.value = false }
})
const statusKeys: Record<string, string> = { investigating: 'status.investigating', identified: 'status.identified', monitoring: 'status.monitoring', resolved: 'status.resolved' }
const impactKeys: Record<string, string> = { none: 'status.none', minor: 'status.minor', major: 'status.major', critical: 'status.critical' }
const maintenanceKeys: Record<string, string> = { scheduled: 'status.scheduled', active: 'status.active', completed: 'status.completed', cancelled: 'status.cancelled' }
</script>

<template>
  <main class="mx-auto max-w-4xl space-y-8 p-6 text-themed">
    <header><h1 class="page-title">{{ t('status.title') }}</h1><p class="page-description">{{ t('status.description') }}</p></header>
    <p v-if="loading" class="text-themed-muted">{{ t('common.loading') }}</p>
    <p v-else-if="failed" class="text-red-600">{{ t('common.loadFailed') }}</p>
    <template v-else-if="data">
      <section class="border-y border-themed py-5">
        <h2 class="mb-4 text-lg font-semibold">{{ t('status.components') }}</h2>
        <p v-if="!data.components.length" class="text-sm text-themed-muted">{{ t('status.noComponents') }}</p>
        <ul class="divide-y divide-themed">
          <li v-for="component in data.components" :key="component.id" class="flex items-center justify-between gap-4 py-3">
            <div><h3 class="font-medium">{{ component.name }}</h3><p v-if="component.description" class="text-sm text-themed-muted">{{ component.description }}</p></div>
            <span class="shrink-0 text-sm" :class="component.isOperational ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'">{{ t(component.isOperational ? 'status.operational' : 'status.degraded') }}</span>
          </li>
        </ul>
      </section>
      <section class="border-y border-themed py-5">
        <h2 class="mb-4 text-lg font-semibold">{{ t('status.maintenance') }}</h2>
        <p v-if="!data.maintenances.length" class="text-sm text-themed-muted">{{ t('status.noMaintenance') }}</p>
        <article v-for="window in data.maintenances" :key="window.id" class="border-t border-themed py-4 first:border-0">
          <div class="flex flex-wrap items-baseline justify-between gap-2"><h3 class="font-medium">{{ window.title }}</h3><span class="text-sm text-themed-muted">{{ t(maintenanceKeys[window.status] || 'status.scheduled') }} · {{ t(impactKeys[window.impact] || 'status.minor') }}</span></div>
          <p class="mt-1 text-xs text-themed-muted">{{ d(new Date(window.scheduledStart), 'long') }} - {{ d(new Date(window.scheduledEnd), 'long') }}</p>
          <p class="mt-3 whitespace-pre-wrap text-sm">{{ window.body }}</p>
          <ol v-if="window.updates.length" class="mt-4 space-y-3 border-l-2 border-themed pl-4"><li v-for="update in window.updates" :key="update.id"><time class="text-xs text-themed-muted">{{ d(new Date(update.createdAt), 'long') }}</time><p class="mt-1 whitespace-pre-wrap text-sm">{{ update.body }}</p></li></ol>
        </article>
      </section>
      <section>
        <h2 class="mb-4 text-lg font-semibold">{{ t('status.incidents') }}</h2>
        <p v-if="!data.incidents.length" class="py-8 text-center text-themed-muted">{{ t('status.noIncidents') }}</p>
        <article v-for="incident in data.incidents" :key="incident.id" class="border-t border-themed py-5">
          <div class="flex flex-wrap items-baseline justify-between gap-2"><h3 class="text-base font-semibold">{{ incident.title }}</h3><span class="text-sm text-themed-muted">{{ t(statusKeys[incident.status] || 'status.investigating') }} · {{ t(impactKeys[incident.impact] || 'status.none') }}</span></div>
          <p class="mt-1 text-xs text-themed-muted">{{ d(new Date(incident.startedAt), 'long') }}</p>
          <p class="mt-3 whitespace-pre-wrap text-sm">{{ incident.body }}</p>
          <ol v-if="incident.updates.length" class="mt-4 space-y-3 border-l-2 border-themed pl-4">
            <li v-for="update in incident.updates" :key="update.id"><div class="flex flex-wrap justify-between gap-2 text-xs text-themed-muted"><span>{{ t(statusKeys[update.status] || 'status.investigating') }}</span><time>{{ d(new Date(update.createdAt), 'long') }}</time></div><p class="mt-1 whitespace-pre-wrap text-sm">{{ update.body }}</p></li>
          </ol>
        </article>
      </section>
    </template>
  </main>
</template>
