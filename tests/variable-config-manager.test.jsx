// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { VariableConfigManager } from '../src/renderer/src/modules/variables/components/VariableConfigManager.jsx';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('React', React);

function configuration(name) {
  const version = {
    id: 'version-a', name, initialStateJson: '{}', schemaCode: '',
    objects: [], variables: [], expandedObjectIds: [], createdAt: '', updatedAt: '',
  };
  return {
    ...version, characterId: 'synthetic-character', activeVersionId: version.id,
    versions: [version, { ...version, id: 'version-b', name: '配置 B', schemaCode: 'const Schema = z.object({})' }],
  };
}

function button(container, text) {
  const target = [...container.querySelectorAll('button')].find((item) => item.textContent === text);
  expect(target).toBeTruthy();
  return target;
}

describe('variable configuration manager', () => {
  it.each(['配置 A', ''])('opens version creation for an existing version named %j and copies the selected source', async (name) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const changed = vi.fn();
    function Harness() {
      const [config, setConfig] = useState(() => configuration(name));
      return <VariableConfigManager config={config} onChange={(value) => { changed(value); setConfig(value); }} onClose={vi.fn()} onError={vi.fn()} />;
    }
    try {
      await act(async () => root.render(<Harness />));
      await act(async () => button(container, '新建版本').click());

      const dialog = container.querySelector('[aria-labelledby="variable-create-version-title"]');
      expect(dialog).toBeTruthy();
      const input = dialog.querySelector('input[maxlength="60"]');
      expect(input.value).toBe(`${name || '未命名版本'} · 副本`);

      const radios = dialog.querySelectorAll('input[type="radio"]');
      await act(async () => radios[radios.length - 1].click());
      expect(input.value).toBe('新版本');
      await act(async () => radios[1].click());
      expect(input.value).toBe('配置 B · 副本');
      await act(async () => button(dialog, '创建版本').click());

      const result = changed.mock.lastCall[0];
      expect(result.versions).toHaveLength(3);
      expect(result).toMatchObject({ name: '配置 B · 副本', schemaCode: 'const Schema = z.object({})' });
      expect(result.activeVersionId).not.toBe('version-b');
      expect(container.querySelector('[aria-labelledby="variable-create-version-title"]')).toBeNull();
      expect(container.querySelector('[aria-label="变量配置版本"]').value).toBe(result.activeVersionId);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
