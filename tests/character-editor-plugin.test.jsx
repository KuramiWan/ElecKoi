// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const saveCharacter = vi.hoisted(() => vi.fn())

vi.mock('../apps/web/src/modules/persona/index.js', () => ({
  CharacterBasicInfoPanel: ({ character }) => <div data-testid="built-in-card">{character.name}</div>,
}))
vi.mock('../apps/web/src/modules/appearance/index.js', () => ({ applyAppearanceTheme: () => {} }))
vi.mock('../apps/web/src/modules/settingLibraries/index.js', () => ({
  DynamicSettingsPanel: () => null,
  SettingLibraryPanel: () => null,
}))
vi.mock('../apps/web/src/modules/variables/index.js', () => ({ VariableConfigPanel: () => null }))
vi.mock('../apps/web/src/modules/regex/index.js', () => ({ RegexRulesPanel: () => null }))
vi.mock('../apps/web/src/app/services/windowControls.js', () => ({
  appWindow: { close: vi.fn() },
  showCurrentWindow: () => Promise.resolve(),
}))
vi.mock('../apps/web/src/app/windows/shell/components/TitleBar.jsx', () => ({ TitleBar: () => null }))
vi.mock('../apps/web/src/ui/ui/UnsavedChangesDialog.jsx', () => ({ UnsavedChangesDialog: () => null }))

import { CharacterEditorWindow } from '../apps/web/src/app/windows/CharacterEditorWindow.jsx'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

afterEach(() => {
  saveCharacter.mockReset()
  document.body.innerHTML = ''
  window.history.replaceState({}, '', '/')
})

describe('character editor client extension', () => {
  it('renders the real card editor through the DSH handoff and keeps its save action', async () => {
    window.history.replaceState({}, '', '/?view=character-editor&character=character-1')
    const initial = { id: 'character-1', name: '角色甲', persona: { assistant_name: '角色甲' } }
    const saved = { ...initial, name: '角色乙', persona: { assistant_name: '角色乙' } }
    const collection = { active_character_id: initial.id, groups: [], items: [initial] }
    const savedCollection = { ...collection, items: [saved] }
    const characterCatalog = { refresh: vi.fn().mockResolvedValue(collection), update: saveCharacter }
    saveCharacter.mockResolvedValue(savedCollection)
    const handoff = vi.fn((_section, _owner, fallback) => <div data-testid="extension-seat">{fallback}</div>)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(<CharacterEditorWindow characterCatalog={characterCatalog}
          characterConfiguration={{}} />)
      })
      expect(container.querySelector('[data-testid="built-in-card"]')?.textContent).toBe('角色甲')
      expect(container.querySelector('[data-testid="extension-seat"]')).toBeNull()

      await act(async () => {
        root.render(<CharacterEditorWindow characterCatalog={characterCatalog}
          characterConfiguration={{}} renderCharacterEditorSection={handoff} />)
      })
      expect(container.querySelector('[data-testid="extension-seat"]')).not.toBeNull()
      expect(container.querySelector('[data-testid="built-in-card"]')?.textContent).toBe('角色甲')

      let savedResult
      await act(async () => { savedResult = await handoff.mock.lastCall[1].onSave(saved) })
      expect(savedResult).toBe(true)
      expect(saveCharacter).toHaveBeenCalledWith(saved)
      expect(container.querySelector('[data-testid="built-in-card"]')?.textContent).toBe('角色乙')
    } finally {
      await act(async () => root.unmount())
    }
  })

  // 判据来源：spec-error-handling-interface.md 的 R1（边界⑥）与 ADR 0002 决定 12。
  // 读取失败今天被 `.catch(() => {})` 吃掉，窗口随后显示「角色不存在」——用户会以为角色被删了。
  it('shows the read failure with its code and details instead of claiming the character does not exist', async () => {
    window.history.replaceState({}, '', '/?view=character-editor&character=character-1')
    const failure = {
      isDSHRemoteError: true,
      code: 'eleckoi/io/failed',
      message: '读取角色列表失败：ENOENT',
      details: { operation: 'read', path: '/tmp/eleckoi/characters.json' },
    }
    const characterCatalog = { refresh: vi.fn().mockRejectedValue(failure), update: vi.fn() }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(<CharacterEditorWindow characterCatalog={characterCatalog}
          characterConfiguration={{}} />)
      })

      expect(container.textContent).not.toContain('角色不存在')
      const alert = container.querySelector('[role="alert"]')
      expect(alert).not.toBeNull()
      expect(alert.textContent).toContain('eleckoi/io/failed')
      expect(alert.textContent).toContain('/tmp/eleckoi/characters.json')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
