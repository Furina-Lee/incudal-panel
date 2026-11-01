/**
 * Prisma Client 单例
 * 用于数据库操作
 */

import 'dotenv/config'

import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const CURRENT_NETWORK_MODES = ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_only', 'ipv6_nat'] as const
const LEGACY_NETWORK_MODE_MAP: Record<string, (typeof CURRENT_NETWORK_MODES)[number]> = {
  nat: 'nat',
  nat_ipv6: 'nat_ipv6',
  ipv4: 'nat',
  ipv6: 'nat_ipv6',
  dual: 'nat_ipv6',
  ipv4_ipv6: 'nat_ipv6',
  nat_ipv6_nat: 'nat_ipv6_nat',
  ipv6_nat: 'ipv6_nat',
  ipv6_only: 'ipv6_only'
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 环境变量未设置')
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  min: parseInt(process.env.DB_POOL_MIN || '5', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '5000', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000', 10),
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || '30000', 10),
})

async function normalizeLegacyNetworkModes(dbPool: Pool): Promise<void> {
  const enumValuesResult = await dbPool.query<{ enumlabel: string }>(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'NetworkMode'
    ORDER BY e.enumsortorder
  `)

  if (enumValuesResult.rows.length === 0) return
  const initialEnumValues = enumValuesResult.rows.map(row => row.enumlabel)
  const dependentColumnsResult = await dbPool.query<{ table_schema: string; table_name: string; column_name: string }>(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE udt_schema = 'public' AND udt_name = 'NetworkMode'
    ORDER BY table_schema, table_name, ordinal_position
  `)
  if (dependentColumnsResult.rows.length === 0) return

  const quoteIdent = (value: string): string => `"${value.replace(/"/g, '""')}"`
  const legacyModeValues = Object.keys(LEGACY_NETWORK_MODE_MAP).filter(mode => !CURRENT_NETWORK_MODES.includes(mode as (typeof CURRENT_NETWORK_MODES)[number]))
  const legacyModesSql = legacyModeValues.map(mode => `'${mode}'`).join(', ')
  const hasPackagesNetworkModeColumn = dependentColumnsResult.rows.some(column => column.table_schema === 'public' && column.table_name === 'packages' && column.column_name === 'network_mode')
  const hasInstancesNetworkModeColumn = dependentColumnsResult.rows.some(column => column.table_schema === 'public' && column.table_name === 'instances' && column.column_name === 'network_mode')

  for (const mode of CURRENT_NETWORK_MODES) {
    if (!initialEnumValues.includes(mode)) await dbPool.query(`ALTER TYPE "NetworkMode" ADD VALUE IF NOT EXISTS '${mode}'`)
  }

  for (const column of dependentColumnsResult.rows) {
    const qualifiedColumn = `${quoteIdent(column.table_schema)}.${quoteIdent(column.table_name)}`
    const columnName = quoteIdent(column.column_name)
    await dbPool.query(`
      UPDATE ${qualifiedColumn}
      SET ${columnName} = CASE ${columnName}::text
        WHEN 'ipv4' THEN 'nat'::"NetworkMode"
        WHEN 'ipv6' THEN 'nat_ipv6'::"NetworkMode"
        WHEN 'dual' THEN 'nat_ipv6'::"NetworkMode"
        WHEN 'ipv4_ipv6' THEN 'nat_ipv6'::"NetworkMode"
        WHEN 'nat_ipv6_nat' THEN 'nat_ipv6_nat'::"NetworkMode"
        WHEN 'ipv6_nat' THEN 'ipv6_nat'::"NetworkMode"
        WHEN 'ipv6_only' THEN 'ipv6_only'::"NetworkMode"
        ELSE ${columnName}
      END
      WHERE ${columnName}::text IN (${legacyModesSql})
    `)
  }

  if (hasPackagesNetworkModeColumn) await dbPool.query(`ALTER TABLE "packages" ALTER COLUMN "network_mode" SET DEFAULT 'nat'`)
  if (hasInstancesNetworkModeColumn) await dbPool.query(`ALTER TABLE "instances" ALTER COLUMN "network_mode" SET DEFAULT 'nat'`)

  const modeSnapshots = await Promise.all(dependentColumnsResult.rows.map(async column => {
    const qualifiedColumn = `${quoteIdent(column.table_schema)}.${quoteIdent(column.table_name)}`
    const columnName = quoteIdent(column.column_name)
    const result = await dbPool.query<{ network_mode: string; count: string }>(`
      SELECT ${columnName}::text AS network_mode, COUNT(*)::text AS count
      FROM ${qualifiedColumn}
      GROUP BY ${columnName}::text
      ORDER BY ${columnName}::text
    `)
    return { table: `${column.table_schema}.${column.table_name}.${column.column_name}`, modes: result.rows.map(row => `${row.network_mode}(${row.count})`).join(', ') || 'none' }
  }))
  console.warn('[Prisma] Normalized legacy NetworkMode values', { enumValuesBefore: initialEnumValues, dependentColumns: modeSnapshots, mapping: LEGACY_NETWORK_MODE_MAP })
}

await normalizeLegacyNetworkModes(pool)
const adapter = new PrismaPg(pool)

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  adapter,
  log: process.env.PRISMA_LOG
    ? (process.env.PRISMA_LOG.split(',') as ('query' | 'error' | 'warn' | 'info')[])
    : ['error'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export function getDbPoolStats(): { totalCount: number; idleCount: number; waitingCount: number } {
  return { totalCount: pool.totalCount, idleCount: pool.idleCount, waitingCount: pool.waitingCount }
}

export default prisma
