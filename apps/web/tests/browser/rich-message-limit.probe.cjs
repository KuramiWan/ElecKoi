const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const [htmlPath, reportPath] = process.argv.slice(2);
app.setPath('userData', join(dirname(htmlPath), 'profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { sandbox: true, backgroundThrottling: false } });
  const evaluate = source => win.webContents.executeJavaScript(source);
  const wait = async condition => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate(condition)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${condition}`);
  };
  try {
    await win.loadURL(pathToFileURL(htmlPath).href);
    const reports = [];
    for (const width of [1100, 400]) for (const scheme of ['light', 'dark']) {
      win.setContentSize(width, 800);
      const options = JSON.stringify({ enabled: false, width, scheme });
      await evaluate(`window.renderLimit(${options})`);
      const id = `${width}-${scheme}`;
      await wait(`document.querySelectorAll('iframe').length===6 && Array.from(document.querySelectorAll('iframe')).every(f=>f.style.height==='64px') && Object.entries(counters).filter(([k])=>k.startsWith('${id}-')).length===6`);
      const releases = await evaluate('window.releases');
      const mounts = await evaluate('window.mounts');
      await evaluate(`window.renderLimit(${JSON.stringify({ enabled: true, width, scheme })})`);
      await wait('document.querySelectorAll("iframe").length===2');
      const before = await evaluate('JSON.parse(JSON.stringify(counters))');
      await new Promise(resolve => setTimeout(resolve, 150));
      const after = await evaluate('JSON.parse(JSON.stringify(counters))');
      const heights = await evaluate(`Array.from(document.querySelectorAll('.rich-message-placeholder'),node=>node.style.minHeight)`);
      await evaluate(`document.querySelector('[data-message="${id}-older-a"] .rich-message-load').click()`);
      await wait('document.querySelectorAll("iframe").length===4');
      await wait(`window.mounts===${mounts + 2} && counters['${id}-older-a-false']>${after[`${id}-older-a-false`]} && counters['${id}-older-a-true']>${after[`${id}-older-a-true`]}`);
      await evaluate(`document.querySelector('[data-message="${id}-older-b"] .rich-message-load').click()`);
      await wait(`document.querySelectorAll('iframe').length===4 && !document.querySelector('[data-message="${id}-older-a"] iframe')`);
      await wait(`window.mounts===${mounts + 4} && counters['${id}-older-b-false']>${after[`${id}-older-b-false`]} && counters['${id}-older-b-true']>${after[`${id}-older-b-true`]}`);
      await evaluate('document.querySelector(".rich-message-stop").click()');
      await wait('document.querySelectorAll("iframe").length===2');
      reports.push({ width, scheme, before, after, heights, id, releasesBefore: releases, releasesAfter: await evaluate('window.releases'),
        overflow: await evaluate('document.documentElement.scrollWidth > window.innerWidth') });
    }
    writeFileSync(reportPath, JSON.stringify(reports));
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
