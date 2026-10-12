import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const source = readFileSync(join(dirname(require.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json')), 'lib/client.js'), 'utf8');
const patched = execFileSync('python', ['-c', `import importlib.util,sys
spec=importlib.util.spec_from_file_location('packager','scripts/android-runtime/package-runtime.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sys.stdout.buffer.write(module.patch_workspace_navigation(sys.stdin.buffer.read()))`], { input: source, encoding: 'utf8', windowsHide: true });

function navigation(text, saved = {}) {
  const start = text.indexOf('\t\t\tasync restoreSelection(');
  const end = text.indexOf('\t\t\t/** @returns true when an archived current selection', start);
  if (start < 0 || end < start) throw new Error('Locked Workspace navigation methods changed');
  const methods = runInNewContext(`new (class {${text.slice(start, end)}})()`, { AbortSignal, recentWorkspace: () => undefined });
  return Object.assign(methods, { selection: { getSnapshot: () => saved }, lifetime: new AbortController(),
    ctx: { layout: { beginNavigation: () => new AbortController().signal } },
    workspaces: { initializeDefault: vi.fn().mockRejectedValue(new Error('Synthetic unavailable directory')) },
    notify: vi.fn(), connectWorkspace: vi.fn(), replaceMain: vi.fn() });
}

describe('Android initial Workspace navigation', () => {
  it('reproduces the original unrequested creation and removes its startup notification', async () => {
    const workspaces = { items: [], archivedSessionIds: [] }, sessions = { ids: [], byId: {} };
    const original = navigation(source);
    await original.restoreSelection(workspaces, sessions);
    expect(original.workspaces.initializeDefault).toHaveBeenCalledOnce();
    expect(original.notify).toHaveBeenCalledWith({ kind: 'defaultWorkspaceFailed' });
    const android = navigation(patched);
    await android.restoreSelection(workspaces, sessions);
    expect(android.workspaces.initializeDefault).not.toHaveBeenCalled();
    expect(android.notify).not.toHaveBeenCalled();
    expect(android.connectWorkspace).not.toHaveBeenCalled();
  });
  it('retains saved Session restoration and the unchanged PC source', async () => {
    const android = navigation(patched, { sessionId: 'synthetic-session' });
    await android.restoreSelection({ items: [], archivedSessionIds: [] }, { ids: ['synthetic-session'], byId: { 'synthetic-session': { id: 'synthetic-session', blank: false } } });
    expect(android.replaceMain).toHaveBeenCalledWith('synthetic-session', android.lifetime.signal, 'preserve');
    expect(android.workspaces.initializeDefault).not.toHaveBeenCalled();
    expect(source).toContain('const prepared = await this.initializeDefaultWorkspace(navigation);');
    expect(patched).not.toContain('const prepared = await this.initializeDefaultWorkspace(navigation);');
  });
});
