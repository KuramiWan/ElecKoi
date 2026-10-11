// @vitest-environment jsdom
import * as React from 'react';
import * as ReactDom from 'react-dom';
import * as ReactDomClient from 'react-dom/client';
import * as Jsx from 'react/jsx-runtime';
import * as Cordis from '@deepseek-ai/cordis';
import * as Slots from '@deepseek-ai/dsh-client-ui-slots';
import * as Store from '@deepseek-ai/dsh-client-store';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
function load(file, platform = 'android') {
  let registration;
  runInNewContext(readFileSync(file, 'utf8'), {
    window: { __ModuleLoader__: { load: value => { registration = value; } } },
    __ELECKOI_CLIENT_PLATFORM__: { kind: platform }, AbortController, document, getComputedStyle,
  });
  const dependencies = { react: React, 'react-dom': ReactDom, 'react-dom/client': ReactDomClient,
    'react/jsx-runtime': Jsx, '@deepseek-ai/cordis': Cordis, '@deepseek-ai/dsh-client-ui-slots': Slots,
    '@deepseek-ai/dsh-client-store': Store, '@deepseek-ai/dsh-client-ui-primitives': {} };
  return registration.factory(name => {
    if (!(name in dependencies)) throw new Error(`Unknown test dependency ${name}`);
    return dependencies[name];
  });
}
const renderer = load(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'));
const shell = load(resolve('packages/client/features/dsh-client-shell/src/client.js'));
const mobilePath = resolve('packages/client/mobile/dsh-client-mobile/src/client.js');

describe('Android composition with the shared PC sidebar and locked DSH slots', () => {
  it('keeps real sidebar contributions and removes them when their Cordis fiber unloads', async () => {
    const ctx = new Cordis.Context();
    try {
      await ctx.plugin({ name: 'synthetic-root', apply(owner) {
        new renderer.SlotRegistry(owner);
        owner.reflect.provide('locale', { register: () => () => {}, subscribe: () => () => {} });
        owner.reflect.provide('theme', { getTheme: () => ({ active: { colorScheme: 'light', tokens: {} }, fontSize: 15 }) });
        for (const name of shell.inject.filter(name => !['slots', 'locale', 'theme'].includes(name))) owner.reflect.provide(name, {});
      } });
      await ctx.plugin(shell);
      const original = await ctx.plugin({ name: 'synthetic-page', inject: ['slots'], apply(owner) {
        owner.slots.register({ name: 'main', key: 'messages' }, () => null);
      } });
      const mobile = await ctx.plugin(load(mobilePath));
      const sidebarEntry = ctx.slots.entriesOfSlot('sidebar')[0];
      expect(sidebarEntry.component.name).toBe('ElecKoiSidebar');
      expect(sidebarEntry.registrant).toBe('@eleckoi/dsh-client-shell');
      expect(ctx.slots.entriesOfSlot('main').find(entry => entry.options.key === 'messages').registrant).toBe('@eleckoi/dsh-client-mobile');
      expect(ctx.slots.entriesOfSlot('main').find(entry => entry.options.key === 'settings').registrant).toBe('@eleckoi/dsh-client-mobile');
      const extension = await ctx.plugin({ name: 'synthetic-extension', inject: ['slots'], apply(owner) {
        owner.slots.inject('settings.section', () => owner.slots.register({ name: 'settings.section', id: 'synthetic-settings', order: 30, label: '合成扩展设置' }, () => null));
        owner.slots.inject('sidebar.panellist', () => owner.slots.register({ name: 'sidebar.panellist', id: 'synthetic-extension', label: '合成扩展' }, () => null));
        owner.slots.inject('sidebar.footer.action', () => owner.slots.register({ name: 'sidebar.footer.action', id: 'synthetic-footer' }, () => null));
        owner.slots.register({ name: 'main', key: 'synthetic-extension' }, () => null);
      } });
      expect(ctx.slots.entriesOfSlot('sidebar.panellist').some(entry => entry.options.id === 'synthetic-extension')).toBe(true);
      expect(ctx.slots.entriesOfSlot('settings.section').some(entry => entry.options.id === 'synthetic-settings')).toBe(true);
      ctx.layout.selectPanel('synthetic-extension');
      expect(ctx.layout.panelInfo.getSnapshot().windowPanelId).toBe('synthetic-extension');
      expect(ctx.slots.entriesOfSlot('sidebar.footer.action')).toHaveLength(1);
      await extension.dispose();
      expect(ctx.slots.entriesOfSlot('sidebar.panellist').some(entry => entry.options.id === 'synthetic-extension')).toBe(false);
      expect(ctx.slots.entriesOfSlot('sidebar.footer.action')).toEqual([]);
      expect(ctx.slots.entriesOfSlot('settings.section').some(entry => entry.options.id === 'synthetic-settings')).toBe(false);
      expect(ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === 'synthetic-extension')).toBe(false);
      await mobile.dispose();
      expect(ctx.slots.entriesOfSlot('eleckoi.shell.window')).toEqual([]);
      expect(ctx.slots.entriesOfSlot('main').find(entry => entry.options.key === 'messages').registrant).toBe('synthetic-page');
      await original.dispose();
    } finally { await ctx.fiber.dispose(); }
  });
  it('declines the Android window on the desktop platform', () => {
    const contributions = [];
    load(mobilePath, 'desktop').apply({ slots: {
      inject: (_name, effect) => effect(),
      register: (options, component) => { contributions.push({ options, component }); return () => {}; },
    } });
    const windowEntry = contributions.find(entry => entry.options.name === 'eleckoi.shell.window');
    expect(windowEntry.options.select({ fallback: 'desktop' })).toBeNull();
  });
});
