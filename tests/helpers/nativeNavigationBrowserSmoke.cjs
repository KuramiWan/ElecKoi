async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://native-author.test/**', async route => {
    if (new URL(route.request().url()).pathname.startsWith('/eleckoi/scripts/')) {
      const body = await page.evaluate(file => window.__syntheticScriptAsset(file), new URL(route.request().url()).pathname.split('/').slice(6).join('/'));
      return route.fulfill({ status: body === null ? 404 : 200, body: body ?? 'Missing synthetic module', contentType: 'text/javascript' });
    }
    return route.fulfill({ path: 'tests/fixtures/native-author-browser.html', contentType: 'text/html' });
  });
  const results = [];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.goto('https://native-author.test/');
    await page.addScriptTag({ path: 'packages/client/features/dsh-client-author/lib/client.js' });
    await page.addScriptTag({ path: 'output/playwright/native-message/fixture.js' });
    await page.evaluate(() => window.prepareNativeFixture());
    await page.waitForFunction(() => window.nativeRuntime.getSnapshot().status === 'ready');
    await page.evaluate(() => {
      const frame = document.createElement('iframe'); frame.id = 'navigation-page'; document.body.append(frame);
      window.nativeRuntime.mountDocument(frame.contentWindow, 'synthetic-chat', '');
      const api = frame.contentWindow.ElecKoi;
      window.nativeFixture.seedNavigation('synthetic-destination');
      window.nativeFixture.holdNavigation(() => frame.remove());
      window.navigationResult = null;
      window.navigationPending = api.chat.open('synthetic-destination').then(
        result => { window.navigationResult = { result }; }, error => { window.navigationResult = { error: error.code || error.message }; });
      window.navigationApi = api;
    });
    await page.waitForFunction(() => window.nativeFixture.navigation().waiting);
    const accepted = await page.evaluate(async () => {
      let late; try { await window.navigationApi.chat.current(); } catch (error) { late = error.code; }
      return { ...window.nativeFixture.navigation(), detached: !document.querySelector('#navigation-page'), result: window.navigationResult, late };
    });
    if (!accepted.detached || accepted.result !== null || accepted.late !== 'FRAME_CLOSED'
      || accepted.selectedId !== 'synthetic-destination') throw new Error(JSON.stringify(accepted));
    const opened = await page.evaluate(async () => {
      window.nativeFixture.finishNavigation(); await window.navigationPending; return window.navigationResult;
    });
    if (opened.result?.chat.id !== 'synthetic-destination' || opened.result.chat.title !== 'Synthetic loaded title') throw new Error(JSON.stringify(opened));
    await page.evaluate(() => {
      const frame = document.createElement('iframe'); frame.id = 'navigation-page'; document.body.append(frame);
      window.closeNavigationProject = window.nativeRuntime.mountProjectDocument(frame.contentWindow,
        { scope: 'application', projectId: 'synthetic-navigation-project', entryFile: 'index.html', view: 'main' });
      window.nativeFixture.holdNavigation();
      window.navigationResult = null;
      window.navigationPending = frame.contentWindow.ElecKoi.chat.delete('synthetic-destination').then(
        result => { window.navigationResult = { result }; }, error => { window.navigationResult = { error: error.code || error.message }; });
    });
    await page.waitForFunction(() => window.nativeFixture.navigation().waiting);
    const deleted = await page.evaluate(async () => {
      window.closeNavigationProject(); document.querySelector('#navigation-page').remove();
      if (window.navigationResult !== null) throw new Error('Navigation completed before the conversation owner');
      window.nativeFixture.finishNavigation(); await window.navigationPending;
      return { ...window.nativeFixture.navigation(), ...window.navigationResult };
    });
    if (deleted.result?.deletedId !== 'synthetic-destination' || deleted.result.chat !== null || deleted.selectedId !== ''
      || deleted.operations.map(item => item.kind).join(',') !== 'open,delete') throw new Error(JSON.stringify(deleted));
    await page.evaluate(async () => { await window.nativeFixture.dispose(); window.nativeFixture.unmount(); });
    results.push({ viewport, detachedNavigationCompleted: true, closedProjectDeletionCompleted: true, noReplacementChat: true });
  }
  if (errors.length) throw new Error(JSON.stringify(errors));
  return { results, errors };
}
