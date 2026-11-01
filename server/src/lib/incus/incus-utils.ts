/**
 * Incus 客户端工具函数
 */

import { request } from 'undici'
import type { IncusClient } from './incus-client.js'
import type { IncusApiResponse, IncusOperation } from '../../types/incus.js'

/**
 * 等待异步操作完成
 * @param timeout 超时时间（毫秒），默认 120 秒
 */
export function normalizeOperationUrl(operationUrl: string): string {
  const parsed = new URL(operationUrl, 'http://incus')
  if (!parsed.pathname.startsWith('/1.0/operations/')) {
    throw new Error(`Invalid Incus operation URL: ${operationUrl}`)
  }
  return parsed.pathname
}

export async function waitForOperation(
  client: IncusClient,
  operationUrl: string,
  timeout: number = 300000
): Promise<unknown> {
  const startTime = Date.now()
  const path = normalizeOperationUrl(operationUrl)

  while (Date.now() - startTime < timeout) {
    const remainingSeconds = Math.max(1, Math.ceil((timeout - (Date.now() - startTime)) / 1000))
    const op = await client.request<IncusOperation>(
      'GET', `${path.replace(/\/$/, '')}/wait?timeout=${Math.min(10, remainingSeconds)}`, null,
      Math.min(120000, Math.max(1000, (remainingSeconds + 2) * 1000))
    )

    if (op.status === 'Success' || op.status_code === 200) {
      return op.metadata
    }

    if (op.status === 'Failure' || (typeof op.status_code === 'number' && op.status_code >= 400)) {
      throw new Error(op.err || op.error || 'Incus operation failed')
    }
    if (['Cancelled', 'Canceled'].includes(op.status || '')) {
      throw new Error(op.err || op.error || 'Incus operation was cancelled')
    }
  }

  throw new Error(`Incus operation timeout (${Math.ceil(timeout / 1000)} seconds)`)
}

/**
 * 等待异步操作完成（长超时）
 */
export async function waitForOperationLong(
  client: IncusClient,
  operationUrl: string,
  timeout: number = 600000
): Promise<unknown> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    // Wait up to 30 seconds per poll
    const waitTimeout = Math.min(30, Math.floor((timeout - (Date.now() - startTime)) / 1000))
    if (waitTimeout <= 0) break

    try {
      // Use the normalized /wait endpoint for long polling. Incus may return
      // either an absolute or relative operation URL.
      const operationPath = normalizeOperationUrl(operationUrl)
      const waitUrl = new URL(`${operationPath.replace(/\/$/, '')}/wait?timeout=${waitTimeout}`, `${client.baseUrl}/`).toString()

      const response = await request(waitUrl, {
        method: 'GET',
        dispatcher: client.agent!,
        headers: { 'Content-Type': 'application/json' },
        headersTimeout: Math.min(120000, Math.max(1000, (waitTimeout + 2) * 1000)),
        bodyTimeout: Math.min(120000, Math.max(1000, (waitTimeout + 2) * 1000))
      })

      const text = await response.body.text()

      let data: IncusApiResponse
      try {
        data = JSON.parse(text) as IncusApiResponse
      } catch {
        console.error(`[Incus] 解析响应失败: ${text.substring(0, 200)}`)
        throw new Error(`无效的响应: ${text.substring(0, 100)}`)
      }

      // Check operation status in metadata
      const opStatus = (data.metadata as IncusOperation)?.status || (data as unknown as { status?: string }).status
      const opStatusCode = (data.metadata as IncusOperation)?.status_code || (data as unknown as { status_code?: number }).status_code

      if (opStatus === 'Success' || opStatusCode === 200) {
        return data.metadata || data
      }

      if (opStatus === 'Failure' || (opStatusCode && opStatusCode >= 400)) {
        const errMsg = (data.metadata as IncusOperation)?.err ||
          (data as unknown as { error?: string }).error ||
          (data.metadata as IncusOperation)?.error ||
          '操作失败'
        console.error(`[Incus] 操作失败: ${errMsg}`)
        throw new Error(errMsg)
      }

      // Still running, continue polling

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      if (errorMessage.includes('操作失败') || errorMessage.includes('Failure')) {
        throw err
      }
      console.error(`[Incus] 轮询出错: ${errorMessage}`)
      // Brief pause before retry
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  throw new Error('Image download timeout (10 minutes)')
}

/**
 * 将 Incus 实例状态转换为系统状态
 * 注意：返回的状态必须与数据库 Instance.status 类型兼容
 * 有效状态: 'creating' | 'running' | 'stopped' | 'error' | 'deleted'
 */
export function mapInstanceStatus(incusStatus: string): string {
  const statusMap: Record<string, string> = {
    'Running': 'running',
    'Stopped': 'stopped',
    'Frozen': 'stopped',     // Frozen 映射为 stopped（对用户来说都是不可用状态）
    'Error': 'error',
    'Starting': 'creating',  // Starting 映射为 creating（启动中）
    'Stopping': 'running'    // Stopping 映射为 running（还未完全停止，等下次同步）
  }
  return statusMap[incusStatus] || 'unknown'
}

