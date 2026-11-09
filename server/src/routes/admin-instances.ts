import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

type Source = 'official' | 'hosted'

function pageParams(query: { page?: string; pageSize?: string; search?: string; source?: string }) {
  const parsedPage = Number.parseInt(query.page || '1', 10)
  const parsedSize = Number.parseInt(query.pageSize || String(DEFAULT_PAGE_SIZE), 10)
  return {
    page: Number.isFinite(parsedPage) ? Math.max(1, Math.min(parsedPage, 100000)) : 1,
    pageSize: Number.isFinite(parsedSize) ? Math.max(1, Math.min(parsedSize, MAX_PAGE_SIZE)) : DEFAULT_PAGE_SIZE,
    search: (query.search || '').trim().slice(0, 100),
    source: query.source === 'official' || query.source === 'hosted' ? query.source as Source : undefined
  }
}

function sourceRole(source: Source | undefined): 'admin' | 'user' | undefined {
  return source === 'official' ? 'admin' : source === 'hosted' ? 'user' : undefined
}

function searchUser(search: string): Prisma.UserWhereInput | undefined {
  const numericId = /^\d+$/.test(search) ? Number(search) : undefined
  if (!search) return undefined
  return {
    OR: [
      ...(numericId !== undefined && Number.isSafeInteger(numericId) ? [{ id: numericId }] : []),
      { username: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } }
    ]
  }
}

