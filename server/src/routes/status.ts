import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'

const incidentStatuses = ['investigating', 'identified', 'monitoring', 'resolved'] as const
const impacts = ['none', 'minor', 'major', 'critical'] as const
const maintenanceStatuses = ['scheduled', 'active', 'completed', 'cancelled'] as const

type IncidentStatus = typeof incidentStatuses[number]
type MaintenanceStatus = typeof maintenanceStatuses[number]

function allowed(value: unknown, values: readonly string[]): boolean {
  return typeof value === 'string' && values.includes(value)
}

function parseMaintenance(body: Record<string, unknown>, partial = false) {
  const title = body.title
  const description = body.body
  const impact = body.impact
  const start = body.scheduledStart
  const end = body.scheduledEnd
  const status = body.status
  const update = body.update
  if ((!partial || title !== undefined) && (typeof title !== 'string' || !title.trim() || title.length > 200)) return null
  if ((!partial || description !== undefined) && (typeof description !== 'string' || !description.trim() || description.length > 10000)) return null
  if (impact !== undefined && !allowed(impact, impacts)) return null
  if (status !== undefined && !allowed(status, maintenanceStatuses)) return null
  if (update !== undefined && (typeof update !== 'string' || !update.trim() || update.length > 10000)) return null

  const scheduledStart = start === undefined && partial ? undefined : new Date(String(start))
  const scheduledEnd = end === undefined && partial ? undefined : new Date(String(end))
  if ((scheduledStart && !Number.isFinite(scheduledStart.getTime())) || (scheduledEnd && !Number.isFinite(scheduledEnd.getTime()))) return null
  if (scheduledStart && scheduledEnd && scheduledStart >= scheduledEnd) return null
  return { title, body: description, impact, scheduledStart, scheduledEnd, status, update }
}

const maintenanceInclude = {
  updates: { orderBy: { createdAt: 'desc' as const } }
}

