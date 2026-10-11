import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { t } from '../../i18n'

type EditRole = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'

/** Provide native editing commands for text fields and selected document text. */
export function installTextContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, { isEditable, selectionText, editFlags }) => {
    const items: MenuItemConstructorOptions[] = []
    if (isEditable) {
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll }
      )
    } else if (selectionText.length > 0) {
      items.push({ role: 'copy', enabled: editFlags.canCopy })
    }
    if (items.length === 0) return
    Menu.buildFromTemplate(items.map(item => ({
      ...item,
      ...(process.platform === 'win32' && item.role !== undefined
        ? { label: t(item.role as EditRole) } : {}),
      accelerator: ''
    }))).popup({ window })
  })
}
