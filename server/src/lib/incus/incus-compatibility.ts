import type { IncusServerInfo } from '../../types/incus.js'

export const INCUS_COMPATIBILITY_TARGET = '7.6.0'
export const INCUS_COMPATIBILITY_TARGET_LABEL = `Incus ${INCUS_COMPATIBILITY_TARGET}`

export type IncusCompatibilityStatus = 'compatible' | 'outdated' | 'unknown'

export interface IncusCompatibilityResult {
  status: IncusCompatibilityStatus
  target: string
  serverVersion: string | null
  apiVersion: string | null
  apiExtensions: string[]
  message: string
}

function parseVersion(value: string | undefined): [number, number, number] | null {
  if (!value) return null
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)]
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

export function evaluateIncusCompatibility(info: Pick<IncusServerInfo, 'api_version' | 'api_extensions' | 'environment'>): IncusCompatibilityResult {
  const serverVersion = info.environment?.server_version || null
  const apiVersion = info.api_version || null
  const apiExtensions = Array.isArray(info.api_extensions) ? [...info.api_extensions] : []
  const parsedServerVersion = parseVersion(serverVersion || undefined)
  const targetVersion = parseVersion(INCUS_COMPATIBILITY_TARGET)

  if (!apiVersion || !parsedServerVersion || !targetVersion) {
    return {
      status: 'unknown',
      target: INCUS_COMPATIBILITY_TARGET,
      serverVersion,
      apiVersion,
      apiExtensions,
      message: 'Incus version metadata is incomplete; verify the host in staging before provisioning.'
    }
  }

  const isPrereleaseOfTarget = compareVersions(parsedServerVersion, targetVersion) === 0 && /-(?:alpha|beta|rc|pre)/i.test(serverVersion || '')
  if (compareVersions(parsedServerVersion, targetVersion) < 0 || isPrereleaseOfTarget) {
    return {
      status: 'outdated',
      target: INCUS_COMPATIBILITY_TARGET,
      serverVersion,
      apiVersion,
      apiExtensions,
      message: `This host runs Incus ${serverVersion}; the tested target is ${INCUS_COMPATIBILITY_TARGET_LABEL}.`
    }
  }

  return {
    status: 'compatible',
    target: INCUS_COMPATIBILITY_TARGET,
    serverVersion,
    apiVersion,
    apiExtensions,
    message: `Incus ${serverVersion} is at or above the tested target ${INCUS_COMPATIBILITY_TARGET_LABEL}.`
  }
}
