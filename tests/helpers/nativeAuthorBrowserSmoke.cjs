async (page) => {
  await page.route('https://native-author.test/**', async route => {
    if (new URL(route.request().url()).pathname.startsWith('/eleckoi/scripts/')) {
      const body = await page.evaluate(file => window.__syntheticScriptAsset(file), new URL(route.request().url()).pathname.split('/').slice(6).join('/'));
      return route.fulfill({ status: body === null ? 404 : 200, body: body ?? 'Missing synthetic module', contentType: 'text/javascript' });
    }
    return route.fulfill({ path: 'tests/fixtures/native-author-browser.html', contentType: 'text/html' });
  });
  const results = [];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('https://native-author.test/');
    await page.addScriptTag({ path: 'packages/client/features/dsh-client-author/lib/client.js' });
    await page.addScriptTag({ path: 'output/playwright/native-message/fixture.js' });
    await page.evaluate(() => window.prepareNativeFixture());
    await page.waitForFunction(() => window.nativeRuntime.getSnapshot().status === 'ready');
    const author = page.frameLocator('#author-page');
    await page.waitForFunction(() => document.querySelector('#author-page').contentDocument.querySelector('#result')?.textContent === 'ready');
    await author.locator('#score').fill('-1');
    await author.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForFunction(() => document.querySelector('#author-page').contentDocument.querySelector('#result').textContent.includes('Synthetic score must not be negative'));
    const rejected = await page.evaluate(() => ({...window.nativeFixture.snapshot(), messages: document.querySelector('#messages').textContent}));
    if (rejected.state.score !== 1 || rejected.pending !== 0 || rejected.messages !== '') throw new Error(JSON.stringify(rejected));
    await author.locator('#score').fill('7');
    await author.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForFunction(() => document.querySelector('#author-page').contentDocument.querySelector('#result').textContent.includes('synthetic-input'));
    const result = await page.evaluate(() => ({
      ...window.nativeFixture.snapshot(), draft: document.querySelector('#composer').value,
      messages: document.querySelector('#messages').textContent,
      receipt: JSON.parse(document.querySelector('#author-page').contentDocument.querySelector('#result').textContent).receipt,
      context: JSON.parse(document.querySelector('#author-page').contentDocument.querySelector('#result').textContent).context,
    }));
    if (result.state.score !== 7 || result.state.derived !== 14 || result.pending !== 0 || result.objectUrls !== 0
      || result.draft !== 'Synthetic draft' || result.messages !== 'Synthetic score 7' || result.frameCount !== 1
      || result.receipt.messageId !== 'synthetic-input' || result.context.messageId !== 'synthetic-opening'
      || result.context.surface !== 'message-renderer') throw new Error(JSON.stringify(result));
    await page.waitForFunction(() => {
      const frame = document.querySelector('#author-page'), body = frame.contentDocument.body;
      return body.getBoundingClientRect().bottom + parseFloat(frame.contentWindow.getComputedStyle(body).marginBottom) <= frame.clientHeight;
    });
    await page.screenshot({ path: `output/playwright/native-author-${viewport.width}.png` });
    await page.evaluate(() => {
      const api = document.querySelector('#author-page').contentWindow.ElecKoi;
      window.syntheticGenerationEvents = [];
      for (const name of ['agent.output.delta', 'agent.run.finished', 'agent.run.cancelled', 'agent.run.failed', 'agent.generation.stats']) {
        api.events.on(name, payload => window.syntheticGenerationEvents.push({ name, payload }));
      }
      window.nativeFixture.generate('completed', 10);
      window.nativeFixture.generate('cancelled', 11);
      window.nativeFixture.generate('error', 12);
    });
    await page.waitForFunction(() => window.syntheticGenerationEvents.filter(item => item.name.startsWith('agent.run.')).length === 3);
    const generationEvents = await page.evaluate(() => window.syntheticGenerationEvents);
    const finished = generationEvents.find(item => item.name === 'agent.run.finished');
    if (finished.payload.message.id !== 'synthetic-generated-reply' || finished.payload.message.variableState.derived !== 14
      || generationEvents.find(item => item.name === 'agent.run.cancelled').payload.reason !== 'cancelled'
      || generationEvents.find(item => item.name === 'agent.run.failed').payload.code !== 'SYNTHETIC_FAILURE'
      || new Set(generationEvents.filter(item => item.name.startsWith('agent.run.')).map(item => item.payload.generationId)).size !== 3
      || generationEvents.filter(item => item.name === 'agent.output.delta').length !== 3) throw new Error(JSON.stringify(generationEvents));
    const messageResult = await page.evaluate(async () => {
      window.nativeFixture.seedMessages();
      const api = document.querySelector('#author-page').contentWindow.ElecKoi;
      const history = await api.variables.getState({ messageId: 'synthetic-reply' });
      const current = await api.messages.current(), page = await api.messages.getPage();
      const edited = await api.messages.setContent('synthetic-input', 'Synthetic edited input');
      const generated = await api.messages.regenerate('synthetic-reply');
      const replaced = await api.messages.editAndRegenerate('synthetic-input', 'Synthetic replacement');
      const deleted = await api.messages.deleteFrom('synthetic-new-reply');
      return { history, current: current.id, pageCount: page.items.length, edited: edited.content,
        generated: generated.messageId, replaced: replaced.messageId, deleted, operations: window.nativeFixture.messageOperations() };
    });
    if (messageResult.history.score !== 7 || messageResult.history.derived !== 14 || messageResult.current !== 'synthetic-reply'
      || messageResult.pageCount !== 2 || messageResult.edited !== 'Synthetic edited input'
      || messageResult.generated !== 'synthetic-new-reply' || messageResult.replaced !== 'synthetic-new-reply'
      || !messageResult.deleted.ok || messageResult.operations.map(item => item.kind).join(',') !== 'edit,regenerate,regenerate,delete'
      || messageResult.operations[1].eventSeq !== 20 || messageResult.operations[2].replacementMessage !== 'Synthetic replacement'
      || messageResult.operations[3].eventSeq !== 30) throw new Error(JSON.stringify(messageResult));
    await page.evaluate(() => window.nativeFixture.editHelper('export const derive = n => n * 3;'));
    await page.waitForFunction(() => window.nativeRuntime.getSnapshot().status === 'ready' && window.nativeFixture.snapshot().stops === 1);
    const helperResult = await page.evaluate(() => document.querySelector('#author-page').contentWindow.ElecKoi.variables.merge({ score: 4 }));
    if (helperResult.derived !== 12) throw new Error(JSON.stringify(helperResult));
    await page.evaluate(() => window.nativeFixture.editHelper(null));
    await page.waitForFunction(() => window.nativeRuntime.getSnapshot().status === 'error');
    await page.evaluate(() => window.nativeFixture.editHelper('export const derive = n => n * 2;'));
    await page.waitForFunction(() => window.nativeRuntime.getSnapshot().status === 'ready');
    await page.evaluate(() => window.nativeFixture.edit('export default ('));
    await page.waitForFunction(() => window.nativeRuntime.getSnapshot().status === 'error');
    await page.evaluate(() => window.nativeFixture.edit('export default () => () => { parent.__syntheticStops++; }'));
    await page.waitForFunction(() => window.nativeRuntime.getSnapshot().status === 'ready');
    await page.evaluate(() => window.nativeFixture.dispose());
    const closed = await page.evaluate(() => window.nativeFixture.snapshot());
    if (closed.frameCount !== 0 || closed.objectUrls !== 0 || closed.pending !== 0 || closed.stops !== 4
      || closed.detailsSubscriptions !== 0 || closed.librarySubscriptions !== 0 || closed.generationSubscriptions !== 0
      || closed.streamSubscriptions !== 0 || closed.statsSubscriptions !== 0 || closed.status.status !== 'closed') throw new Error(JSON.stringify(closed));
    const late = await page.evaluate(async () => {
      try { await document.querySelector('#author-page').contentWindow.ElecKoi.variables.getState(); return 'unexpected-success'; }
      catch (error) { return error.code; }
    });
    if (late !== 'FRAME_CLOSED') throw new Error(`Late document call: ${late}`);
    await page.evaluate(() => window.nativeFixture.unmount());
    if (await page.locator('iframe').count()) throw new Error('Native message frame was not released');
    results.push({ viewport, score: result.state.score, derived: result.state.derived, helperDerived: helperResult.derived,
      relativeModules: true, repairedMissingModule: true, nativeMessages: true, nativeGenerationEvents: true, closed: closed.status.status });
  }
  return { results };
}
