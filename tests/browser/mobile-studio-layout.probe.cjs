const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const [htmlPath, reportPath] = process.argv.slice(2);
app.setPath('userData', join(dirname(htmlPath), 'browser-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  const evaluate = async source => {
    try { return await win.webContents.executeJavaScript(source); }
    catch (cause) { throw new Error(`${cause.message}\nEvaluation: ${source}`); }
  };
  const wait = async source => { for (let count = 0; count < 120; count++) { if (await evaluate(source)) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(`Timed out: ${source}`); };
  try {
    await win.loadURL(pathToFileURL(htmlPath).href);
    const reports = [];
    await wait(`Boolean(document.querySelector('.creator-studio-view-tabs'))`);
    for (const width of [320, 390, 768]) for (const height of [844, 400]) for (const theme of ['light', 'dark']) {
      win.setContentSize(width, height);
      await evaluate(`document.documentElement.dataset.eleckoiMobile='true';document.documentElement.dataset.theme='${theme}';document.body.toggleAttribute('data-ds-dark-theme','${theme}'==='dark')`);
      for (const tab of ['对话', '轨迹']) {
        await evaluate(`[...document.querySelectorAll('.creator-studio-view-tabs button')].find(button=>button.textContent==='${tab}').click()`);
        await wait(`document.querySelector('.creator-studio-view-tabs [aria-selected="true"]').textContent==='${tab}'`);
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const report = await evaluate(`(()=>{const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},page=document.querySelector('.mobile-creator-studio-page'),title=page.querySelector('.mobile-header'),tabs=page.querySelector('.creator-studio-view-tabs'),body=page.querySelector('.creator-studio-chat-scroll'),native=body.querySelector('[data-conversation-composer-overlay]'),composer=page.querySelector('[data-composer-seat]');return {
          header:rect(title),tabs:rect(tabs),titleSize:getComputedStyle(title.querySelector('h1')).fontSize,reference:rect(document.querySelector('[data-roleplay-header]')),
          actions:[...title.querySelectorAll('button')].map(rect),tabButtons:[...tabs.querySelectorAll('button')].map(rect),body:rect(body),native:native?rect(native):null,
          bodyWidth:body.scrollWidth,composer:rect(composer),draft:composer.querySelector('textarea').value,dialog:!!page.querySelector('.creator-studio-native-detail'),
          clearance:getComputedStyle(body).getPropertyValue('--dsh-composer-height'),view:body.querySelector('[data-view]').dataset.view}})()`);
        reports.push({ width, height, theme, tab, ...report });
        if (width === 390 && height === 844 && theme === 'light') writeFileSync(join(dirname(reportPath), `${report.view}.png`), (await win.webContents.capturePage()).toPNG());
      }
    }
    writeFileSync(reportPath, JSON.stringify(reports, null, 2)); win.destroy(); app.exit(0);
  } catch (cause) { console.error(cause); win.destroy(); app.exit(1); }
});
