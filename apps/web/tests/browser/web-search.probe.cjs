const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const [html, report] = process.argv.slice(2);
app.setPath('userData', join(dirname(html), 'browser-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 390, height: 1000, webPreferences: { sandbox: true, backgroundThrottling: false } });
  const run = source => win.webContents.executeJavaScript(source);
  try {
    await win.loadURL(pathToFileURL(html).href);
    for (let i = 0; i < 100 && !await run('!!document.querySelector(".web-search-config")'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    const layouts = [];
    for (const theme of ['light', 'dark']) for (const width of [320, 390, 1000]) {
      win.setContentSize(width, 1100);
      await run(`document.documentElement.dataset.theme='${theme}';document.querySelector('main').classList.toggle('mobile-agent-tools',${width < 600})`);
      layouts.push(await run(`({theme:'${theme}', width:${width}, documentWidth:document.documentElement.scrollWidth, viewport:innerWidth, controls:[...document.querySelectorAll('input,button')].map(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,label:n.getAttribute('aria-label')||n.textContent}))})`));
    }
    const officialOnly = await run(`({inputs:document.querySelectorAll('input').length,search:[...document.querySelectorAll('[aria-label="搜索方式"] strong')].map(n=>n.textContent),buttons:document.querySelectorAll('.web-search-config button').length,fetch:document.querySelectorAll('[aria-label="网页抓取方式"]').length})`);
    await run(`[...document.querySelectorAll('.web-search-mode button')].find(n=>n.querySelector('strong')?.textContent==='DeepSeek').click()`);
    await run(`[...document.querySelectorAll('.web-search-mode button')].find(n=>n.textContent.startsWith('Tavily')).click()`);
    await new Promise(resolve => setTimeout(resolve, 30));
    await run(`(() => { const n=document.querySelector('[aria-label="返回结果数量"]');n.focus();n.select(); })()`);
    await win.webContents.insertText('2');
    await new Promise(resolve => setTimeout(resolve, 30));
    await win.webContents.insertText('0');
    await new Promise(resolve => setTimeout(resolve, 30));
    const countSnapshot = await run(`({value:document.querySelector('[aria-label="返回结果数量"]').value})`);
    // This hidden test window has no OS focus; emit the field's focusout explicitly.
    await run(`(() => { const n=document.querySelector('[aria-label="返回结果数量"]');n.blur();n.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); })()`);
    await new Promise(resolve => setTimeout(resolve, 30));
    await run(`const n=document.querySelector('[aria-label="Tavily API Key"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'synthetic-key');n.dispatchEvent(new Event('input',{bubbles:true}));`);
    await new Promise(resolve => setTimeout(resolve, 30));
    await run(`[...document.querySelectorAll('button')].find(n=>n.textContent==='保存并测试').click()`);
    await new Promise(resolve => setTimeout(resolve, 50));
    writeFileSync(report, JSON.stringify({ layouts, officialOnly, countSnapshot, calls: await run('window.webSearchFixture.calls'), message: await run('document.body.textContent'), cleared: await run(`document.querySelector('[aria-label="Tavily API Key"]').value===''`) }));
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
