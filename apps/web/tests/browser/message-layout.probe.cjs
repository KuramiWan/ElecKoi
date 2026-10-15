const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { dirname } = require('node:path');
const { pathToFileURL } = require('node:url');
const [htmlPath, reportPath] = process.argv.slice(2);
app.setPath('userData', dirname(htmlPath)); app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, sandbox: true } });
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
  const reports = [];
  try {
    for (const [width, query] of [[360, ''], [412, ''], [780, ''], [1200, '?desktop'], [780, '?desktop'], [360, '?role=user'], [360, '?streaming'], [360, '?layout=agent']]) {
      win.setContentSize(width, 850);
      await win.loadURL(pathToFileURL(htmlPath).href + query);
      for (let attempt = 0; attempt < 80; attempt++) {
        if (await win.webContents.executeJavaScript('Boolean(document.querySelector(".markdown-message table"))')) break;
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      const result = await win.webContents.executeJavaScript(`(() => {
        const body=document.querySelector('.markdown-message'),column=getComputedStyle(body.parentElement).display==='contents'?body.closest('article'):body.parentElement;
        const code=body.querySelector('.md-code-block'),table=body.querySelector('table').parentElement;
        const rect=e=>e.getBoundingClientRect().toJSON();
        const button=document.querySelector('[aria-label="更多"]');
        return {body:rect(body),column:rect(column),bodyClient:body.clientWidth,bodyScroll:body.scrollWidth,
          code:rect(code),table:rect(table),tableClient:table.clientWidth,tableScroll:table.scrollWidth,
          tableOverflow:getComputedStyle(table).overflowX,
          more:button?rect(button.querySelector('svg')):null,viewport:innerWidth};
      })()`);
      if (result.more && !query.includes('desktop')) {
        await win.webContents.executeJavaScript('document.querySelector("[aria-label=更多]").click()');
        result.expanded = await win.webContents.executeJavaScript(`new Promise(resolve => {
          let attempts=0;
          const measure=()=>{
            const tools=document.querySelector('.message-tools'),ready=tools.classList.contains('expanded')&&!tools.classList.contains('swapping');
            if(!ready&&attempts++<40){setTimeout(measure,30);return;}
            resolve({ready,body:document.querySelector('.markdown-message').getBoundingClientRect().toJSON()});
          };measure();
        })`);
        await win.webContents.executeJavaScript('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))');
        result.collapsed = await win.webContents.executeJavaScript(`new Promise(resolve => {
          let attempts=0;
          const measure=()=>{
            const tools=document.querySelector('.message-tools'),ready=!tools.classList.contains('expanded')&&!tools.classList.contains('swapping');
            if(!ready&&attempts++<40){setTimeout(measure,30);return;}
            resolve({ready,body:document.querySelector('.markdown-message').getBoundingClientRect().toJSON()});
          };measure();
        })`);
      }
      await win.webContents.executeJavaScript('document.querySelector(".md-code-block [aria-label=自动换行]").click()');
      result.unwrapped = await win.webContents.executeJavaScript(`(() => {
        const code=document.querySelector('.md-code-block'),pre=code.querySelector('pre');
        return {right:code.getBoundingClientRect().right,wrapped:code.getAttribute('data-code-wrap'),client:pre.clientWidth,scroll:pre.scrollWidth,overflow:getComputedStyle(pre).overflowX};
      })()`);
      reports.push({ width, query, ...result });
    }
    writeFileSync(reportPath, JSON.stringify(reports)); win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
