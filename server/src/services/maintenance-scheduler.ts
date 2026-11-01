import { schedule } from 'node-cron'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'

let running = false

export async function runMaintenanceLifecycle(now = new Date()): Promise<void> {
  if (running) return
  running = true
  try {
    const starts = await prisma.statusMaintenance.findMany({ where: { status: 'scheduled', scheduledStart: { lte: now }, scheduledEnd: { gt: now } } })
    for (const maintenance of starts) {
      const changed = await prisma.statusMaintenance.updateMany({ where: { id: maintenance.id, status: 'scheduled' }, data: { status: 'active', startedAt: now } })
      if (changed.count) console.info(`[Maintenance] Window ${maintenance.id} started`)
    }

    // A missed window is completed; the recovery path below still sends its
    // completion notice exactly once through the delivery uniqueness key.
    const missed = await prisma.statusMaintenance.updateMany({ where: { status: 'scheduled', scheduledEnd: { lte: now } }, data: { status: 'completed', completedAt: now } })
    if (missed.count) console.info(`[Maintenance] Completed ${missed.count} expired scheduled window(s)`)

    const active = await prisma.statusMaintenance.findMany({ where: { status: 'active' } })
    for (const maintenance of active) {
      await deliverMaintenanceNotice(maintenance.id, 'started', maintenance.title, maintenance.body, maintenance.scheduledStart, maintenance.scheduledEnd)
      if (maintenance.scheduledEnd <= now) {
        const changed = await prisma.statusMaintenance.updateMany({ where: { id: maintenance.id, status: 'active' }, data: { status: 'completed', completedAt: now } })
        if (changed.count) console.info(`[Maintenance] Window ${maintenance.id} completed`)
      }
    }

    // Revisit recently completed windows after crashes so failed inbox writes
    // can retry; per-user delivery rows prevent duplicate messages.
    const completed = await prisma.statusMaintenance.findMany({
      where: { status: 'completed', completedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } }
    })
    for (const maintenance of completed) {
      await deliverMaintenanceNotice(maintenance.id, 'completed', maintenance.title, maintenance.body, maintenance.scheduledStart, maintenance.scheduledEnd)
    }
  } catch (error) {
    console.error('[Maintenance] Lifecycle job failed:', error)
  } finally {
    running = false
  }
}

async function deliverMaintenanceNotice(id: number, eventKey: string, title: string, body: string, start: Date, end: Date): Promise<void> {
  const users = await prisma.user.findMany({ where: { status: 'active' }, select: { id: true } })
  for (const user of users) {
    try {
      await prisma.$transaction(async tx => {
        await tx.statusMaintenanceDelivery.create({ data: { maintenanceId: id, eventKey, userId: user.id } })
        await tx.inboxMessage.create({
          data: {
            userId: user.id,
            eventType: `maintenance_${eventKey}`,
            title: eventKey === 'started' ? `Maintenance started: ${title}` : `Maintenance completed: ${title}`,
            content: `${body}\n\n${start.toISOString()} - ${end.toISOString()}`,
            data: { maintenanceId: id, status: eventKey }
          }
        })
      })
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        console.error(`[Maintenance] Could not deliver ${eventKey} notice for window ${id} to user ${user.id}:`, error)
      }
    }
  }
}

export function startMaintenanceScheduler(): void {
  schedule('* * * * *', () => { void runMaintenanceLifecycle() })
  void runMaintenanceLifecycle()
  console.log('[Maintenance] Scheduler started (one-minute interval)')
}
