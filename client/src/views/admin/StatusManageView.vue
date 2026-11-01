<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'

const { t, d } = useI18n()
const toast = useToast()
const loading = ref(true)
const components = ref<any[]>([])
const incidents = ref<any[]>([])
const maintenances = ref<any[]>([])
const component = ref({ name: '', description: '', sortOrder: 0, isOperational: true })
const incident = ref({ title: '', status: 'investigating', impact: 'minor', body: '' })
const emptyWindow = () => ({ id: 0, title: '', body: '', impact: 'minor', scheduledStart: '', scheduledEnd: '' })
const maintenance = ref(emptyWindow())
const updateText = ref<Record<number, string>>({})
const editingId = ref<number | null>(null)

async function load() {
  loading.value = true
  try {
    const result = await api.status.adminList()
    components.value = result.components
    incidents.value = result.incidents
    maintenances.value = result.maintenances
  } catch { toast.error(t('common.loadFailed')) } finally { loading.value = false }
}
async function addComponent() { if (!component.value.name.trim()) return; try { await api.status.createComponent(component.value); component.value = { name: '', description: '', sortOrder: 0, isOperational: true }; await load() } catch { toast.error(t('common.saveFailed')) } }
async function toggleComponent(item: any) { try { await api.status.updateComponent(item.id, { isOperational: !item.isOperational }); await load() } catch { toast.error(t('common.saveFailed')) } }
async function removeComponent(id: number) { try { await api.status.deleteComponent(id); await load() } catch { toast.error(t('common.deleteFailed')) } }
async function addIncident() { if (!incident.value.title.trim() || !incident.value.body.trim()) return; try { await api.status.createIncident(incident.value); incident.value = { title: '', status: 'investigating', impact: 'minor', body: '' }; await load() } catch { toast.error(t('common.saveFailed')) } }
async function resolveIncident(item: any) { try { await api.status.updateIncident(item.id, { status: 'resolved' }); await load() } catch { toast.error(t('common.saveFailed')) } }
async function removeIncident(id: number) { try { await api.status.deleteIncident(id); await load() } catch { toast.error(t('common.deleteFailed')) } }
function editMaintenance(item: any) {
  editingId.value = item.id
  maintenance.value = { id: item.id, title: item.title, body: item.body, impact: item.impact, scheduledStart: new Date(item.scheduledStart).toISOString().slice(0, 16), scheduledEnd: new Date(item.scheduledEnd).toISOString().slice(0, 16) }
}
function resetMaintenance() { editingId.value = null; maintenance.value = emptyWindow() }
async function saveMaintenance() {
  const payload = { title: maintenance.value.title, body: maintenance.value.body, impact: maintenance.value.impact, scheduledStart: new Date(maintenance.value.scheduledStart).toISOString(), scheduledEnd: new Date(maintenance.value.scheduledEnd).toISOString() }
  try {
    if (editingId.value) await api.status.updateMaintenance(editingId.value, payload)
    else await api.status.createMaintenance(payload)
    resetMaintenance()
    await load()
  } catch { toast.error(t('common.saveFailed')) }
}
async function cancelMaintenance(item: any) { try { await api.status.cancelMaintenance(item.id); await load() } catch { toast.error(t('common.saveFailed')) } }
async function deleteMaintenance(id: number) { try { await api.status.deleteMaintenance(id); await load() } catch { toast.error(t('common.deleteFailed')) } }
async function addUpdate(item: any) { const body = updateText.value[item.id]?.trim(); if (!body) return; try { await api.status.addMaintenanceUpdate(item.id, body); updateText.value[item.id] = ''; await load() } catch { toast.error(t('common.saveFailed')) } }
onMounted(load)
</script>

