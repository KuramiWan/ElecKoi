// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@douyinfe/semi-ui-19/lib/es/avatar', () => ({
  default: ({ children, ...props }) => <span {...props}>{children}</span>,
}))
vi.mock('@douyinfe/semi-ui-19/lib/es/input', () => ({
  default: ({ value, onChange, ...props }) => <input {...props} value={value} onChange={event => onChange(event.target.value)} />,
}))
vi.mock('@douyinfe/semi-ui-19/lib/es/input/textarea', () => ({
  default: ({ value, onChange, maxCount: _maxCount, showCounter: _showCounter, ...props }) => (
    <textarea {...props} value={value} onChange={event => onChange(event.target.value)} />
  ),
}))
vi.mock('../src/renderer/src/ui/ui/AvatarCropModal.jsx', () => ({ AvatarCropModal: () => null }))

import { CharacterBasicInfoPanel } from '../src/renderer/src/modules/persona/components/CharacterBasicInfoPanel.jsx'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

afterEach(() => {
  document.body.innerHTML = ''
})

describe('character basic information editor', () => {
  it('submits the current card instead of forwarding the button click event', async () => {
    const onSave = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(<CharacterBasicInfoPanel
          character={{
            id: 'character-1',
            name: '测试角色',
            profileLike: '',
            persona: { assistant_name: '测试角色', assistant_avatar: '', assistant_cover: '' },
          }}
          dirty
          saving={false}
          error=""
          saveNotice=""
          onChange={() => {}}
          onCancel={() => {}}
          onSave={onSave}
        />)
      })

      const saveButton = [...container.querySelectorAll('button')]
        .find(button => button.textContent === '保存更改')
      expect(saveButton).toBeTruthy()
      await act(async () => saveButton.click())
      expect(onSave).toHaveBeenCalledOnce()
      expect(onSave).toHaveBeenCalledWith()
    } finally {
      await act(async () => root.unmount())
    }
  })
})
