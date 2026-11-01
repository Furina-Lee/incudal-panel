import assert from 'node:assert/strict'
import { getMaintenanceTransition } from '../src/lib/maintenance-lifecycle.js'

const start = new Date('2026-11-01T10:00:00.000Z')
const end = new Date('2026-11-01T11:00:00.000Z')
assert.equal(getMaintenanceTransition('scheduled', start, end, new Date('2026-11-01T09:59:59.000Z')), 'scheduled')
assert.equal(getMaintenanceTransition('scheduled', start, end, start), 'active')
assert.equal(getMaintenanceTransition('active', start, end, end), 'completed')
assert.equal(getMaintenanceTransition('cancelled', start, end, new Date('2026-11-01T12:00:00.000Z')), 'cancelled')
console.log('maintenance lifecycle transition tests passed')
