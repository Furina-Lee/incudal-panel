import assert from 'node:assert/strict'
import { evaluateIncusCompatibility } from '../src/lib/incus/incus-compatibility.js'

const baseInfo = {
  api_version: '1.0',
  api_extensions: ['instances', 'operations'],
  environment: { server_version: '7.6.0' }
}

assert.equal(evaluateIncusCompatibility(baseInfo).status, 'compatible')
assert.equal(evaluateIncusCompatibility({ ...baseInfo, environment: { server_version: '7.5.1' } }).status, 'outdated')
assert.equal(evaluateIncusCompatibility({ ...baseInfo, environment: { server_version: '7.6.0-beta1' } }).status, 'outdated')
assert.equal(evaluateIncusCompatibility({ ...baseInfo, environment: undefined }).status, 'unknown')
console.log('Incus compatibility checks passed')
