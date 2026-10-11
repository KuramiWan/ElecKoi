async (page) => {
  await page.route('https://native-libraries.test/', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><style>html,body,#root{height:100%;margin:0}body{font:14px system-ui;background:var(--chat);color:var(--text)}</style></head><body><div id="root"></div></body></html>' }));
  const results = [];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.goto('https://native-libraries.test/');
    await page.addStyleTag({ path: 'output/playwright/native-libraries/fixture.css' });
    await page.addScriptTag({ path: 'output/playwright/native-libraries/fixture.js' });
    await page.evaluate(() => { window.librariesFixture = window.mountNativeLibrariesFixture(); });
    for (const label of ['全局脚本', '角色脚本', '预设脚本']) {
      await page.getByRole('button', { name: `打开${label}目录`, exact: true }).click();
    }
    const result = await page.evaluate(() => ({ operations: window.librariesFixture.operations,
      width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      controls: [...document.querySelectorAll('.script-group > header > button')].map(button => {
        const { x, y, width, height } = button.getBoundingClientRect(); return { x, y, width, height, name: button.getAttribute('aria-label') };
      }) }));
    if (result.scrollWidth > result.width || result.operations.map(item => item.scope).join(',') !== 'global,character,preset'
      || result.operations[1].ownerId !== 'synthetic-character' || result.operations[2].ownerId !== 'synthetic-preset'
      || result.controls.some(control => control.x < 0 || control.x + control.width > result.width || control.width < 20 || control.height < 20)) throw new Error(JSON.stringify(result));
    await page.screenshot({ path: `output/playwright/native-libraries-${viewport.width}.png` });
    await page.evaluate(() => window.librariesFixture.dispose());
    results.push({ viewport, directories: result.operations.length, overflow: false });
  }
  return { results };
}