export default async function statusRoutes(fastify: FastifyInstance) {
  fastify.get('/', async () => {
    const [components, incidents, maintenances] = await Promise.all([
      prisma.statusComponent.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, name: true, description: true, sortOrder: true, isOperational: true } }),
      prisma.statusIncident.findMany({ orderBy: { startedAt: 'desc' }, take: 100, include: { updates: { orderBy: { createdAt: 'desc' }, select: { id: true, status: true, body: true, createdAt: true } } } }),
      prisma.statusMaintenance.findMany({ orderBy: { scheduledStart: 'desc' }, take: 100, include: maintenanceInclude })
    ])
    return { components, incidents, maintenances }
  })

  fastify.register(async admin => {
    admin.addHook('onRequest', admin.authenticateAdmin)

    admin.get('/admin/status', async () => {
      const [components, incidents, maintenances] = await Promise.all([
        prisma.statusComponent.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
        prisma.statusIncident.findMany({ orderBy: { startedAt: 'desc' }, take: 100, include: { updates: { orderBy: { createdAt: 'desc' } } } }),
        prisma.statusMaintenance.findMany({ orderBy: [{ scheduledStart: 'desc' }, { id: 'desc' }], take: 200, include: maintenanceInclude })
      ])
      return { components, incidents, maintenances }
    })

    admin.post<{ Body: { name: string; description?: string; sortOrder?: number; isOperational?: boolean } }>('/admin/status/components', async (request, reply) => {
      const { name, description, sortOrder = 0, isOperational = true } = request.body
      if (typeof name !== 'string' || !name.trim() || name.length > 120 || (description !== undefined && typeof description !== 'string') || (typeof description === 'string' && description.length > 500) || !Number.isInteger(sortOrder) || typeof isOperational !== 'boolean') return reply.code(400).send({ error: 'Invalid component fields' })
      try {
        return reply.code(201).send(await prisma.statusComponent.create({ data: { name: name.trim(), description: description?.trim() || null, sortOrder, isOperational } }))
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ error: 'Component name already exists' })
        throw error
      }
    })

    admin.patch<{ Params: { id: string }; Body: { name?: string; description?: string | null; sortOrder?: number; isOperational?: boolean } }>('/admin/status/components/:id', async (request, reply) => {
      const id = Number(request.params.id)
      const { name, description, sortOrder, isOperational } = request.body
      if (!Number.isInteger(id) || (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 120)) || (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 500)) || (sortOrder !== undefined && !Number.isInteger(sortOrder)) || (isOperational !== undefined && typeof isOperational !== 'boolean')) return reply.code(400).send({ error: 'Invalid component fields' })
      const result = await prisma.statusComponent.updateMany({ where: { id }, data: { ...(name === undefined ? {} : { name: name.trim() }), ...(description === undefined ? {} : { description: description?.trim() || null }), ...(sortOrder === undefined ? {} : { sortOrder }), ...(isOperational === undefined ? {} : { isOperational }) } })
      if (!result.count) return reply.code(404).send({ error: 'Component not found' })
      return prisma.statusComponent.findUnique({ where: { id } })
    })

    admin.delete<{ Params: { id: string } }>('/admin/status/components/:id', async (request, reply) => {
      const id = Number(request.params.id)
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid component id' })
      const result = await prisma.statusComponent.deleteMany({ where: { id } })
      if (!result.count) return reply.code(404).send({ error: 'Component not found' })
      return { success: true }
    })

    admin.post<{ Body: { title: string; status: string; impact: string; body: string } }>('/admin/status/incidents', async (request, reply) => {
      const { title, status, impact, body } = request.body
      if (typeof title !== 'string' || !title.trim() || title.length > 200 || !allowed(status, incidentStatuses) || !allowed(impact, impacts) || typeof body !== 'string' || !body.trim() || body.length > 10000) return reply.code(400).send({ error: 'Invalid incident fields' })
      const incident = await prisma.statusIncident.create({ data: { title: title.trim(), status: status as IncidentStatus, impact, body: body.trim(), resolvedAt: status === 'resolved' ? new Date() : null, updates: { create: { status: status as IncidentStatus, body: body.trim() } } }, include: { updates: true } })
      return reply.code(201).send(incident)
    })

    admin.patch<{ Params: { id: string }; Body: { title?: string; status?: string; impact?: string; body?: string } }>('/admin/status/incidents/:id', async (request, reply) => {
      const id = Number(request.params.id)
      const { title, status, impact, body } = request.body
      if (!Number.isInteger(id) || (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 200)) || (status !== undefined && !allowed(status, incidentStatuses)) || (impact !== undefined && !allowed(impact, impacts)) || (body !== undefined && (typeof body !== 'string' || !body.trim() || body.length > 10000))) return reply.code(400).send({ error: 'Invalid incident fields' })
      const existing = await prisma.statusIncident.findUnique({ where: { id } })
      if (!existing) return reply.code(404).send({ error: 'Incident not found' })
      return prisma.$transaction(async tx => {
        const nextStatus = status as IncidentStatus | undefined
        const updateBody = body?.trim() || (nextStatus ? `Status changed to ${nextStatus}` : undefined)
        const updated = await tx.statusIncident.update({ where: { id }, data: { ...(title === undefined ? {} : { title: title.trim() }), ...(nextStatus === undefined ? {} : { status: nextStatus, resolvedAt: nextStatus === 'resolved' ? (existing.resolvedAt ?? new Date()) : null }), ...(impact === undefined ? {} : { impact }), ...(body === undefined ? {} : { body: body.trim() }) } })
        if (nextStatus || body) await tx.statusIncidentUpdate.create({ data: { incidentId: id, status: nextStatus ?? existing.status, body: updateBody! } })
        return tx.statusIncident.findUnique({ where: { id }, include: { updates: { orderBy: { createdAt: 'desc' } } } }).then(value => value ?? updated)
      })
    })

    admin.delete<{ Params: { id: string } }>('/admin/status/incidents/:id', async (request, reply) => {
      const id = Number(request.params.id)
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid incident id' })
      const result = await prisma.statusIncident.deleteMany({ where: { id } })
      if (!result.count) return reply.code(404).send({ error: 'Incident not found' })
      return { success: true }
    })

    admin.post<{ Body: Record<string, unknown> }>('/admin/status/maintenances', async (request, reply) => {
      const input = parseMaintenance(request.body)
      if (!input) return reply.code(400).send({ error: 'Invalid maintenance fields' })
      const created = await prisma.statusMaintenance.create({ data: { title: input.title as string, body: input.body as string, impact: input.impact as string | undefined, scheduledStart: input.scheduledStart!, scheduledEnd: input.scheduledEnd!, ...(input.update ? { updates: { create: { body: input.update as string } } } : {}) }, include: maintenanceInclude })
      return reply.code(201).send(created)
    })

    admin.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/admin/status/maintenances/:id', async (request, reply) => {
      const id = Number(request.params.id)
      const input = parseMaintenance(request.body, true)
      if (!Number.isInteger(id) || !input) return reply.code(400).send({ error: 'Invalid maintenance fields' })
      const existing = await prisma.statusMaintenance.findUnique({ where: { id } })
      if (!existing) return reply.code(404).send({ error: 'Maintenance not found' })
      if (existing.status === 'completed' || existing.status === 'cancelled') return reply.code(409).send({ error: 'Maintenance is already terminal' })
      const nextStart = input.scheduledStart ?? existing.scheduledStart
      const nextEnd = input.scheduledEnd ?? existing.scheduledEnd
      if (nextStart >= nextEnd) return reply.code(400).send({ error: 'Start time must be before end time' })
      if (input.status === 'cancelled') return reply.code(400).send({ error: 'Use the cancel endpoint' })
      return prisma.$transaction(async tx => {
        const updated = await tx.statusMaintenance.update({ where: { id }, data: { ...(input.title === undefined ? {} : { title: input.title as string }), ...(input.body === undefined ? {} : { body: input.body as string }), ...(input.impact === undefined ? {} : { impact: input.impact as string }), ...(input.scheduledStart === undefined ? {} : { scheduledStart: input.scheduledStart }), ...(input.scheduledEnd === undefined ? {} : { scheduledEnd: input.scheduledEnd }), ...(input.status === undefined ? {} : { status: input.status as MaintenanceStatus, startedAt: input.status === 'active' ? (existing.startedAt ?? new Date()) : existing.startedAt, completedAt: input.status === 'completed' ? new Date() : existing.completedAt }) } })
        if (input.update) await tx.statusMaintenanceUpdate.create({ data: { maintenanceId: id, body: input.update as string } })
        return tx.statusMaintenance.findUnique({ where: { id }, include: maintenanceInclude }).then(value => value ?? updated)
      })
    })

    admin.post<{ Params: { id: string }; Body: { body?: string } }>('/admin/status/maintenances/:id/updates', async (request, reply) => {
      const id = Number(request.params.id)
      const body = request.body.body
      if (!Number.isInteger(id) || typeof body !== 'string' || !body.trim() || body.length > 10000) return reply.code(400).send({ error: 'Invalid maintenance update' })
      const existing = await prisma.statusMaintenance.findFirst({ where: { id, status: { in: ['scheduled', 'active'] } }, select: { id: true } })
      if (!existing) return reply.code(404).send({ error: 'Active maintenance not found' })
      const update = await prisma.statusMaintenanceUpdate.create({ data: { maintenanceId: id, body: body.trim() } })
      return reply.code(201).send(update)
    })

    admin.delete<{ Params: { id: string } }>('/admin/status/maintenances/:id', async (request, reply) => {
      const id = Number(request.params.id)
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid maintenance id' })
      const result = await prisma.statusMaintenance.deleteMany({ where: { id } })
      if (!result.count) return reply.code(404).send({ error: 'Maintenance not found' })
      return { success: true }
    })

    admin.post<{ Params: { id: string } }>('/admin/status/maintenances/:id/cancel', async (request, reply) => {
      const id = Number(request.params.id)
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid maintenance id' })
      const result = await prisma.statusMaintenance.updateMany({ where: { id, status: { in: ['scheduled', 'active'] } }, data: { status: 'cancelled', cancelledAt: new Date() } })
      if (!result.count) return reply.code(404).send({ error: 'Scheduled or active maintenance not found' })
      return prisma.statusMaintenance.findUnique({ where: { id }, include: maintenanceInclude })
    })
  })
}
