import assert from 'node:assert/strict'
import { analyzeAuditData, detectProxyProtocols, extractEndpointPort, parseConnections } from '../src/lib/instance-audit.js'

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
  connections: [{ protocol: 'tcp', state: 'LISTEN', local: '0.0.0.0:443', peer: '*:*', localPort: 443, peerPort: null, pid: 42, process: 'trojan-go', raw: 'tcp LISTEN 0 128 0.0.0.0:443 users:((' }]
})
assert.equal(trojanWithNetworkEvidence[0].protocolCategory, 'trojan')
assert.equal(trojanWithNetworkEvidence[0].confidence, 'high')

assert.equal(extractEndpointPort('0.0.0.0:443'), 443)
assert.equal(extractEndpointPort('[::]:8443'), 8443)
assert.equal(extractEndpointPort('*:*'), null)
assert.equal(extractEndpointPort('127.0.0.1:http'), null)

const netstatRows = parseConnections('tcp 0 0 0.0.0.0:1080 0.0.0.0:* LISTEN 123/ss-server')
assert.equal(netstatRows[0].state, 'LISTEN')
assert.equal(netstatRows[0].localPort, 1080)
assert.equal(netstatRows[0].pid, 123)

const expandedProtocols = detectProxyProtocols({
  processes: [
    processRow('xray', 'protocol: vless'),
    processRow('vmess-server', 'protocol: vmess'),
    processRow('anytls-server'),
    processRow('hysteria2-server'),
    processRow('tuic-server')
  ]
})
assert.deepEqual(expandedProtocols.map(item => item.protocolCategory).sort(), ['anytls', 'hy2', 'tuic', 'vless', 'vmess'])

const unrelated = detectProxyProtocols({
  processes: [processRow('nginx', '-c /etc/nginx/nginx.conf')],
  connections: [{ protocol: 'tcp', state: 'LISTEN', local: '0.0.0.0:443', peer: '*:*', localPort: 443, peerPort: null, pid: 43, process: 'nginx', raw: 'tcp LISTEN 0 128 0.0.0.0:443 users:((' }]
})
assert.deepEqual(unrelated, [])

const portOnly = detectProxyProtocols({
  connections: [{ protocol: 'tcp', state: 'LISTEN', local: '0.0.0.0:443', peer: '*:*', localPort: 443, peerPort: null, pid: null, process: null, raw: 'tcp LISTEN 0 128 0.0.0.0:443' }]
})
assert.deepEqual(portOnly, [])

const ordinaryProcess = {
  pid: 42,
  ppid: 1,
  user: 'root',
  stat: 'S',
  cpuPercent: 1,
  memoryPercent: 1,
  elapsed: '00:01',
  command: 'curl',
  args: 'https://example.test',
  raw: '42 root curl https://example.test',
  findings: [] as string[]
}
const ordinaryRule = {
  id: 'test-rule',
  severity: 'medium' as const,
  category: 'test',
  name: '测试普通规则',
  targetTypes: ['process' as const],
  matchType: 'contains' as const,
  patternText: 'curl',
  caseSensitive: false,
  source: 'custom' as const,
  enabled: true,
  recommendation: null
}
const enabledAnalysis = analyzeAuditData({
  processes: [
    {
      ...ordinaryProcess,
      command: 'ss-server',
      args: '--config /etc/shadowsocks.json',
      raw: '42 root ss-server --config /etc/shadowsocks.json'
    }
  ],
  connections: [],
  startupItems: [],
  rules: [ordinaryRule]
})
assert.equal(enabledAnalysis.findings.some(finding => finding.category === 'proxy-protocol'), true)

const disabledAnalysis = analyzeAuditData({
  processes: [ordinaryProcess],
  connections: [],
  startupItems: [],
  rules: [ordinaryRule],
  protocolDetectionEnabled: false
})
assert.equal(disabledAnalysis.findings.some(finding => finding.category === 'proxy-protocol'), false)
assert.equal(disabledAnalysis.findings.some(finding => finding.ruleId === 'test-rule'), true)
assert.equal(disabledAnalysis.summary.findingCount, 1)

console.log('instance audit protocol detection tests passed')
