import { EventEmitter } from 'node:events'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const menu = vi.hoisted(() => ({ popup: vi.fn(), buildFromTemplate: vi.fn() }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: menu.buildFromTemplate } }))
import { installTextContextMenu } from '../src/main/platform/electron/textContextMenu'

beforeEach(() => {
  vi.clearAllMocks()
  menu.buildFromTemplate.mockReturnValue({ popup: menu.popup })
})

function fixture() {
  const contents = new EventEmitter()
  const window = { webContents: contents } as unknown as BrowserWindow
  installTextContextMenu(window)
  const show = (isEditable: boolean, selectionText = '', editFlags = {
    canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: true, canSelectAll: false
  }) => contents.emit('context-menu', {}, { isEditable, selectionText, editFlags })
  return { window, show }
}

describe('desktop text context menu', () => {
  it('opens editing roles for an empty field with Chromium edit availability', () => {
    const { window, show } = fixture()
    show(true)
    const items = menu.buildFromTemplate.mock.calls[0]![0] as MenuItemConstructorOptions[]
    expect(items.map(item => item.role || item.type)).toEqual([
      'undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'separator', 'selectAll'
    ])
    expect(items.filter(item => item.role).map(item => item.enabled)).toEqual([false, false, false, false, true, false])
    expect(items.every(item => item.accelerator === '')).toBe(true)
    if (process.platform === 'win32') {
      expect(items.filter(item => item.role).map(item => item.label)).toEqual(['撤销', '重做', '剪切', '复制', '粘贴', '全选'])
    }
    expect(menu.popup).toHaveBeenCalledExactlyOnceWith({ window })
  })

  it('updates selection, undo and redo availability on each opening', () => {
    const { show } = fixture()
    show(true, 'Selected text', {
      canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: false, canSelectAll: true
    })
    show(true, '', {
      canUndo: false, canRedo: true, canCut: false, canCopy: false, canPaste: true, canSelectAll: true
    })
    const first = menu.buildFromTemplate.mock.calls[0]![0] as MenuItemConstructorOptions[]
    const second = menu.buildFromTemplate.mock.calls[1]![0] as MenuItemConstructorOptions[]
    expect(first.find(item => item.role === 'cut')?.enabled).toBe(true)
    expect(second.find(item => item.role === 'cut')?.enabled).toBe(false)
    expect(first.find(item => item.role === 'undo')?.enabled).toBe(true)
    expect(second.find(item => item.role === 'redo')?.enabled).toBe(true)
  })

  it('offers copy for selected read-only text and leaves blank non-editable areas alone', () => {
    const { window, show } = fixture()
    show(false, 'Read-only selection', {
      canUndo: false, canRedo: false, canCut: false, canCopy: true, canPaste: false, canSelectAll: true
    })
    expect(menu.buildFromTemplate.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ role: 'copy', enabled: true, accelerator: '' })
    ])
    expect(menu.popup).toHaveBeenCalledWith({ window })
    show(false)
    expect(menu.buildFromTemplate).toHaveBeenCalledTimes(1)
  })
})
