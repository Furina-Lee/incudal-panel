import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const installer = readFileSync(resolve(scriptDir, '../templates/install.sh'), 'utf8')
const dockerInstaller = readFileSync(resolve(scriptDir, '../../scripts/install-docker.sh'), 'utf8')
const hostRoutes = readFileSync(resolve(scriptDir, '../src/routes/hosts.ts'), 'utf8')

assert.ok(installer.includes('readonly INCUS_TARGET_VERSION="7.6.0"'))
assert.ok(installer.includes('require_arg_value "$1" "${2:-}"'))
assert.ok(installer.includes('validate_install_inputs()'))
assert.ok(installer.includes('[[ "$TOKEN" =~ ^[a-zA-Z0-9_-]{16,}$ ]]'))
assert.ok(installer.includes('10#$LISTEN_PORT >= 1 && 10#$LISTEN_PORT <= 65535'))
assert.ok(installer.includes('IPv6Network(sys.argv[1], strict=False)'))
assert.ok(installer.includes('[[ "$IPV6_IFACE" =~ ^[a-zA-Z0-9_.:-]{1,15}$ ]]'))
assert.ok(installer.includes('[[ ! -t 0 || ! -t 1 ]]'))
assert.ok(installer.includes('INSTALLER_OWNERSHIP_MARKER'))
assert.ok(installer.includes('[[ ! -f "$INSTALLER_OWNERSHIP_MARKER" ]]'))
assert.ok(installer.includes("printf 'ownership=incudal\\nscript_version=%s\\nincus_version=%s\\n'"))
assert.ok(installer.includes("grep -q '^ownership=incudal$'"))
assert.ok(installer.includes('backup_confirm') && installer.includes('!= "BACKUP"'))
assert.ok(installer.includes("curl --proto '=https' --tlsv1.2"))
assert.ok(dockerInstaller.includes('validate_external_database()'))
assert.ok(dockerInstaller.includes('psql'))
assert.ok(dockerInstaller.includes('DATABASE_URL='))
assert.ok(dockerInstaller.includes('prompt_external_database'))
assert.ok(!dockerInstaller.includes('postgres_data:/var/lib/postgresql/data'))
assert.ok(hostRoutes.includes("curl --proto '=https' --tlsv1.2 -fsSL ${shellDoubleQuote(scriptUrl)}"))

console.log('Installer static safety checks passed')
