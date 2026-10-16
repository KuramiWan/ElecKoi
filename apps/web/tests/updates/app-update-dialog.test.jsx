// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppUpdateController } from '../../src/modules/updates/components/AppUpdateController.jsx'

let root, host
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 0))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('uses the declared Android release and download action without desktop installation controls', async () => {
  vi.stubGlobal('__ELECKOI_CLIENT_PLATFORM__',{kind:'android'});
  const updates={status:{phase:'available',availableVersion:'0.2.9',currentVersion:'0.2.8',releaseUrl:'https://github.com/eleckoi/ElecKoi/releases/tag/android-v0.2.9'},download:vi.fn(),install:vi.fn()};
  await act(async () => root.render(<AppUpdateController updates={updates} />));
  expect(document.querySelector('a').href).toBe(updates.status.releaseUrl);
  expect(document.querySelector('.is-primary').textContent).toBe('前往下载');
  await act(async () => document.querySelector('.is-primary').click());
  expect(updates.download).toHaveBeenCalledOnce(); expect(updates.install).not.toHaveBeenCalled();
  updates.status={...updates.status,phase:'error',manualCheck:false,message:'合成网络错误'};
  await act(async () => root.render(<AppUpdateController updates={updates} />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
})

it('keeps complete notes and update controls through download and install without stealing reading focus', async () => {
  const releaseNotes = Array.from({ length: 100 }, (_, index) => `合成更新条目 ${index}`).join('\n')
  const updates = { status: { phase: 'available', availableVersion: '0.2.8', currentVersion: '0.2.7', releaseNotes },
    download: vi.fn(), install: vi.fn(async () => ({ accepted: true })) }
  const render = async () => { await act(async () => root.render(<AppUpdateController updates={updates} />)) }
  await render()
  await new Promise(resolve => setTimeout(resolve, 5))
  const notes = document.querySelector('.app-update-notes-section')
  expect(notes.textContent.trim()).toBe(releaseNotes)
  expect(notes.tabIndex).toBe(0)
  expect(document.querySelector('a').href).toBe('https://github.com/eleckoi/ElecKoi/releases/tag/v0.2.8')
  await act(async () => document.querySelector('.is-primary').click())
  expect(updates.download).toHaveBeenCalledOnce()
  notes.focus()
  updates.status = { ...updates.status, phase: 'downloading', progress: { percent: 46 } }
  await render()
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(document.activeElement).toBe(notes)
  expect(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('46')
  expect(document.querySelector('.is-primary').disabled).toBe(true)
  updates.status = { ...updates.status, phase: 'verifying', progress: { percent: 100 } }
  await render()
  expect(document.querySelector('.is-primary').textContent).toBe('正在校验')
  expect(document.querySelector('.is-primary').disabled).toBe(true)
  expect(document.activeElement).toBe(notes)
  updates.status = { ...updates.status, phase: 'ready' }
  await render()
  await act(async () => document.querySelector('.is-primary').click())
  expect(updates.install).toHaveBeenCalledOnce()
  const link = document.querySelector('a')
  link.focus()
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })))
  expect(document.activeElement).toBe(document.querySelector('.is-primary'))
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it.each([
  ['check', '重新检查', 'check'],
  ['download', '重新下载', 'download'],
  ['install', '重试安装', 'install']
])('retries the failed %s stage without repeating another stage', async (failedOperation, label, action) => {
  const updates = {
    status: { phase: 'error', failedOperation, availableVersion: '1.0.1', currentVersion: '1.0.0', message: '合成更新错误' },
    check: vi.fn(), download: vi.fn(), install: vi.fn(async () => ({ accepted: true }))
  }
  await act(async () => root.render(<AppUpdateController updates={updates} />))
  const button = document.querySelector('.is-primary')
  expect(button.textContent).toBe(label)
  await act(async () => button.click())
  for (const stage of ['check', 'download', 'install']) {
    expect(updates[stage]).toHaveBeenCalledTimes(stage === action ? 1 : 0)
  }
})
