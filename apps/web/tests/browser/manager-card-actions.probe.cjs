const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const [htmlPath, reportPath] = process.argv.slice(2);
app.setPath('userData', join(dirname(htmlPath), 'browser-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } });
  const evaluate = source => win.webContents.executeJavaScript(source);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function wait(source) {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(source)) return; await pause(30); }
    throw new Error(`Timed out: ${source}`);
  }
  try {
    const reports = [];
    for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 900], [900, 500]]) {
      win.setContentSize(width, height);
      await win.loadURL(`${pathToFileURL(htmlPath).href}?mode=preset`);
      await wait('Boolean(document.querySelector(".preset-manager-card"))');
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      const point = await evaluate(`(() => { const r=document.querySelector('.preset-manager-card').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      await pause(180);
      const preset = await evaluate(`(() => { const grid=document.querySelector('.preset-manager-grid'), card=grid.firstElementChild;
        const g=grid.getBoundingClientRect(), r=card.getBoundingClientRect();
        return {borderInside:r.top>=g.top+2,scrollable:grid.scrollHeight>grid.clientHeight,selected:card.classList.contains('is-current')}; })()`);
      if (width === 1440) writeFileSync(join(dirname(reportPath), `preset-border-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      await evaluate('document.querySelector(".preset-manager-grid").scrollTop=100000');
      const lastVisible = await evaluate(`(() => { const grid=document.querySelector('.preset-manager-grid'), g=grid.getBoundingClientRect(), r=grid.lastElementChild.getBoundingClientRect();return r.bottom<=g.bottom&&r.top>=g.top; })()`);
      await win.loadURL(`${pathToFileURL(htmlPath).href}?mode=character`);
      await wait('Boolean(document.querySelector(".character-card"))');
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}; document.querySelector('.character-card').click()`);
      const singleClick = await evaluate('window.openedEditors.length===1&&window.openedEditors[0][0].includes("character=synthetic-character")');
      await evaluate(`document.querySelector('.character-card').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-2,clientY:innerHeight-2}))`);
      await wait('Boolean(document.querySelector("[role=menu]"))');
      const menu = await evaluate(`(() => { const el=document.querySelector('[role=menu]'), r=el.getBoundingClientRect();
        const buttons=[...el.querySelectorAll('button')], action=buttons.find(b=>b.textContent==='复制角色卡'), a=action.getBoundingClientRect();
        return {inside:r.left>=8&&r.top>=8&&r.right<=innerWidth-8&&r.bottom<=innerHeight-8,labels:buttons.slice(0,2).map(b=>b.textContent),
          reachable:action.contains(document.elementFromPoint(a.x+a.width/2,a.y+a.height/2)),lastGroup:buttons.at(-1).textContent,
          scrollable:el.querySelector('.group-assignment-menu-targets').scrollHeight>el.querySelector('.group-assignment-menu-targets').clientHeight}; })()`);
      await pause(50);
      if (width === 1440) writeFileSync(join(dirname(reportPath), `manager-actions-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      await evaluate(`[...document.querySelector('[role=menu]').querySelectorAll('button')].find(b=>b.textContent==='复制角色卡').click()`);
      await wait('document.querySelector("#synthetic-copies").textContent==="1"');
      const copied = await evaluate('!document.querySelector("[role=menu]")&&window.openedEditors.length===1');
      reports.push({theme,width,preset,lastVisible,singleClick,menu,copied});
    }
    writeFileSync(reportPath, JSON.stringify(reports)); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
