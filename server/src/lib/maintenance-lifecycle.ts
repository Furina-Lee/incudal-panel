export type MaintenanceLifecycleStatus = 'scheduled' | 'active' | 'completed' | 'cancelled'

export function getMaintenanceTransition(
  status: MaintenanceLifecycleStatus,
  start: Date,
  end: Date,
  now: Date
): MaintenanceLifecycleStatus {
  if (status === 'cancelled' || status === 'completed') return status
  if (now >= end) return 'completed'
  if (now >= start) return 'active'
  return 'scheduled'
}
