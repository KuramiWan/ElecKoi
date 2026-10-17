const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { writeFileSync } = require('node:fs')
const { dirname, resolve } = require('node:path')
const Module = require('node:module')
const { buildSync } = Module.createRequire(require.resolve('vite'))('esbuild')

// Exercise the production service, preload and built client. Only the network
// and executable installation boundary are synthetic; no installer is launched.
exports.createUpdateProbe = ({ ipcMain, getWindow }) => {
  const entry = resolve('apps/desktop/src/main/modules/updates/UpdateService.ts')
  const bundled = buildSync({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
  const serviceModule = new Module(entry, module)
  serviceModule.paths = Module._nodeModulePaths(dirname(entry))
  serviceModule._compile(bundled.outputFiles[0].text, entry)
  const { UpdateService } = serviceModule.exports
  const info = { version: '0.2.13', releaseName: 'ElecKoi v0.2.13', releaseNotes: '合成更新说明\n完整客户端更新交互检查。', releaseDate: '2026-10-17T00:00:00.000Z', files: [{ url: 'synthetic.exe', sha512: 'synthetic', size: 100 }] }
  const updater = new EventEmitter()
  let checks = 0, downloads = 0, installs = 0, completeDownload
  updater.checkForUpdates = async () => {
    checks += 1
    updater.emit('update-available', info)
    return { updateInfo: info, isUpdateAvailable: true }
  }
  updater.downloadUpdate = () => {
    downloads += 1
    return new Promise(resolveDownload => { completeDownload = () => {
      updater.emit('update-downloaded', { ...info, downloadedFile: 'synthetic.exe' })
      resolveDownload([])
    } })
  }
  updater.quitAndInstall = () => { installs += 1 }
  const publish = status => getWindow()?.webContents.send('dsh-desktop:updates-changed', status)
  const service = new UpdateService({ updater, currentVersion: '0.2.12', enabled: true, disabledMessage: '',
    prepareInstall: async () => true, releaseInstall: async () => {}, publish,
    logger: { info() {}, warn() {}, error() {} } })
  const channels = ['status', 'check', 'download', 'install']
  for (const method of channels) ipcMain.handle(`dsh-desktop:updates-${method}`, () => service[method]())
  service.start()
  return {
    dispose() {
      service.dispose()
      for (const method of channels) ipcMain.removeHandler(`dsh-desktop:updates-${method}`)
    },
    async run({ window, waitFor, errors }) {
      const execute = source => window.webContents.executeJavaScript(source)
      const click = selector => execute(`document.querySelector(${JSON.stringify(selector)}).click()`)
      const dialog = `document.querySelector('[role="dialog"].app-update-dialog')`
      const close = async () => {
        await execute(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}))`)
        await waitFor(`!${dialog}`, 'Update dialog did not close')
      }
      await click('.rail-settings-trigger')
      await waitFor(`document.querySelector('.app-settings-sidebar')`, 'Settings navigation did not render')
      await execute(`Array.from(document.querySelectorAll('.app-settings-sidebar button')).find(button=>button.textContent==='关于 ElecKoi').click()`)
      await waitFor(`document.querySelector('.about-update-button')`, 'About did not render')
      await click('.about-update-button')
      await waitFor(dialog, 'First update discovery did not open its dialog')
      await close()
      await execute(`document.querySelector('.about-update-button').click()`)
      await waitFor(dialog, 'Detected update could not be reopened from About')
      assert.equal(checks, 1, 'Viewing a known update repeated the network check')
      await close()
      publish(service.status())
      await execute('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      assert.equal(await execute(`Boolean(${dialog})`), false, 'Background status reopened a dismissed dialog')
      await click('.about-update-button')
      await click('.app-update-dialog .is-primary')
      await waitFor(`document.querySelector('.app-update-dialog [role="progressbar"]')`, 'Download progress did not open')
      updater.emit('download-progress', { percent: 46, transferred: 46, total: 100, bytesPerSecond: 10 })
      await close()
      await click('.about-update-button')
      await waitFor(`${dialog}?.querySelector('[aria-valuenow="46"]')`, 'Hidden download did not reopen with its progress')
      updater.emit('download-progress', { percent: 100, transferred: 100, total: 100, bytesPerSecond: 10 })
      await waitFor(`${dialog}?.textContent.includes('正在校验')`, 'Verification did not render')
      await close()
      await click('.about-update-button')
      await waitFor(`${dialog}?.textContent.includes('正在校验')`, 'Verification could not reopen')
      completeDownload()
      await waitFor(`${dialog}?.textContent.includes('重启并更新')`, 'Prepared update did not render')
      await close()
      await click('.about-update-button')
      await waitFor(`${dialog}?.textContent.includes('重启并更新')`, 'Prepared update could not reopen')
      await execute('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      if (process.env.ELECKOI_CLIENT_PROBE_SCREENSHOT) writeFileSync(process.env.ELECKOI_CLIENT_PROBE_SCREENSHOT, (await window.webContents.capturePage()).toPNG())
      await click('.app-update-dialog .is-primary')
      await waitFor(`${dialog}?.textContent.includes('正在更新')`, 'Installation handoff did not render')
      assert.equal(checks, 1)
      assert.equal(downloads, 1)
      assert.equal(installs, 1)
      assert.deepEqual(errors, [])
      process.stdout.write('Built desktop update discovery, dismissal, reopening, download, verification and installation confirmation passed; no executable installed.\n')
    }
  }
}
