<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import type { StatusMaintenance } from '@/types/api'
import { useToast } from '@/stores/toast'

interface StatusComponent {
  id: number
  name: string
  description: string | null
  sortOrder: number
  isOperational: boolean
}

interface StatusIncidentUpdate {
  id: number
  status: string
  body: string
  createdAt: string
}

interface StatusIncident {
  id: number
  title: string
  status: string
  impact: string
  body: string
  startedAt: string
  resolvedAt: string | null
  updates: StatusIncidentUpdate[]
}

interface ComponentForm {
  id: number | null
  name: string
  description: string
  sortOrder: number
  isOperational: boolean
}

interface IncidentForm {
  id: number | null
  title: string
  status: string
  impact: string
  body: string
}

interface MaintenanceForm {
  id: number | null
  title: string
  body: string
  impact: string
  scheduledStart: string
  scheduledEnd: string
}

const { t, d } = useI18n()
const toast = useToast()
const loading = ref(true)
const loadError = ref('')
const saving = ref<string | null>(null)
const components = ref<StatusComponent[]>([])
const incidents = ref<StatusIncident[]>([])
const maintenances = ref<StatusMaintenance[]>([])
const updateText = ref<Record<number, string>>({})
const componentForm = ref<ComponentForm>(emptyComponent())
const incidentForm = ref<IncidentForm>(emptyIncident())
const maintenanceForm = ref<MaintenanceForm>(emptyMaintenance())

const editingComponent = computed(() => componentForm.value.id !== null)
const editingIncident = computed(() => incidentForm.value.id !== null)
const editingMaintenance = computed(() => maintenanceForm.value.id !== null)
const maintenanceDateError = computed(() => {
  const { scheduledStart, scheduledEnd } = maintenanceForm.value
  if (!scheduledStart || !scheduledEnd) return ''
  return new Date(scheduledStart).getTime() < new Date(scheduledEnd).getTime() ? '' : t('status.invalidMaintenanceRange')
})

