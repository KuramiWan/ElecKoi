// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PresetToolsEditor } from '../apps/web/src/modules/presets/components/PresetToolsEditor.jsx';
import { AgentToolsDialog } from '../apps/web/src/modules/chat/components/AgentToolsDialog.jsx';
import { EditorPresentationContext } from '../apps/web/src/ui/ui/EditorPresentationContext.jsx';
import { MainPageContext } from '../apps/web/src/app/windows/MainPageContext.jsx';
import { agentToolGroups } from '../packages/host/product-data/src/domain/agentTools/agentToolGroups';
import { processArgumentSummary } from '../apps/web/src/modules/chat/model/agentProcessArguments.js';

const groups = [['builtin:setting-library', 4, 'eleckoi_read_setting_files'], ['builtin:variables', 4, 'eleckoi_read_variables'], ['builtin:creator', 3, 'eleckoi_call_capability']];

let root;
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

it.each(groups)('shows continuation arguments under the existing %s tool', (_id, _count, reader) => {
  const args = { result: { file_path: '/synthetic/result.txt', offset: 32768, query: '末尾关键词', limit: 50 } };
  expect(processArgumentSummary(reader, JSON.stringify(args))).toBe('结果文件：/synthetic/result.txt\n字节起始位置：32768\n本页命中数：50\n搜索文字：末尾关键词');
  expect(processArgumentSummary(reader, { ...args, paths: ['synthetic'] })).toBeNull();
});
afterEach(async () => {
  await act(async () => root.unmount()); document.body.replaceChildren();
  delete document.documentElement.dataset.eleckoiMobile; vi.unstubAllGlobals();
});

it.each(groups.flatMap(([id, count, reader]) => [false, true].map(mobile => ({ id, count, reader, mobile }))))
  ('keeps $id at $count tools and describes continuation in its existing reader mobile=$mobile', async ({ id, count, reader, mobile }) => {
    document.documentElement.dataset.eleckoiMobile = String(mobile);
    const preset = { id: 'synthetic-preset', toolGroups: agentToolGroups(new Set([id])) }, change = vi.fn();
    const original = structuredClone(preset);
    await act(async () => root.render(<MainPageContext.Provider value={{ registerBackHandler: () => () => {} }}>
      <EditorPresentationContext.Provider value={{ compact: mobile }}><PresetToolsEditor preset={preset} onChange={change} /></EditorPresentationContext.Provider>
    </MainPageContext.Provider>));
    expect(document.querySelectorAll('.preset-tool-row')).toHaveLength(1);
    await act(async () => document.querySelector('.preset-tool-summary').click());
    const body = document.querySelector('.preset-tool-config-body');
    expect(body.textContent).toContain(`包含 ${count} 个工具`);
    expect([...body.querySelectorAll('code')].map(node => node.textContent)).toContain(reader);
    const member = [...body.querySelectorAll('code')].find(node => node.textContent === reader).parentElement;
    expect(member.textContent).toContain('续读或搜索');
    expect(document.body.textContent).not.toContain('共用工具');
    expect(document.body.textContent).not.toContain('eleckoi_read_tool_result');
    expect(change).not.toHaveBeenCalled(); expect(preset).toEqual(original);
  });

it.each([false, true])('keeps the conversation tool dialog on the original creator group mobile=%s', async mobile => {
  document.documentElement.dataset.eleckoiMobile = String(mobile);
  const preset = { id: 'synthetic-creator', toolGroups: agentToolGroups(new Set(['builtin:creator'])) };
  const catalog = { refresh: async () => ({ activePresetIds: { creator: preset.id } }), read: async () => preset, save: vi.fn() };
  await act(async () => root.render(<MainPageContext.Provider value={{ registerBackHandler: () => () => {} }}>
    <AgentToolsDialog presetCatalog={catalog} purpose="creator" onClose={() => {}} />
  </MainPageContext.Provider>));
  expect(document.querySelectorAll('.agent-tool-row')).toHaveLength(1);
  await act(async () => document.querySelector('.agent-tool-open').click());
  const body = document.querySelector('.agent-tool-detail');
  expect(body.textContent).toContain('包含 3 个工具');
  expect(body.textContent).toContain('续读或搜索');
  expect(body.querySelector('[role=switch]')).toBeTruthy();
  expect(catalog.save).not.toHaveBeenCalled();
});
