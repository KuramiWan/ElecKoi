'use strict'

const fs = require('node:fs')
const dns = require('node:dns')
const cp = require('node:child_process')
const path = require('node:path')
const https = require('node:https')
const node = process.argv[3]
const target = new URL(process.argv[4] ?? 'https://example.com/')
const record = value => console.log(JSON.stringify(value))

const child = cp.spawnSync(process.execPath, ['-p', 'process.version'], { encoding: 'utf8', timeout: 3000 })
record({ test: 'node-child', ok: child.status === 0 && child.stdout?.trim() === process.version,
  status: child.status, error: child.error?.code, stdout: child.stdout?.trim(), stderr: child.stderr?.trim() })
const shell = cp.spawnSync('/bin/sh', ['-c', 'printf synthetic-value'], { encoding: 'utf8', timeout: 3000 })
record({ test: 'android-shell', status: shell.status, error: shell.error?.code, stdout: shell.stdout?.trim() })
const bash = cp.spawnSync(path.join(path.dirname(node), 'bash'), ['-c', 'printf synthetic-value'],
  { encoding: 'utf8', timeout: 3000 })
record({ test: 'linux-bash', status: bash.status, error: bash.error?.code, stdout: bash.stdout?.trim() })
record({ test: 'resolver-file', portableResolverExists: fs.existsSync('/proc/self/fd/63/usr/glibc/etc/resolv.conf') })
const started = Date.now()
dns.lookup(target.hostname, (error, address, family) =>
  record({ test: 'dns', elapsedMs: Date.now() - started, error: error?.code, ok: !error, family }))
const request = https.get(target, { timeout: 6000 }, response => {
  record({ test: 'https', status: response.statusCode })
  response.resume()
})
request.on('timeout', () => request.destroy(new Error('HTTPS probe timed out')))
request.on('error', error => record({ test: 'https', error: error.code ?? error.message }))