function emptyComponent(): ComponentForm {
  return { id: null, name: '', description: '', sortOrder: 0, isOperational: true }
}
function emptyIncident(): IncidentForm {
  return { id: null, title: '', status: 'investigating', impact: 'minor', body: '' }
}
function emptyMaintenance(): MaintenanceForm {
  return { id: null, title: '', body: '', impact: 'minor', scheduledStart: '', scheduledEnd: '' }
}
function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : d(date, 'long')
}
function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
function errorMessage(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { error?: string } } })?.response
  return response?.data?.error || (error instanceof Error ? error.message : fallback)
}
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await api.status.adminList()
    components.value = result.components as StatusComponent[]
    incidents.value = result.incidents as StatusIncident[]
    maintenances.value = result.maintenances
  } catch (error) {
    loadError.value = errorMessage(error, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
function editComponent(item: StatusComponent) {
  componentForm.value = { id: item.id, name: item.name, description: item.description || '', sortOrder: item.sortOrder, isOperational: item.isOperational }
}
function resetComponent() { componentForm.value = emptyComponent() }
async function saveComponent() {
  if (!componentForm.value.name.trim()) return
  saving.value = 'component'
  try {
    const payload = { name: componentForm.value.name.trim(), description: componentForm.value.description.trim() || undefined, sortOrder: componentForm.value.sortOrder, isOperational: componentForm.value.isOperational }
    if (componentForm.value.id === null) await api.status.createComponent(payload)
    else await api.status.updateComponent(componentForm.value.id, payload)
    toast.success(t('common.saveSuccess'))
    resetComponent()
    await load()
  } catch (error) { toast.error(errorMessage(error, t('common.saveFailed'))) } finally { saving.value = null }
}
async function toggleComponent(item: StatusComponent) {
  saving.value = `component-${item.id}`
  try { await api.status.updateComponent(item.id, { isOperational: !item.isOperational }); await load() } catch (error) { toast.error(errorMessage(error, t('common.saveFailed'))) } finally { saving.value = null }
}
async function removeComponent(item: StatusComponent) {
  if (!window.confirm(t('status.confirmDeleteComponent', { name: item.name }))) return
  saving.value = `delete-component-${item.id}`
  try { await api.status.deleteComponent(item.id); toast.success(t('common.deleteSuccess')); await load() } catch (error) { toast.error(errorMessage(error, t('common.deleteFailed'))) } finally { saving.value = null }
}
function editIncident(item: StatusIncident) {
  incidentForm.value = { id: item.id, title: item.title, status: item.status, impact: item.impact, body: item.body }
}
function resetIncident() { incidentForm.value = emptyIncident() }
async function saveIncident() {
  if (!incidentForm.value.title.trim() || !incidentForm.value.body.trim()) return
  saving.value = 'incident'
  try {
    const payload = { title: incidentForm.value.title.trim(), status: incidentForm.value.status, impact: incidentForm.value.impact, body: incidentForm.value.body.trim() }
    if (incidentForm.value.id === null) await api.status.createIncident(payload)
    else await api.status.updateIncident(incidentForm.value.id, payload)
    toast.success(t('common.saveSuccess'))
    resetIncident()
    await load()
  } catch (error) { toast.error(errorMessage(error, t('common.saveFailed'))) } finally { saving.value = null }
}
async function resolveIncident(item: StatusIncident) {
  if (!window.confirm(t('status.confirmResolveIncident', { title: item.title }))) return
  saving.value = `incident-${item.id}`
  try { await api.status.updateIncident(item.id, { status: 'resolved' }); toast.success(t('status.resolveSuccess')); await load() } catch (error) { toast.error(errorMessage(error, t('common.saveFailed'))) } finally { saving.value = null }
}
async function removeIncident(item: StatusIncident) {
  if (!window.confirm(t('status.confirmDeleteIncident', { title: item.title }))) return
  saving.value = `delete-incident-${item.id}`
  try { await api.status.deleteIncident(item.id); toast.success(t('common.deleteSuccess')); await load() } catch (error) { toast.error(errorMessage(error, t('common.deleteFailed'))) } finally { saving.value = null }
}
function editMaintenance(item: StatusMaintenance) {
  maintenanceForm.value = { id: item.id, title: item.title, body: item.body, impact: item.impact, scheduledStart: toDateTimeLocal(item.scheduledStart), scheduledEnd: toDateTimeLocal(item.scheduledEnd) }
}
function resetMaintenance() { maintenanceForm.value = emptyMaintenance() }
async function saveMaintenance() {
  if (!maintenanceForm.value.title.trim() || !maintenanceForm.value.body.trim() || maintenanceDateError.value) return
  saving.value = 'maintenance'
  try {
    const payload = { title: maintenanceForm.value.title.trim(), body: maintenanceForm.value.body.trim(), impact: maintenanceForm.value.impact, scheduledStart: new Date(maintenanceForm.value.scheduledStart).toISOString(), scheduledEnd: new Date(maintenanceForm.value.scheduledEnd).toISOString() }
    if (maintenanceForm.value.id === null) await api.status.createMaintenance(payload)
    else await api.status.updateMaintenance(maintenanceForm.value.id, payload)
    toast.success(t('common.saveSuccess'))
    resetMaintenance()
    await load()
  } catch (error) { toast.error(errorMessage(error, t('common.saveFailed'))) } finally { saving.value = null }
}
async function cancelMaintenance(item: StatusMaintenance) {
  if (!window.confirm(t('status.confirmCancelMaintenance', { title: item.title }))) return
  saving.value = `maintenance-${item.id}`
  try { await api.status.cancelMaintenance(item.id); toast.success(t('status.cancelSuccess')); await load() } catch (error) { toast.error(errorMessage(error, t('common.saveFailed'))) } finally { saving.value = null }
}
async function deleteMaintenance(item: StatusMaintenance) {
  if (!window.confirm(t('status.confirmDeleteMaintenance', { title: item.title }))) return
  saving.value = `delete-maintenance-${item.id}`
  try { await api.status.deleteMaintenance(item.id); toast.success(t('common.deleteSuccess')); await load() } catch (error) { toast.error(errorMessage(error, t('common.deleteFailed'))) } finally { saving.value = null }
}
async function addUpdate(item: StatusMaintenance) {
  const body = updateText.value[item.id]?.trim()
  if (!body) return
  saving.value = `update-${item.id}`
  try { await api.status.addMaintenanceUpdate(item.id, body); updateText.value[item.id] = ''; toast.success(t('status.updatePosted')); await load() } catch (error) { toast.error(errorMessage(error, t('common.saveFailed'))) } finally { saving.value = null }
}
onMounted(load)
</script>

<template>
  <main class="mx-auto max-w-7xl space-y-8 p-4 text-themed sm:p-6">
    <header class="flex flex-col gap-3 border-b border-themed pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-themed-muted">{{ t('status.adminEyebrow') }}</p>
        <h1 class="page-title">{{ t('status.adminTitle') }}</h1>
        <p class="page-description">{{ t('status.adminDescription') }}</p>
      </div>
      <button type="button" class="btn-themed inline-flex items-center justify-center gap-2" :disabled="loading" @click="load">
        <svg class="h-4 w-4" :class="loading ? 'animate-spin' : ''" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v5h5M20 20v-5h-5M5.3 9A7 7 0 0117 5.7L20 9M18.7 15A7 7 0 017 18.3L4 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        {{ t('common.refresh') }}
      </button>
    </header>

    <div v-if="loading" class="card p-10 text-center text-themed-muted">{{ t('common.loading') }}</div>
    <div v-else-if="loadError" class="rounded-xl border border-red-300 bg-red-50 p-5 text-red-700 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-300">
      <p class="font-medium">{{ loadError }}</p>
      <button type="button" class="btn-themed mt-4" @click="load">{{ t('common.retry') }}</button>
    </div>
    <template v-else>
      <section class="space-y-4">
        <div class="flex items-center justify-between"><div><h2 class="text-xl font-semibold">{{ t('status.components') }}</h2><p class="text-sm text-themed-muted">{{ t('status.componentsHint') }}</p></div><span class="rounded-full bg-themed-tertiary px-3 py-1 text-sm text-themed-muted">{{ components.length }}</span></div>
        <div class="grid gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
          <form class="card space-y-4 p-5" @submit.prevent="saveComponent">
            <div class="flex items-center justify-between"><h3 class="font-semibold">{{ editingComponent ? t('status.editComponent') : t('status.newComponent') }}</h3><button v-if="editingComponent" type="button" class="text-sm text-themed-muted hover:text-themed" @click="resetComponent">{{ t('common.cancel') }}</button></div>
            <label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.componentName') }}</span><input v-model="componentForm.name" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint w-full" maxlength="120" required></label>
            <label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.componentDescription') }}</span><textarea v-model="componentForm.description" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint min-h-24 w-full" maxlength="500"></textarea></label>
            <div class="grid grid-cols-2 gap-3"><label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.sortOrder') }}</span><input v-model.number="componentForm.sortOrder" type="number" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint w-full" min="0"></label><label class="flex items-end gap-2 pb-2 text-sm"><input v-model="componentForm.isOperational" type="checkbox" class="h-4 w-4">{{ t('status.operational') }}</label></div>
            <button class="btn-themed w-full" type="submit" :disabled="saving === 'component'">{{ saving === 'component' ? t('common.saving') : editingComponent ? t('common.save') : t('common.create') }}</button>
          </form>
          <div class="card divide-y divide-themed overflow-hidden">
            <p v-if="!components.length" class="p-8 text-center text-themed-muted">{{ t('status.noComponents') }}</p>
            <article v-for="item in components" :key="item.id" class="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h3 class="font-semibold">{{ item.name }}</h3><span class="rounded-full px-2.5 py-1 text-xs" :class="item.isOperational ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'">{{ t(item.isOperational ? 'status.operational' : 'status.degraded') }}</span></div><p class="mt-1 text-sm text-themed-muted">{{ item.description || t('status.noComponentDescription') }}</p></div>
              <div class="flex flex-wrap gap-2"><button type="button" class="btn-themed text-sm" @click="editComponent(item)">{{ t('common.edit') }}</button><button type="button" class="btn-themed text-sm" :disabled="saving === `component-${item.id}`" @click="toggleComponent(item)">{{ t(item.isOperational ? 'status.markDegraded' : 'status.markOperational') }}</button><button type="button" class="text-sm text-red-600 hover:underline" @click="removeComponent(item)">{{ t('common.delete') }}</button></div>
            </article>
          </div>
        </div>
      </section>

      <section class="space-y-4">
        <div class="flex items-center justify-between"><div><h2 class="text-xl font-semibold">{{ t('status.incidents') }}</h2><p class="text-sm text-themed-muted">{{ t('status.incidentsHint') }}</p></div><span class="rounded-full bg-themed-tertiary px-3 py-1 text-sm text-themed-muted">{{ incidents.length }}</span></div>
        <div class="grid gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
          <form class="card space-y-4 p-5" @submit.prevent="saveIncident"><div class="flex items-center justify-between"><h3 class="font-semibold">{{ editingIncident ? t('status.editIncident') : t('status.newIncident') }}</h3><button v-if="editingIncident" type="button" class="text-sm text-themed-muted hover:text-themed" @click="resetIncident">{{ t('common.cancel') }}</button></div><label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.incidentTitle') }}</span><input v-model="incidentForm.title" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint w-full" maxlength="200" required></label><div class="grid grid-cols-2 gap-3"><label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.impact') }}</span><select v-model="incidentForm.impact" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint w-full"><option value="none">{{ t('status.none') }}</option><option value="minor">{{ t('status.minor') }}</option><option value="major">{{ t('status.major') }}</option><option value="critical">{{ t('status.critical') }}</option></select></label><label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.statusLabel') }}</span><select v-model="incidentForm.status" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint w-full"><option value="investigating">{{ t('status.investigating') }}</option><option value="identified">{{ t('status.identified') }}</option><option value="monitoring">{{ t('status.monitoring') }}</option><option value="resolved">{{ t('status.resolved') }}</option></select></label></div><label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.incidentBody') }}</span><textarea v-model="incidentForm.body" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint min-h-32 w-full" maxlength="10000" required></textarea></label><button class="btn-themed w-full" type="submit" :disabled="saving === 'incident'">{{ saving === 'incident' ? t('common.saving') : editingIncident ? t('common.save') : t('common.create') }}</button></form>
          <div class="card divide-y divide-themed overflow-hidden"><p v-if="!incidents.length" class="p-8 text-center text-themed-muted">{{ t('status.noIncidents') }}</p><article v-for="item in incidents" :key="item.id" class="p-5"><div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div class="flex flex-wrap items-center gap-2"><h3 class="font-semibold">{{ item.title }}</h3><span class="rounded-full bg-themed-tertiary px-2.5 py-1 text-xs text-themed-muted">{{ t(`status.${item.status}`) }}</span><span class="rounded-full px-2.5 py-1 text-xs" :class="item.impact === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'">{{ t(`status.${item.impact}`) }}</span></div><p class="mt-1 text-xs text-themed-muted">{{ formatDate(item.startedAt) }}</p><p class="mt-3 whitespace-pre-wrap text-sm text-themed-secondary">{{ item.body }}</p></div><div class="flex shrink-0 flex-wrap gap-2"><button type="button" class="btn-themed text-sm" @click="editIncident(item)">{{ t('common.edit') }}</button><button v-if="item.status !== 'resolved'" type="button" class="btn-themed text-sm" @click="resolveIncident(item)">{{ t('status.resolve') }}</button><button type="button" class="text-sm text-red-600 hover:underline" @click="removeIncident(item)">{{ t('common.delete') }}</button></div></div><div v-if="item.updates?.length" class="mt-4 border-l-2 border-themed pl-4"><p class="mb-2 text-xs font-semibold uppercase tracking-wide text-themed-muted">{{ t('status.timeline') }}</p><ol class="space-y-3"><li v-for="update in item.updates" :key="update.id"><p class="text-xs text-themed-muted">{{ t(`status.${update.status}`) }} · {{ formatDate(update.createdAt) }}</p><p class="mt-1 whitespace-pre-wrap text-sm">{{ update.body }}</p></li></ol></div></article></div>
        </div>
      </section>

      <section class="space-y-4"><div class="flex items-center justify-between"><div><h2 class="text-xl font-semibold">{{ t('status.maintenance') }}</h2><p class="text-sm text-themed-muted">{{ t('status.maintenanceHint') }}</p></div><span class="rounded-full bg-themed-tertiary px-3 py-1 text-sm text-themed-muted">{{ maintenances.length }}</span></div>
        <form class="card space-y-4 p-5" @submit.prevent="saveMaintenance"><div class="flex items-center justify-between"><h3 class="font-semibold">{{ editingMaintenance ? t('status.editMaintenance') : t('status.newMaintenance') }}</h3><button v-if="editingMaintenance" type="button" class="text-sm text-themed-muted hover:text-themed" @click="resetMaintenance">{{ t('common.cancel') }}</button></div><div class="grid gap-4 lg:grid-cols-2"><label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.maintenanceTitle') }}</span><input v-model="maintenanceForm.title" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint w-full" maxlength="200" required></label><label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.impact') }}</span><select v-model="maintenanceForm.impact" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint w-full"><option value="none">{{ t('status.none') }}</option><option value="minor">{{ t('status.minor') }}</option><option value="major">{{ t('status.major') }}</option><option value="critical">{{ t('status.critical') }}</option></select></label></div><label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.maintenanceBody') }}</span><textarea v-model="maintenanceForm.body" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint min-h-24 w-full" maxlength="10000" required></textarea></label><div class="grid gap-4 lg:grid-cols-2"><label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.startsAt') }}</span><input v-model="maintenanceForm.scheduledStart" type="datetime-local" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint w-full" required></label><label class="block text-sm"><span class="mb-1.5 block text-themed-secondary">{{ t('status.endsAt') }}</span><input v-model="maintenanceForm.scheduledEnd" type="datetime-local" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint w-full" required><span v-if="maintenanceDateError" class="mt-1 block text-xs text-red-600">{{ maintenanceDateError }}</span></label></div><button class="btn-themed" type="submit" :disabled="saving === 'maintenance' || !!maintenanceDateError">{{ saving === 'maintenance' ? t('common.saving') : editingMaintenance ? t('common.save') : t('status.createMaintenance') }}</button></form>
        <div class="grid gap-4 lg:grid-cols-2"><article v-for="item in maintenances" :key="item.id" class="card flex flex-col p-5"><div class="flex items-start justify-between gap-3"><div><div class="flex flex-wrap items-center gap-2"><h3 class="font-semibold">{{ item.title }}</h3><span class="rounded-full bg-themed-tertiary px-2.5 py-1 text-xs text-themed-muted">{{ t(`status.${item.status}`) }}</span></div><p class="mt-1 text-xs text-themed-muted">{{ formatDate(item.scheduledStart) }} - {{ formatDate(item.scheduledEnd) }}</p></div><span class="rounded-full bg-blue-100 px-2.5 py-1 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{{ t(`status.${item.impact}`) }}</span></div><p class="mt-4 whitespace-pre-wrap text-sm text-themed-secondary">{{ item.body }}</p><div v-if="item.updates?.length" class="mt-4 border-l-2 border-themed pl-4"><ol class="space-y-3"><li v-for="update in item.updates" :key="update.id"><p class="text-xs text-themed-muted">{{ formatDate(update.createdAt) }}</p><p class="mt-1 whitespace-pre-wrap text-sm">{{ update.body }}</p></li></ol></div><div class="mt-auto flex flex-wrap gap-2 pt-5"><button v-if="item.status === 'scheduled' || item.status === 'active'" type="button" class="btn-themed text-sm" @click="editMaintenance(item)">{{ t('common.edit') }}</button><button v-if="item.status === 'scheduled' || item.status === 'active'" type="button" class="btn-themed text-sm" @click="cancelMaintenance(item)">{{ t('status.cancelMaintenance') }}</button><button type="button" class="text-sm text-red-600 hover:underline" @click="deleteMaintenance(item)">{{ t('common.delete') }}</button></div><form v-if="item.status === 'scheduled' || item.status === 'active'" class="mt-4 flex gap-2" @submit.prevent="addUpdate(item)"><input v-model="updateText[item.id]" class="input-themed border border-themed bg-themed-secondary/40 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 placeholder:text-themed-faint min-w-0 flex-1" :placeholder="t('status.maintenanceUpdate')" maxlength="10000"><button class="btn-themed shrink-0 text-sm" type="submit" :disabled="saving === `update-${item.id}`">{{ t('status.postUpdate') }}</button></form></article><p v-if="!maintenances.length" class="card p-8 text-center text-themed-muted lg:col-span-2">{{ t('status.noMaintenance') }}</p></div>
      </section>
    </template>
  </main>
</template>