<template>
  <main class="space-y-8 p-6 text-themed">
    <header><h1 class="page-title">{{ t('status.adminTitle') }}</h1><p class="page-description">{{ t('status.adminDescription') }}</p></header>
    <p v-if="loading" class="text-themed-muted">{{ t('common.loading') }}</p>
    <template v-else>
      <section class="border-b border-themed pb-6"><h2 class="mb-4 text-lg font-semibold">{{ t('status.components') }}</h2><form class="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]" @submit.prevent="addComponent"><input v-model="component.name" :placeholder="t('status.componentName')" required class="input-themed"><input v-model="component.description" :placeholder="t('status.componentDescription')" class="input-themed"><label class="flex items-center gap-2 text-sm"><input v-model="component.isOperational" type="checkbox">{{ t('status.operational') }}</label><button class="btn-themed" type="submit">{{ t('common.create') }}</button></form><ul class="mt-4 divide-y divide-themed"><li v-for="item in components" :key="item.id" class="flex items-center justify-between gap-3 py-3"><span>{{ item.name }}</span><span class="flex gap-2"><button class="btn-themed text-sm" @click="toggleComponent(item)">{{ t(item.isOperational ? 'status.markDegraded' : 'status.markOperational') }}</button><button class="text-sm text-red-600" @click="removeComponent(item.id)">{{ t('common.delete') }}</button></span></li></ul></section>
      <section class="border-b border-themed pb-6"><h2 class="mb-4 text-lg font-semibold">{{ t('status.incidents') }}</h2><form class="space-y-3 border-b border-themed pb-6" @submit.prevent="addIncident"><input v-model="incident.title" :placeholder="t('status.incidentTitle')" required class="input-themed w-full"><div class="grid gap-3 md:grid-cols-2"><select v-model="incident.impact" class="input-themed"><option value="none">{{ t('status.none') }}</option><option value="minor">{{ t('status.minor') }}</option><option value="major">{{ t('status.major') }}</option><option value="critical">{{ t('status.critical') }}</option></select><select v-model="incident.status" class="input-themed"><option value="investigating">{{ t('status.investigating') }}</option><option value="identified">{{ t('status.identified') }}</option><option value="monitoring">{{ t('status.monitoring') }}</option><option value="resolved">{{ t('status.resolved') }}</option></select></div><textarea v-model="incident.body" :placeholder="t('status.incidentBody')" required rows="4" class="input-themed w-full"></textarea><button class="btn-themed" type="submit">{{ t('common.create') }}</button></form><ul class="divide-y divide-themed"><li v-for="item in incidents" :key="item.id" class="py-4"><div class="flex justify-between gap-3"><div><h3 class="font-medium">{{ item.title }}</h3><p class="text-sm text-themed-muted">{{ item.status }} · {{ item.impact }}</p></div><span class="flex gap-2"><button v-if="item.status !== 'resolved'" class="btn-themed text-sm" @click="resolveIncident(item)">{{ t('status.resolve') }}</button><button class="text-sm text-red-600" @click="removeIncident(item.id)">{{ t('common.delete') }}</button></span></div></li></ul></section>
      <section><h2 class="mb-4 text-lg font-semibold">{{ t('status.maintenance') }}</h2><form class="space-y-3 border-b border-themed pb-6" @submit.prevent="saveMaintenance"><input v-model="maintenance.title" :placeholder="t('status.maintenanceTitle')" required class="input-themed w-full"><select v-model="maintenance.impact" class="input-themed"><option value="none">{{ t('status.none') }}</option><option value="minor">{{ t('status.minor') }}</option><option value="major">{{ t('status.major') }}</option><option value="critical">{{ t('status.critical') }}</option></select><textarea v-model="maintenance.body" :placeholder="t('status.maintenanceBody')" required rows="3" class="input-themed w-full"></textarea><div class="grid gap-3 md:grid-cols-2"><label class="text-sm">{{ t('status.startsAt') }}<input v-model="maintenance.scheduledStart" type="datetime-local" required class="input-themed mt-1 w-full"></label><label class="text-sm">{{ t('status.endsAt') }}<input v-model="maintenance.scheduledEnd" type="datetime-local" required class="input-themed mt-1 w-full"></label></div><div class="flex gap-2"><button class="btn-themed" type="submit">{{ t(editingId ? 'status.saveMaintenance' : 'status.createMaintenance') }}</button><button v-if="editingId" class="btn-themed" type="button" @click="resetMaintenance">{{ t('common.cancel') }}</button></div></form>
        <article v-for="item in maintenances" :key="item.id" class="border-b border-themed py-5"><div class="flex flex-wrap justify-between gap-3"><div><h3 class="font-medium">{{ item.title }} · {{ t(`status.${item.status}`) }}</h3><p class="text-xs text-themed-muted">{{ d(new Date(item.scheduledStart), 'long') }} - {{ d(new Date(item.scheduledEnd), 'long') }}</p><p class="mt-2 whitespace-pre-wrap text-sm">{{ item.body }}</p></div><span v-if="item.status === 'scheduled' || item.status === 'active'" class="flex h-fit gap-2"><button class="btn-themed text-sm" @click="editMaintenance(item)">{{ t('common.edit') }}</button><button class="text-sm text-red-600" @click="cancelMaintenance(item)">{{ t('status.cancelMaintenance') }}</button><button class="text-sm text-red-600" @click="deleteMaintenance(item.id)">{{ t('common.delete') }}</button></span></div><ol v-if="item.updates.length" class="mt-3 space-y-2"> <li v-for="update in item.updates" :key="update.id" class="text-sm"><time class="text-xs text-themed-muted">{{ d(new Date(update.createdAt), 'long') }}</time><p>{{ update.body }}</p></li></ol><form v-if="item.status === 'scheduled' || item.status === 'active'" class="mt-3 flex gap-2" @submit.prevent="addUpdate(item)"><input v-model="updateText[item.id]" class="input-themed min-w-0 flex-1" :placeholder="t('status.maintenanceUpdate')"><button class="btn-themed" type="submit">{{ t('status.postUpdate') }}</button></form></article>
      </section>
    </template>
  </main>
</template>
