'use strict'

// This bounded probe owns only synthetic files in the diagnostic directory.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const nodePayload = process.argv[3]
const cp = require('node:child_process')
const rootfs = path.resolve(path.dirname(nodePayload), '../..')
const runtimeRoot = path.resolve(rootfs, '../../..')
const probeRoot = path.join(runtimeRoot, 'tmp/glibc-probe')
const installed = createRequire(path.join(path.dirname(rootfs), 'app/bin/eleckoi-host.mjs'))
const record = value => console.log(JSON.stringify(value))
const bounded = async operation => {
  let timer
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Subprocess probe exceeded its bound')), 4500)
    })])
  } finally { clearTimeout(timer) }
}

async function main() {
  const { Context } = await import(installed.resolve('@deepseek-ai/cordis'))
  const { default: LocalSubprocessRuntime } = await import(installed.resolve('@deepseek-ai/dsh-subprocess-local'))
  const context = new Context()
  const fiber = context.plugin(LocalSubprocessRuntime)
  await new Promise(resolve => setImmediate(resolve))
  const runtime = context.subprocess
  const collect = { maxBytes: 4096 }
  const spec = { cwd: probeRoot, graceMs: 150, stdio: { stdin: 'ignore', stdout: collect, stderr: collect } }
  const tests = [
    ['atomic-file-publication', async () => {
      const library = installed('koffi').load(process.env.ELECKOI_GLIBC_EXEC_SHIM)
      const publish = library.func('const char *eleckoi_publish_file(const char *source, const char *destination)')
      const root = path.join(probeRoot, 'synthetic-publication')
      fs.mkdirSync(root, { recursive: true })
      const source = path.join(root, 'stage'), destination = path.join(root, 'committed')
      try {
        fs.writeFileSync(source, 'first')
        assert.equal(publish(source, destination), null)
        assert.equal(fs.existsSync(source), false)
        assert.equal(fs.readFileSync(destination, 'utf8'), 'first')
        fs.writeFileSync(source, 'second')
        assert.equal(publish(source, destination), 'EEXIST')
        assert.equal(fs.readFileSync(destination, 'utf8'), 'first')
        assert.equal(fs.readFileSync(source, 'utf8'), 'second')
        assert.equal(publish(source, path.join(root, 'missing/file')), 'ENOENT')
        assert.equal(fs.readFileSync(source, 'utf8'), 'second')
        assert.equal(publish(path.join(root, 'missing-source'), path.join(root, 'another')), 'ENOENT')
        assert.equal(fs.existsSync(path.join(root, 'another')), false)
      } finally { fs.rmSync(root, { recursive: true, force: true }) }
    }],
    ['session-persistence', async () => {
      const { Session, SessionId } = await import(installed.resolve('@deepseek-ai/dsh-session'))
      const { createUserMessage } = await import(installed.resolve('@deepseek-ai/dsh-llm'))
      const { default: JsonlSessionPersistence } = await import(installed.resolve('@deepseek-ai/dsh-session-persistence-jsonl'))
      const root = path.join(probeRoot, 'synthetic-persistence')
      const owned = new Context()
      const service = owned.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      await new Promise(resolve => setImmediate(resolve))
      const session = Session.create(SessionId(`synthetic-${require('node:crypto').randomUUID()}`))
      const event = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Synthetic input' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      let handle
      try {
        handle = await owned.sessionPersistence.create({ ...session.header, cwd: probeRoot })
        await handle.append([event]); await handle.flush(); await handle.close(); handle = undefined
        handle = await owned.sessionPersistence.open(session.id, 'read')
        assert.deepEqual((await handle.read()).events, [event])
        await handle.close(); handle = undefined
        assert.equal((await owned.sessionPersistence.list()).length, 1)
        await assert.rejects(owned.sessionPersistence.create({ ...session.header, cwd: probeRoot }))
        const next = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Synthetic next input' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
        handle = await owned.sessionPersistence.open(session.id, 'write')
        await handle.append([next]); await handle.flush(); await handle.close(); handle = undefined
        handle = await owned.sessionPersistence.open(session.id, 'read')
        assert.deepEqual((await handle.read()).events, [event, next])
        await handle.close(); handle = undefined
      } finally {
        if (handle) await handle.close()
        await service.dispose()
        fs.rmSync(root, { recursive: true, force: true })
      }
    }],
    ['node-empty-environment', async () => {
      const result = cp.spawnSync(process.execPath, ['-p', 'process.version'], { env: {}, encoding: 'utf8', timeout: 3000 })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout.trim(), process.version)
    }],
    ['scripts-and-errors', async () => {
      for (const [name, content] of [['shebang', '#!/usr/bin/env node\nconsole.log(process.argv[2])\n'],
        ['plain', 'printf "%s" "$1"\n']]) {
        const file = path.join(probeRoot, `synthetic-${name}`)
        fs.writeFileSync(file, content, { mode: 0o700 })
        try {
          const result = cp.spawnSync(file, ['synthetic space'], { encoding: 'utf8', timeout: 3000 })
          assert.equal(result.status, 0, result.stderr)
          assert.equal(result.stdout.trim(), 'synthetic space')
        } finally { fs.unlinkSync(file) }
      }
      const missing = cp.spawnSync(path.join(probeRoot, 'synthetic-missing'))
      assert.equal(missing.error.code, 'ENOENT')
      const loop = path.join(probeRoot, 'synthetic-recursive-script')
      fs.writeFileSync(loop, `#!${loop}\n`, { mode: 0o700 })
      try { assert.equal(cp.spawnSync(loop).error.code, 'ELOOP') } finally { fs.unlinkSync(loop) }
      const file = path.join(probeRoot, 'synthetic-denied')
      fs.writeFileSync(file, 'synthetic', { mode: 0o600 })
      try { assert.equal(cp.spawnSync(file).error.code, 'EACCES') } finally { fs.unlinkSync(file) }
      const canonical = fs.realpathSync(path.join(rootfs, 'usr/bin/bash'))
      const argv0 = cp.spawnSync(canonical, ['-c', 'printf "%s" "$0"'], { argv0: 'synthetic-argv0', encoding: 'utf8' })
      assert.equal(argv0.status, 0, argv0.stderr)
      assert.equal(argv0.stdout, 'synthetic-argv0')
    }],
    ['executable-access', async () => {
      const executable = path.join(rootfs, 'usr/bin/bash')
      assert.equal(await runtime.resolveExecutable(executable), executable)
    }],
    ['bash-output', async () => {
      const handle = runtime.spawn({ ...spec, argv: [path.join(rootfs, 'usr/bin/bash'), '-c', 'printf "%s" "$1"; printf error-output >&2; exit 17', '_', 'synthetic space'] })
      const result = await bounded(handle.done)
      assert.equal(result.exitCode, 17)
      assert.equal(handle.collected.stdout.readFrom(0).text, 'synthetic space')
      assert.equal(handle.collected.stderr.readFrom(0).text, 'error-output')
      assert.equal(await bounded(handle.waitForExit()), true)
    }],
    ['bash-filesystem', async () => {
      const target = path.join(probeRoot, 'synthetic-shell.txt')
      const handle = runtime.spawn({ ...spec, argv: [path.join(rootfs, 'usr/bin/bash'), '-c', 'printf "%s" "$1" > "$2"; /usr/bin/cat "$2"', '_', 'synthetic-data', target] })
      assert.equal((await bounded(handle.done)).exitCode, 0)
      assert.equal(handle.collected.stdout.readFrom(0).text, 'synthetic-data')
      assert.equal(fs.readFileSync(target, 'utf8'), 'synthetic-data')
      fs.unlinkSync(target)
      await bounded(handle.waitForExit())
    }],
    ['linux-node-control', async () => {
      const handle = runtime.spawn({ ...spec, stdio: { ...spec.stdio, control: 'pipe' },
        argv: [nodePayload, '-e', "require('fs').writeSync(7,'synthetic-control');console.log('synthetic-node')"] })
      let control = ''
      handle.control.on('data', chunk => { control += chunk })
      assert.equal((await bounded(handle.done)).exitCode, 0)
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(control, 'synthetic-control')
      assert.equal(handle.collected.stdout.readFrom(0).text.trim(), 'synthetic-node')
      handle.control.destroy()
      await bounded(handle.waitForExit())
    }],
    ['cancel-process-tree', async () => {
      const controller = new AbortController()
      const marker = path.join(probeRoot, 'synthetic-child.pid')
      const handle = runtime.spawn({ ...spec, signal: controller.signal,
        argv: [path.join(rootfs, 'usr/bin/bash'), '-c', 'sleep 30 & echo $! > "$1"; wait', '_', marker] })
      for (let attempt = 0; attempt < 80 && !fs.existsSync(marker); attempt++) await new Promise(resolve => setTimeout(resolve, 25))
      const pid = Number(fs.readFileSync(marker, 'utf8').trim())
      assert(Number.isSafeInteger(pid) && pid > 0)
      controller.abort()
      await bounded(handle.done)
      assert.equal(await bounded(handle.waitForExit()), true)
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
      fs.unlinkSync(marker)
    }],
    ['terminal', async () => {
      const terminal = await runtime.spawnTerminal({ cwd: probeRoot, argv: [path.join(rootfs, 'usr/bin/bash'), '-i'],
        rows: 24, cols: 80, terminalType: 'xterm-256color', shellActivity: true, graceMs: 150 })
      let output = ''
      terminal.output.on('data', chunk => { output += chunk })
      await terminal.resize(90, 30)
      await bounded((async () => {
        while ((await terminal.inspectActivity()).state !== 'idle') await new Promise(resolve => setTimeout(resolve, 25))
      })())
      assert((await terminal.inspectForeground()).processGroupId > 0)
      await terminal.write('sleep 30\n')
      await bounded((async () => {
        while ((await terminal.inspectActivity()).state !== 'busy') await new Promise(resolve => setTimeout(resolve, 25))
      })())
      assert(await terminal.signalForeground('SIGINT') > 0)
      await bounded((async () => {
        while ((await terminal.inspectActivity()).state !== 'idle') await new Promise(resolve => setTimeout(resolve, 25))
      })())
      await terminal.write('printf "synthetic-terminal\\n"; exit\n')
      assert.equal((await bounded(terminal.done)).exitCode, 0)
      assert.match(output, /synthetic-terminal/)
      await bounded(terminal.terminate())
    }]
  ]
  try {
    for (const [test, run] of tests) {
      const started = Date.now()
      try { await run(); record({ test, ok: true, elapsedMs: Date.now() - started }) }
      catch (error) { record({ test, ok: false, error: error.stack, elapsedMs: Date.now() - started }); process.exitCode = 1 }
    }
  } finally { await bounded(fiber.dispose()) }
}
main().catch(error => { record({ test: 'probe-failure', ok: false, error: error.stack }); process.exitCode = 1 })
