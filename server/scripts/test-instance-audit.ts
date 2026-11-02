import assert from 'node:assert/strict'
import { detectProxyProtocols } from '../src/lib/instance-audit.js'

const processRow = (command: string, args = command) => ({
  command,
  args,
  raw: `${command} ${args}`
})

const shadowsocks = detectProxyProtocols({
  processes: [processRow('ss-server', '--config /etc/shadowsocks.json')]
})
assert.equal(shadowsocks.length, 1)
assert.equal(shadowsocks[0].protocolCategory, 'shadowsocks')
assert.equal(shadowsocks[0].confidence, 'medium')

const trojanWithNetworkEvidence = detectProxyProtocols({
  processes: [processRow('trojan-go', '--config /etc/trojan/config.json')],
  connections: [{ protocol: 'tcp', process: 'trojan-go', raw: 'tcp LISTEN 0 128 0.0.0.0:443 users:((' }]
})
assert.equal(trojanWithNetworkEvidence[0].protocolCategory, 'trojan')
assert.equal(trojanWithNetworkEvidence[0].confidence, 'high')

const unrelated = detectProxyProtocols({
  processes: [processRow('nginx', '-c /etc/nginx/nginx.conf')],
  connections: [{ protocol: 'tcp', process: 'nginx', raw: 'tcp LISTEN 0 128 0.0.0.0:443 users:((' }]
})
assert.deepEqual(unrelated, [])

const portOnly = detectProxyProtocols({
  connections: [{ protocol: 'tcp', process: null, raw: 'tcp LISTEN 0 128 0.0.0.0:443' }]
})
assert.deepEqual(portOnly, [])

console.log('instance audit protocol detection tests passed')
