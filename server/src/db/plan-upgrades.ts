import type { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { calculatePlanChange } from './billing-operations.js'
import { generateOrderNo } from './recharge-records.js'
import { resolveInstanceTrafficLimitForHost } from '../lib/traffic-multiplier.js'
import { calculateInstanceTrafficStatus } from '../services/traffic-utils.js'

const ACTIVE_INSTANCE_STATUSES = ['running', 'stopped'] as const
const UPGRADE_KIND = 'plan_upgrade'

export type UpgradeTx = Prisma.TransactionClient

export function isPlanUpgradePaymentDetails(value: unknown): value is { kind: typeof UPGRADE_KIND; upgradeOrderNo: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const details = value as Record<string, unknown>
  return details.kind === UPGRADE_KIND && typeof details.upgradeOrderNo === 'string' && details.upgradeOrderNo.length > 0
}

function asMoney(value: number): number {
  return Number(Math.max(0, value).toFixed(2))
}

async function lockHost(tx: UpgradeTx, hostId: number): Promise<{ cpuAllowanceMax: number | null; memoryMax: number | null; storageSize: number | null; cpuUsed: number; memoryUsed: number; diskUsed: number } | null> {
  const rows = await tx.$queryRaw<Array<{ cpuAllowanceMax: number | null; memoryMax: number | null; storageSize: number | null; cpuUsed: number; memoryUsed: number; diskUsed: number }>>`
    SELECT cpu_allowance_max AS "cpuAllowanceMax", memory_max AS "memoryMax", storage_size AS "storageSize", cpu_used AS "cpuUsed", memory_used AS "memoryUsed", disk_used AS "diskUsed"
    FROM hosts WHERE id = ${hostId} FOR UPDATE
  `
  return rows[0] || null
}

async function countPlanInstances(tx: UpgradeTx, planId: number): Promise<number> {
  const result = await tx.instance.count({
    where: { packagePlanId: planId, status: { in: [...ACTIVE_INSTANCE_STATUSES] } }
  })
  return result
}

export async function getPlanUpgradePreview(userId: number, instanceId: number, targetPlanId: number) {
  const instance = await prisma.instance.findFirst({ where: { id: instanceId, userId } })
  if (!instance) throw new Error('实例不存在或无权操作')
  if (!instance.packagePlanId) throw new Error('免费实例不支持升级')
  const target = await prisma.packagePlan.findUnique({ where: { id: targetPlanId } })
  if (!target) throw new Error('方案不存在')
  if (target.packageId !== instance.packageId) throw new Error('只能升级同一套餐下的方案')
  if (!target.isActive || target.isSoldOut) throw new Error('目标方案不可用')
  if (!ACTIVE_INSTANCE_STATUSES.includes(instance.status as typeof ACTIVE_INSTANCE_STATUSES[number])) throw new Error('当前实例状态不允许升级')
  const quote = await calculatePlanChange(instance, target)
  if (!quote.isUpgrade) throw new Error('不支持降级，只能升级到更高配置的方案')
  const used = await countPlanInstances(prisma as unknown as UpgradeTx, target.id)
  const remaining = target.maxInstances === null ? null : Math.max(0, target.maxInstances - used - target.reservedInstances)
  const host = await prisma.host.findUnique({ where: { id: instance.hostId }, select: { cpuAllowanceMax: true, memoryMax: true, storageSize: true, cpuUsed: true, memoryUsed: true, diskUsed: true } })
  const cpuDelta = target.cpu - instance.cpu
  const memoryDelta = target.memory - instance.memory
  const diskDelta = target.disk - instance.disk
  const capacity = {
    available: (remaining === null || remaining > 0) && !!host && (cpuDelta <= 0 || (host.cpuAllowanceMax ?? 0) - host.cpuUsed >= cpuDelta) && (memoryDelta <= 0 || (host.memoryMax ?? 0) - host.memoryUsed >= memoryDelta) && (diskDelta <= 0 || (host.storageSize ?? 0) * 1024 - host.diskUsed >= diskDelta),
    cpuAvailable: host ? (host.cpuAllowanceMax ?? 0) - host.cpuUsed : 0,
    memoryAvailable: host ? (host.memoryMax ?? 0) - host.memoryUsed : 0,
    diskAvailable: host ? (host.storageSize ?? 0) * 1024 - host.diskUsed : 0
  }
  return { ...quote, credit: quote.remainingValue, payable: asMoney(quote.priceDiff), capacity, maxInstances: target.maxInstances, usedInstances: used, reservedInstances: target.reservedInstances }
}

export async function createPlanUpgradeOrder(input: {
  userId: number
  instanceId: number
  targetPlanId: number
  providerId: number
  orderNo?: string
  paymentMethod?: string | null
  amount: number
  actualAmount: number
  fee: number
  expiredAt: Date
  providerConfigSnapshot: string | null
  paymentDetails: Record<string, unknown>
  ip?: string
  userAgent?: string
}) {
  return prisma.$transaction(async tx => {
    const instance = await tx.instance.findFirst({ where: { id: input.instanceId, userId: input.userId } })
    if (!instance || !instance.packagePlanId) throw new Error('实例不存在或不支持升级')
    if (!ACTIVE_INSTANCE_STATUSES.includes(instance.status as typeof ACTIVE_INSTANCE_STATUSES[number])) throw new Error('当前实例状态不允许升级')
    const target = await tx.packagePlan.findUnique({ where: { id: input.targetPlanId } })
    if (!target || target.packageId !== instance.packageId || !target.isActive || target.isSoldOut) throw new Error('目标方案不可用')
    const quote = await calculatePlanChange(instance, target)
    if (!quote.isUpgrade) throw new Error('不支持降级，只能升级到更高配置的方案')
    if (Math.abs(quote.priceDiff - input.amount) > 0.01) throw new Error('升级报价已变化，请刷新后重试')
    const existing = await tx.instancePlanUpgradeOrder.findFirst({ where: { instanceId: input.instanceId, status: 'pending', expiresAt: { gt: new Date() } } })
    if (existing) throw new Error('该实例已有待支付升级订单')
    const targetLocked = (await tx.$queryRaw<Array<{ id: number; reserved_instances: number; max_instances: number | null }>>`SELECT id, reserved_instances, max_instances FROM package_plans WHERE id = ${target.id} FOR UPDATE`)[0]
    const used = await countPlanInstances(tx, target.id)
    if (targetLocked && targetLocked.max_instances !== null && used + targetLocked.reserved_instances >= targetLocked.max_instances) throw new Error('目标方案名额不足')
    const cpuDelta = target.cpu - instance.cpu
    const memoryDelta = target.memory - instance.memory
    const diskDelta = target.disk - instance.disk
    const host = await lockHost(tx, instance.hostId)
    if (!host) throw new Error('宿主机不存在')
    const resourceSum = await tx.instance.aggregate({ where: { hostId: instance.hostId, status: { not: 'deleted' } }, _sum: { cpu: true, memory: true, disk: true } })
    const cpuUsed = Math.max(resourceSum._sum.cpu ?? 0, host.cpuUsed)
    const memoryUsed = Math.max(resourceSum._sum.memory ?? 0, host.memoryUsed)
    const diskUsed = Math.max(resourceSum._sum.disk ?? 0, host.diskUsed)
    if (cpuDelta > 0 && cpuUsed + cpuDelta > (host.cpuAllowanceMax ?? 0)) throw new Error('宿主机 CPU 配额不足')
    if (memoryDelta > 0 && memoryUsed + memoryDelta > (host.memoryMax ?? 0)) throw new Error('宿主机内存配额不足')
    if (diskDelta > 0 && diskUsed + diskDelta > (host.storageSize ?? 0) * 1024) throw new Error('宿主机存储配额不足')
    await tx.packagePlan.update({ where: { id: target.id }, data: { reservedInstances: { increment: 1 } } })
    await tx.host.update({ where: { id: instance.hostId }, data: { cpuUsed: cpuUsed + Math.max(0, cpuDelta), memoryUsed: memoryUsed + Math.max(0, memoryDelta), diskUsed: diskUsed + Math.max(0, diskDelta) } })
    const orderNo = input.orderNo || generateOrderNo()
    const recharge = await tx.rechargeRecord.create({ data: { userId: input.userId, providerId: input.providerId, orderNo, amount: input.amount, actualAmount: input.actualAmount, fee: input.fee, paymentMethod: input.paymentMethod, status: 'pending', expiredAt: input.expiredAt, providerConfigSnapshot: input.providerConfigSnapshot, paymentDetails: input.paymentDetails as Prisma.InputJsonValue, ip: input.ip, userAgent: input.userAgent } })
    await tx.instancePlanUpgradeOrder.create({ data: { orderNo, userId: input.userId, instanceId: input.instanceId, sourcePlanId: instance.packagePlanId, targetPlanId: target.id, sourceInstanceVersion: instance.version, amount: input.amount, cpuDelta: Math.max(0, cpuDelta), memoryDelta: Math.max(0, memoryDelta), diskDelta: Math.max(0, diskDelta), expiresAt: input.expiredAt, rechargeRecordId: recharge.id } })
    return { orderNo, expiredAt: input.expiredAt }
  }, { isolationLevel: 'Serializable' })
}

export async function releasePlanUpgradeReservation(orderNo: string, reason: string, tx: UpgradeTx | typeof prisma = prisma): Promise<void> {
  const order = await tx.instancePlanUpgradeOrder.findUnique({ where: { orderNo } })
  if (!order || order.reservationStatus !== 'reserved') return
  await tx.instancePlanUpgradeOrder.update({ where: { orderNo }, data: { status: order.status === 'pending' ? 'cancelled' : order.status, reservationStatus: 'released', reservationReleasedAt: new Date(), failureReason: reason } })
  await tx.packagePlan.update({ where: { id: order.targetPlanId }, data: { reservedInstances: { decrement: 1 } } })
  await tx.host.update({ where: { id: (await tx.instance.findUniqueOrThrow({ where: { id: order.instanceId }, select: { hostId: true } })).hostId }, data: { cpuUsed: { decrement: order.cpuDelta }, memoryUsed: { decrement: order.memoryDelta }, diskUsed: { decrement: order.diskDelta } } })
}

export async function fulfillPlanUpgrade(orderNo: string, tx: UpgradeTx): Promise<{
  instanceId: number
  hostId: number
  incusId: string
  cpu: number
  memory: number
  disk: number
  instanceType: string
  oldPlanId: number
  newPlanId: number
}> {
  const order = await tx.instancePlanUpgradeOrder.findUnique({ where: { orderNo } })
  if (!order) throw new Error('升级订单不存在')
  if (order.status === 'fulfilled') return { instanceId: order.instanceId, hostId: 0, incusId: '', cpu: 0, memory: 0, disk: 0, instanceType: 'container', oldPlanId: order.sourcePlanId, newPlanId: order.targetPlanId }
  if (order.reservationStatus !== 'reserved') throw new Error('升级订单预留已释放')
  if (order.expiresAt <= new Date()) throw new Error('升级订单已过期')
  const instance = await tx.instance.findUnique({ where: { id: order.instanceId }, include: { package: { select: { instanceType: true } } } })
  const target = await tx.packagePlan.findUnique({ where: { id: order.targetPlanId } })
  if (!instance || !target || instance.version !== order.sourceInstanceVersion || instance.packagePlanId !== order.sourcePlanId) throw new Error('实例状态已变化，请人工处理')
  const monthlyTrafficLimit = await resolveInstanceTrafficLimitForHost(tx as any, { packageId: instance.packageId, hostId: instance.hostId, baseTrafficLimit: target.trafficLimit })
  await tx.instance.update({ where: { id: instance.id }, data: { packagePlanId: target.id, cpu: target.cpu, memory: target.memory, disk: target.disk, billingPrice: Number(target.price) / 100, billingCycle: target.billingCycle, portLimit: target.portLimit, snapshotLimit: target.snapshotLimit, backupLimit: target.backupLimit, siteLimit: target.siteLimit, swapSize: target.swapSize, monthlyTrafficLimit, trafficStatus: calculateInstanceTrafficStatus(instance.monthlyTrafficUsed, monthlyTrafficLimit), version: { increment: 1 }, lastPlanChangeAt: new Date() } })
  await tx.instanceBillingRecord.create({ data: { instanceId: instance.id, userId: order.userId, type: 'upgrade', amount: order.amount, months: 0, periodStart: new Date(), periodEnd: instance.expiresAt || new Date(), remark: `套餐升级 ${order.sourcePlanId} → ${order.targetPlanId}` } })
  await tx.instancePlanUpgradeOrder.update({ where: { orderNo }, data: { status: 'fulfilled', reservationStatus: 'consumed', fulfilledAt: new Date(), reservationReleasedAt: new Date() } })
  await tx.packagePlan.update({ where: { id: target.id }, data: { reservedInstances: { decrement: 1 } } })
  const releaseCpu = target.cpu < instance.cpu ? instance.cpu - target.cpu : 0
  const releaseMemory = target.memory < instance.memory ? instance.memory - target.memory : 0
  const releaseDisk = target.disk < instance.disk ? instance.disk - target.disk : 0
  if (releaseCpu || releaseMemory || releaseDisk) {
    await tx.host.update({ where: { id: instance.hostId }, data: { cpuUsed: { decrement: releaseCpu }, memoryUsed: { decrement: releaseMemory }, diskUsed: { decrement: releaseDisk } } })
  }
  return { instanceId: instance.id, hostId: instance.hostId, incusId: instance.incusId, cpu: target.cpu, memory: target.memory, disk: target.disk, instanceType: instance.package?.instanceType || 'container', oldPlanId: order.sourcePlanId, newPlanId: order.targetPlanId }
}
