'use strict'

// Exercise the production launcher and package manager in an isolated profile.
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { createServer } = require('node:net')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { join, dirname, resolve, sep } = require('node:path')
const { pathToFileURL } = require('node:url')
const appRequire = createRequire(process.argv[2])
const directory = mkdtempSync(join(process.env.TMPDIR, 'git-install-probe-'))
let ctx

function git(args, cwd = directory) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 15000 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${args[0]}: ${result.stderr}`)
  return result.stdout.trim()
}

async function main() {
  assert.equal(process.arch, 'arm64')
  console.log(JSON.stringify({ check: 'git-version', value: git(['--version']) }))
  const sshVersion = spawnSync('ssh', ['-V'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(sshVersion.status, 0, sshVersion.error?.message ?? sshVersion.stderr)
  assert.match(sshVersion.stderr, /^OpenSSH_/)
  const sshConfig = spawnSync('ssh', ['-G', '-F', '/dev/null', '-o', 'BatchMode=yes', 'synthetic.invalid'],
    { encoding: 'utf8', timeout: 5000 })
  assert.equal(sshConfig.status, 0, sshConfig.error?.message ?? sshConfig.stderr)
  assert.match(sshConfig.stdout, /^hostname synthetic\.invalid$/m)
  console.log(JSON.stringify({ check: 'ssh-configuration', pass: true }))
  // Require Git's actual SSH child to reach the transport, without external credentials.
  let clientBanner = ''
  const sockets = new Set()
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('data', data => {
      clientBanner += data.toString()
      socket.end('SSH-2.0-SyntheticProbe\r\n')
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  try {
    const child = spawn('git', ['ls-remote', `ssh://synthetic@127.0.0.1:${server.address().port}/synthetic.git`, 'HEAD'],
      { env: { ...process.env, GIT_SSH_COMMAND: 'ssh -F /dev/null -o BatchMode=yes -o ConnectTimeout=2' } })
    let errorOutput = ''
    child.stdout.resume()
    child.stderr.on('data', data => { errorOutput += data.toString() })
    const timer = setTimeout(() => child.kill('SIGTERM'), 5000)
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
      .finally(() => clearTimeout(timer))
    assert.equal(code, 128, errorOutput)
    assert.match(clientBanner, /^SSH-2\.0-OpenSSH_/)
    assert.doesNotMatch(errorOutput, /cannot run ssh|unable to fork|error while loading shared libraries/)
    console.log(JSON.stringify({ check: 'git-ssh-transport', pass: true }))
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  }
  const source = join(directory, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'synthetic-git-plugin', version: '1.0.0',
    dsh: { bundle: { patch: 'cordis.patch.yml' } }, engines: { dsh: '0.2.0-rc.2' } }))
  writeFileSync(join(source, 'cordis.patch.yml'), '[]\n')
  git(['init', '--quiet'], source)
  git(['add', '.'], source)
  git(['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '--quiet', '-m', 'fixture'], source)
  const repository = pathToFileURL(source).href
  assert.match(git(['ls-remote', repository, 'HEAD']), /^[a-f0-9]{40}\s+HEAD$/)
  console.log(JSON.stringify({ check: 'git-local-refs', pass: true }))
  const { Context } = await import(pathToFileURL(appRequire.resolve('@deepseek-ai/cordis')).href)
  const { initProfile } = await import(pathToFileURL(appRequire.resolve('@deepseek-ai/dsh-app-boot')).href)
  const { PluginManager } = await import(pathToFileURL(appRequire.resolve('@deepseek-ai/dsh-plugin-manager')).href)
  const profile = join(directory, 'profile')
  initProfile(profile, [])
  ctx = new Context()
  ctx.reflect.provide('profileContext', { dir: profile, name: 'synthetic', installAnchor: process.argv[2], startedBundles: [],
    packageManager: { command: process.execPath,
      args: ['--expose-internals', join(dirname(appRequire.resolve('pnpm')), 'bin/pnpm.mjs')],
      env: { ...process.env, CI: 'true' } } })
  ctx.reflect.provide('loader', { entries: () => [] })
  await ctx.plugin(PluginManager)
  const result = await ctx.pluginManager.installBundle(`git+${repository}`, { enabled: false, requestId: 'synthetic-git' })
  if (result.error || result.packageResult?.exitCode !== 0) throw new Error(JSON.stringify(result))
  assert.equal(result.bundle, 'synthetic-git-plugin')
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  assert.ok(manifest.dependencies['synthetic-git-plugin'])
  console.log(JSON.stringify({ check: 'official-plugin-install', pass: true, exitCode: result.packageResult.exitCode }))
  if (process.argv[3]) {
    const url = new URL(process.argv[3])
    assert.equal(url.protocol, 'https:')
    assert.match(git(['-c', 'credential.helper=', 'ls-remote', '--', url.href, 'HEAD']), /^[a-f0-9]{40}\s+HEAD$/)
    console.log(JSON.stringify({ check: 'git-https-refs', pass: true }))
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  if (ctx) await ctx.fiber.dispose()
  assert.ok(resolve(directory).startsWith(resolve(process.env.TMPDIR) + sep))
  rmSync(directory, { recursive: true, force: true })
})
