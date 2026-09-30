import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readStyles = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const shellStyles = readStyles('../src/renderer/src/app/windows/shell/styles/client-shell.css');
const pluginStyles = readStyles('../src/renderer/src/app/windows/shell/styles/plugin-center.css');
const characterStyles = readStyles('../src/renderer/src/modules/persona/styles/character-list.css');
const presetStyles = readStyles('../src/renderer/src/modules/presets/styles/preset-panel.css');
const conversationStyles = readStyles('../src/renderer/src/modules/chat/styles/conversation-list.css');
const modelStyles = readStyles('../src/renderer/src/modules/models/styles/model-config.css');

describe('sidebar list scrolling', () => {
  it('keeps the shared side-panel height bounded', () => {
    expect(shellStyles).toMatch(/\.side-panel-shell[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/);
    expect(shellStyles).toMatch(/\.side-panel-content\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/);
  });

  it('puts plugin items in the bounded third grid row', () => {
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\);/);
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow:\s*hidden;/);
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*>\s*\.character-list-scroll\s*\{[^}]*grid-row:\s*3;[^}]*overflow-y:\s*auto;/);
  });

  it('shows a dedicated scrollbar in every sidebar list', () => {
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*>\s*\.character-list-scroll\s*\{[^}]*scrollbar-gutter:\s*stable;[^}]*scrollbar-width:\s*thin;/);
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*>\s*\.character-list-scroll::\-webkit-scrollbar\s*\{[^}]*width:\s*8px;/);
    expect(pluginStyles).toMatch(/\.plugin-list-panel\s*>\s*\.character-list-scroll::\-webkit-scrollbar-thumb\s*\{[^}]*background:/);
    expect(characterStyles).toMatch(/\.character-list-scroll\s*\{[^}]*scrollbar-gutter:\s*stable;[^}]*scrollbar-width:\s*thin;/);
    expect(characterStyles).toMatch(/\.character-list-scroll::\-webkit-scrollbar\s*\{[^}]*width:\s*8px;/);
    expect(characterStyles).toMatch(/\.character-list-scroll::\-webkit-scrollbar-thumb\s*\{[^}]*background:/);
  });

  it('keeps plugin, character, preset, and conversation lists wheel-scrollable', () => {
    expect(characterStyles).toMatch(/\.character-list-panel\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow:\s*hidden;/);
    expect(characterStyles).toMatch(/\.character-list-scroll\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
    expect(presetStyles).toMatch(/\.preset-list-panel\s*\{[^}]*grid-template-rows:\s*auto auto auto minmax\(0, 1fr\);/);
    expect(conversationStyles).toMatch(/\.conversation-scroll\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
  });
});

describe('model configuration scrolling', () => {
  it('keeps the model library bounded and independently scrollable', () => {
    expect(modelStyles).toMatch(/\.model-config-sidebar\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow:\s*hidden;/);
    expect(modelStyles).toMatch(/\.model-config-list\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/);
    expect(modelStyles).toMatch(/\.model-config-list\s*\{[^}]*scrollbar-gutter:\s*stable;[^}]*scrollbar-width:\s*thin;/);
  });

  it('keeps the detail page bounded, wheel-scrollable, and visibly scrollable', () => {
    expect(modelStyles).toMatch(/\.model-config-detail\s*\{[^}]*min-height:\s*0;[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow-y:\s*auto;/);
    expect(modelStyles).toMatch(/\.model-config-detail\s*\{[^}]*overscroll-behavior:\s*contain;[^}]*scrollbar-gutter:\s*stable;[^}]*scrollbar-width:\s*thin;/);
    expect(modelStyles).toMatch(/\.model-config-list::\-webkit-scrollbar,\s*\.model-config-detail::\-webkit-scrollbar\s*\{[^}]*width:\s*10px;/);
    expect(modelStyles).toMatch(/\.model-config-list::\-webkit-scrollbar-thumb,\s*\.model-config-detail::\-webkit-scrollbar-thumb\s*\{[^}]*background:/);
  });
});