function pagination(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export default async function adminInstancesRoutes(app: FastifyInstance): Promise<void> {
  const options = {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }

  app.get<{ Querystring: { page?: string; pageSize?: string; search?: string; source?: string } }>(
    '/api/admin/instances', options, async (request, reply) => {
      const { page, pageSize, search, source } = pageParams(request.query)
      const userSearch = searchUser(search)
      const where: Prisma.InstanceWhereInput = {
        status: { not: 'deleted' },
        ...(sourceRole(source) ? { host: { user: { role: sourceRole(source) } } } : {}),
        ...(search ? { OR: [
          { name: { contains: search, mode: 'insensitive' } },
          ...(userSearch ? [{ user: userSearch }] : []),
          { host: { name: { contains: search, mode: 'insensitive' } } },
          { package: { name: { contains: search, mode: 'insensitive' } } }
        ] } : {})
      }
      try {
        const [items, total] = await Promise.all([
          prisma.instance.findMany({
            where,
            select: {
              id: true, name: true, status: true, cpu: true, memory: true, disk: true,
              packagePlanId: true, billingPrice: true, billingCycle: true, expiresAt: true, createdAt: true,
              user: { select: { id: true, username: true } },
              host: { select: { id: true, name: true, user: { select: { id: true, username: true, role: true } } } },
              package: { select: { id: true, name: true, user: { select: { id: true, username: true, role: true } } } },
              packagePlan: { select: { id: true, name: true } }
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
          }),
          prisma.instance.count({ where })
        ])
        return {
          items: items.map(item => ({
            id: item.id, name: item.name, status: item.status,
            resources: { cpu: item.cpu, memory: item.memory, disk: item.disk },
            isPaid: item.packagePlanId !== null,
            billingPrice: item.billingPrice === null ? null : Number(item.billingPrice),
            billingCycle: item.billingCycle, expiresAt: item.expiresAt?.toISOString() ?? null,
            createdAt: item.createdAt.toISOString(),
            user: item.user,
            host: { id: item.host.id, name: item.host.name, owner: item.host.user, source: item.host.user.role === 'admin' ? 'official' : 'hosted' },
            package: item.package ? {
              id: item.package.id, name: item.package.name,
              owner: item.package.user,
              source: item.package.user.role === 'admin' ? 'official' : 'hosted'
            } : null,
            plan: item.packagePlan
          })),
          ...pagination(total, page, pageSize)
        }
      } catch (error) {
        request.log.error(error, 'Failed to list admin instances')
        return reply.code(500).send({ error: 'Failed to load instances' })
      }
    }
  )

  app.get<{ Querystring: { page?: string; pageSize?: string; search?: string; source?: string } }>(
    '/api/admin/instances/packages', options, async (request, reply) => {
      const { page, pageSize, search, source } = pageParams(request.query)
      const ownerSearch = searchUser(search)
      const where: Prisma.PackageWhereInput = {
        ...(sourceRole(source) ? { user: { role: sourceRole(source) } } : {}),
        ...(search ? { OR: [
          { name: { contains: search, mode: 'insensitive' } },
          ...(ownerSearch ? [{ user: ownerSearch }] : [])
        ] } : {})
      }
      try {
        const [items, total] = await Promise.all([
          prisma.package.findMany({
            where,
            select: {
              id: true, name: true, active: true, globalShared: true, cpuMax: true, memoryMax: true,
              diskMax: true, instanceType: true, createdAt: true,
              user: { select: { id: true, username: true, role: true } },
              _count: { select: { instances: { where: { status: { not: 'deleted' } } }, plans: true, packageHosts: true } }
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
          }),
          prisma.package.count({ where })
        ])
        return {
          items: items.map(item => ({
            id: item.id, name: item.name, active: item.active, globalShared: item.globalShared,
            resources: { cpu: item.cpuMax, memory: item.memoryMax, disk: item.diskMax },
            instanceType: item.instanceType, createdAt: item.createdAt.toISOString(),
            owner: { id: item.user.id, username: item.user.username },
            source: item.user.role === 'admin' ? 'official' : 'hosted', counts: item._count
          })),
          ...pagination(total, page, pageSize)
        }
      } catch (error) {
        request.log.error(error, 'Failed to list admin packages')
        return reply.code(500).send({ error: 'Failed to load packages' })
      }
    }
  )

  app.get<{ Querystring: { page?: string; pageSize?: string; search?: string; source?: string } }>(
    '/api/admin/instances/plans', options, async (request, reply) => {
      const { page, pageSize, search, source } = pageParams(request.query)
      const ownerSearch = searchUser(search)
      const where: Prisma.PackagePlanWhereInput = {
        ...(sourceRole(source) ? { package: { user: { role: sourceRole(source) } } } : {}),
        ...(search ? { OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { package: { name: { contains: search, mode: 'insensitive' } } },
          ...(ownerSearch ? [{ package: { user: ownerSearch } }] : [])
        ] } : {})
      }
      try {
        const [items, total] = await Promise.all([
          prisma.packagePlan.findMany({
            where,
            select: {
              id: true, name: true, price: true, billingCycle: true, isActive: true, isSoldOut: true,
              cpu: true, memory: true, disk: true, createdAt: true,
              package: { select: { id: true, name: true, user: { select: { id: true, username: true, role: true } } } },
              _count: { select: { instances: { where: { status: { not: 'deleted' } } } } }
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
          }),
          prisma.packagePlan.count({ where })
        ])
        return {
          items: items.map(item => ({
            id: item.id, name: item.name, price: Number(item.price), billingCycle: item.billingCycle,
            active: item.isActive, soldOut: item.isSoldOut,
            resources: { cpu: item.cpu, memory: item.memory, disk: item.disk },
            createdAt: item.createdAt.toISOString(),
            package: { id: item.package.id, name: item.package.name, owner: item.package.user,
              source: item.package.user.role === 'admin' ? 'official' : 'hosted' },
            purchasedInstances: item._count.instances
          })),
          ...pagination(total, page, pageSize)
        }
      } catch (error) {
        request.log.error(error, 'Failed to list admin plans')
        return reply.code(500).send({ error: 'Failed to load plans' })
      }
    }
  )

  app.get<{ Querystring: { page?: string; pageSize?: string; search?: string; source?: string } }>(
    '/api/admin/instances/purchasers', options, async (request, reply) => {
      const { page, pageSize, search, source } = pageParams(request.query)
      const ownerSearch = searchUser(search)
      const where: Prisma.InstanceWhereInput = {
        packagePlanId: { not: null },
        status: { not: 'deleted' },
        ...(sourceRole(source) ? { host: { user: { role: sourceRole(source) } } } : {}),
        ...(search && ownerSearch ? { user: ownerSearch } : {})
      }
      try {
        const sourceSql = source === 'official'
          ? Prisma.sql`AND h.user_id IN (SELECT id FROM users WHERE role = 'admin')`
          : source === 'hosted'
            ? Prisma.sql`AND h.user_id IN (SELECT id FROM users WHERE role = 'user')`
            : Prisma.empty
        const [userIds, totalRows] = await Promise.all([
          prisma.$queryRaw<Array<{ userId: number }>>(Prisma.sql`
            SELECT DISTINCT i.user_id AS "userId"
            FROM instances i
            JOIN hosts h ON h.id = i.host_id
            WHERE i.package_plan_id IS NOT NULL AND i.status <> 'deleted'
              ${sourceSql}
              ${search ? Prisma.sql`AND i.user_id IN (SELECT id FROM users WHERE ${/^\\d+$/.test(search) ? Prisma.sql`id = ${Number(search)} OR` : Prisma.sql`false OR`} username ILIKE ${`%${search}%`} OR email ILIKE ${`%${search}%`})` : Prisma.empty}
            ORDER BY i.user_id ASC
            LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
          `),
          prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
            SELECT COUNT(DISTINCT i.user_id)::int AS total
            FROM instances i
            JOIN hosts h ON h.id = i.host_id
            WHERE i.package_plan_id IS NOT NULL AND i.status <> 'deleted'
              ${sourceSql}
              ${search ? Prisma.sql`AND i.user_id IN (SELECT id FROM users WHERE ${/^\\d+$/.test(search) ? Prisma.sql`id = ${Number(search)} OR` : Prisma.sql`false OR`} username ILIKE ${`%${search}%`} OR email ILIKE ${`%${search}%`})` : Prisma.empty}
          `)
        ])
        const total = totalRows[0]?.total || 0
        const items = await prisma.user.findMany({
          where: { id: { in: userIds.map(item => item.userId) } },
          select: {
            id: true, username: true, status: true, createdAt: true,
            _count: { select: { instances: { where } } },
            instances: {
              where,
              select: { host: { select: { user: { select: { role: true } } } } },
              take: 1,
              orderBy: { createdAt: 'desc' }
            }
          },
          orderBy: { id: 'asc' }
        })
        return {
          items: items.map(user => ({
            id: user.id, username: user.username, status: user.status,
            paidInstanceCount: user._count.instances,
            source: user.instances[0]?.host.user.role === 'admin' ? 'official' : 'hosted',
            createdAt: user.createdAt.toISOString()
          })),
          ...pagination(total, page, pageSize)
        }
      } catch (error) {
        request.log.error(error, 'Failed to list admin purchasers')
        return reply.code(500).send({ error: 'Failed to load purchasers' })
      }
    }
  )
}
