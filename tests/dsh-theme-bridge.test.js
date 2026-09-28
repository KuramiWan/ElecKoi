// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyAppearanceMode, initializeAppearanceMode } from '../src/renderer/src/modules/appearance/theme/appearanceMode.js';

afterEach(() => {
  delete globalThis.__ELECKOI_DSH_PLATFORM__;
  document.documentElement.removeAttribute('data-ds-theme-source');
  document.documentElement.removeAttribute('data-appearance-mode');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.removeProperty('color-scheme');
  document.body.removeAttribute('data-ds-dark-theme');
});

describe('DSH theme ownership', () => {
  it('projects the active DSH palette without applying the old product preference', () => {
    globalThis.__ELECKOI_DSH_PLATFORM__ = {};
    document.documentElement.dataset.dsThemeSource = 'dark';
    document.documentElement.style.colorScheme = 'dark';
    document.body.setAttribute('data-ds-dark-theme', '');

    expect(applyAppearanceMode('light')).toEqual({ mode: 'dark', resolved: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('follows a DSH theme change in the embedded client', async () => {
    globalThis.__ELECKOI_DSH_PLATFORM__ = {};
    document.documentElement.dataset.dsThemeSource = 'system';
    const dispose = await initializeAppearanceMode();
    expect(document.documentElement.dataset.appearanceMode).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');

    document.body.setAttribute('data-ds-dark-theme', '');
    window.dispatchEvent(new CustomEvent('eleckoi:dsh-theme:state'));
    expect(document.documentElement.dataset.appearanceMode).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    dispose();
  });
});
