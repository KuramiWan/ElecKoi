import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { UpdateService } from '../../src/main/modules/updates/UpdateService'
import { DesktopUpdateHttpExecutor } from '../../src/main/modules/updates/dsh/update-http-executor'

const root = process.env.ELECKOI_UPDATE_TEST_ROOT!
assert.ok(root)
app.setPath('userData', join(root, 'electron'))
const payload = Buffer.alloc(256 * 1024, 37)
const sha512 = createHash('sha512').update(payload).digest('base64')
let mode = 'healthy', fileRequests = 0, feedRequests = 0, serial = 0
const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/latest.yml')) {
    feedRequests++
    if (mode === 'feed-stall') return
    if (mode === 'feed-error') { response.writeHead(503).end(); return }
    if (mode === 'hold-check') await delay(100)
    response.end(`version: 1.0.1\nfiles:\n  - url: installer.exe\n    sha512: ${mode === 'corrupt' ? Buffer.alloc(64).toString('base64') : sha512}\n    size: ${payload.length}\npath: installer.exe\nsha512: ${sha512}\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`)
    return
  }
  if (request.url === '/installer.exe') {
    fileRequests++
    response.writeHead(200, { 'Content-Length': payload.length, 'Content-Type': 'application/octet-stream' })
    if (mode === 'disconnect') {
      response.write(payload.subarray(0, 16384))
      setImmediate(() => response.destroy())
      return
    }
    if (mode === 'file-stall') { response.write(payload.subarray(0, 16384)); return }
    if (mode === 'slow') {
      for (let offset = 0; offset < payload.length; offset += 4096) {
        if (response.destroyed) return
        response.write(payload.subarray(offset, offset + 4096))
        await delay(30)
      }
      response.end()
    } else response.end(payload)
    return
  }
  response.writeHead(404).end()
})

async function main() {
  await app.whenReady()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}`
  const cases: string[] = []
  async function fixture(initialMode: string) {
    mode = initialMode
    const directory = join(root, String(++serial))
    await mkdir(directory, { recursive: true })
    const config = join(directory, 'app-update.yml')
    await writeFile(config, 'updaterCacheDirName: cache\n')
    const forbidden = () => { throw new Error('Installer execution and application exit are forbidden in this fixture') }
    const updater = new electronUpdater.NsisUpdater(undefined, {
      version: '1.0.0', name: 'synthetic-update-test', isPackaged: true,
      appUpdateConfigPath: config, userDataPath: directory, baseCachePath: directory,
      whenReady: async () => {}, quit: forbidden, relaunch: forbidden, onQuit: forbidden
    })
    updater.logger = null
    Object.assign(updater, { httpExecutor: new DesktopUpdateHttpExecutor(1000) })
    updater.disableDifferentialDownload = true
    const states: ReturnType<UpdateService['status']>[] = []
    const installations: boolean[][] = []
    let authorized = true, released = 0
    updater.quitAndInstall = (...args) => { installations.push(args as boolean[]) }
    const service = new UpdateService({
      updater, currentVersion: '1.0.0', enabled: true, disabledMessage: '',
      prepareInstall: async () => authorized, releaseInstall: async () => { released++ },
      publish: state => states.push(state), logger: { info() {}, warn() {}, error() {} }
    })
    updater.setFeedURL({ provider: 'generic', url, channel: 'latest' })
    service.start()
    return { service, updater, states, installations, released: () => released,
      authorize: (value: boolean) => { authorized = value } }
  }
  async function scenario(name: string, run: () => Promise<void>) {
    await run()
    cases.push(name)
  }
  try {
    await scenario('concurrent checks and downloads, checksum, separate install and Host unlock', async () => {
      const f = await fixture('hold-check')
      try {
        const before = feedRequests
        const checks = await Promise.all([f.service.check(), f.service.check()])
        assert.ok(checks.every(state => state.phase === 'available'))
        assert.equal(feedRequests - before, 1)
        assert.equal(fileRequests, 0)
        const downloads = await Promise.all([f.service.download(), f.service.download()])
        assert.ok(downloads.every(state => state.phase === 'ready'))
        assert.equal(fileRequests, 1)
        assert.equal(f.installations.length, 0)
        f.authorize(false)
        assert.deepEqual(await f.service.install(), { accepted: false, reason: 'agent_running' })
        f.authorize(true)
        assert.equal((await f.service.install()).accepted, true)
        assert.equal(f.installations.length, 1)
        f.updater.emit('error', new Error('synthetic installation failure'))
        await delay(0)
        assert.equal(f.service.status().failedOperation, 'install')
        assert.equal(f.released(), 1)
        assert.equal((await f.service.install()).accepted, true)
        assert.equal(f.installations.length, 2)
        assert.equal(fileRequests, 1)
      } finally { f.service.dispose() }
    })
    for (const failure of ['disconnect', 'file-stall']) {
      await scenario(`${failure}: failure settles once, manual retry recovers`, async () => {
        const f = await fixture(failure)
        try {
          await f.service.check()
          const failed = await f.service.download()
          assert.equal(failed.phase, 'error')
          assert.equal(failed.failedOperation, 'download')
          assert.equal(f.states.filter(state => state.phase === 'error').length, 1)
          mode = 'healthy'
          assert.equal((await f.service.download()).phase, 'ready')
        } finally { f.service.dispose() }
      })
    }
    await scenario('incorrect checksum never becomes installable', async () => {
      const f = await fixture('corrupt')
      try {
        await f.service.check()
        const failed = await f.service.download()
        assert.equal(failed.phase, 'error')
        assert.match(failed.message!, /sha512 checksum mismatch/)
        assert.equal((await f.service.install()).accepted, false)
        assert.equal(f.installations.length, 0)
      } finally { f.service.dispose() }
    })
    await scenario('feed silence times out and manual check recovers', async () => {
      const f = await fixture('feed-stall')
      try {
        const failed = await f.service.check()
        assert.equal(failed.failedOperation, 'check')
        assert.match(failed.message!, /timed out/)
        mode = 'healthy'
        assert.equal((await f.service.check()).phase, 'available')
      } finally { f.service.dispose() }
    })
    await scenario('active transfer can exceed the inactivity deadline', async () => {
      const f = await fixture('slow')
      try {
        await f.service.check()
        const start = Date.now()
        assert.equal((await f.service.download()).phase, 'ready')
        assert.ok(Date.now() - start > 1000)
        assert.ok(f.states.some(state => state.phase === 'verifying'))
        assert.ok(!f.states.some(state => state.phase === 'error'))
      } finally { f.service.dispose() }
    })
    await writeFile(join(root, 'results.json'), JSON.stringify({ cases, fileRequests, feedRequests }))
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

void main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
