const { app, BrowserWindow, nativeTheme } = require('electron');
const { writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const [htmlPath, reportPath] = process.argv.slice(2);
app.setPath('userData', join(dirname(htmlPath), 'browser-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 700, webPreferences: { sandbox: true, backgroundThrottling: false } });
  const evaluate = source => win.webContents.executeJavaScript(source);
  const wait = async source => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (await evaluate(source)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${source}`);
  };
  try {
    await win.loadURL(pathToFileURL(htmlPath).href);
    const reports = [];
    for (const width of [1100, 400]) for (const scheme of ['light', 'dark']) {
      // Opposite OS preference detects accidental loss of the embedding client's theme.
      nativeTheme.themeSource = scheme === 'light' ? 'dark' : 'light';
      win.setContentSize(width, 700);
      await wait(`window.innerWidth === ${width}`);
      await evaluate(`window.renderCorners('${scheme}')`);
      await wait('window.framesReady === 4');
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      // Flush compositor damage before taking cropped pixel samples.
      await win.webContents.capturePage();
      const rows = await evaluate(`Array.from(document.querySelectorAll('iframe'),frame=>{
        const r=frame.getBoundingClientRect(),w=frame.contentWindow,d=w.document;
        return {native:frame.dataset.native==='true',authoredScheme:frame.dataset.authoredScheme==='true',
          x:r.x,y:r.y,width:r.width,height:r.height,frameScheme:getComputedStyle(frame).colorScheme,
          htmlScheme:w.getComputedStyle(d.documentElement).colorScheme,
          preferredDark:d.documentElement.dataset.preferredDark==='true',
          cardColor:w.getComputedStyle(d.querySelector('.card')).backgroundColor};
      })`);
      for (const row of rows) {
        const picture = await win.webContents.capturePage({ x: Math.round(row.x), y: Math.round(row.y), width: Math.floor(row.width), height: Math.floor(row.height) });
        const bitmap = picture.toBitmap(), size = picture.getSize();
        const pixel = (x, y) => Array.from(bitmap.subarray((y * size.width + x) * 4, (y * size.width + x) * 4 + 4));
        row.corners = [pixel(0, 0), pixel(size.width - 1, 0), pixel(0, size.height - 1), pixel(size.width - 1, size.height - 1)];
        reports.push({ width, scheme, ...row });
      }
    }
    writeFileSync(reportPath, JSON.stringify(reports, null, 2));
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
