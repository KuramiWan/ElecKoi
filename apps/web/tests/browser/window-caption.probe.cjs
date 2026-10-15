const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { basename, dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const [htmlPath, reportPath] = process.argv.slice(2);
process.on('uncaughtException', error => {console.error(error);app.exit(1)});
app.setPath('userData', dirname(htmlPath));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false,sandbox:true,offscreen:true}});
  const reports = [];
  try {
    for (const [width, query] of [[1440, ''], [1200, '?rightbar'], [1000, '?collapsed&rightbar']]) {
      win.setContentSize(width, 640);
      await win.loadURL(pathToFileURL(htmlPath).href + query);
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        ready = await win.webContents.executeJavaScript('Boolean(document.querySelector(".side-panel-brand .eleckoi-wordmark")) && Math.abs(innerWidth - ' + width + ') <= 1');
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!ready) {
        const state = await win.webContents.executeJavaScript('JSON.stringify({width:innerWidth,html:document.body.innerHTML.slice(0,1000)})');
        throw new Error('Caption fixture did not render at width ' + width + ': ' + state);
      }
      await win.webContents.executeJavaScript('document.fonts.ready');
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      reports.push(await win.webContents.executeJavaScript(`(() => {
        const shell=document.querySelector('.main-window-shell').getBoundingClientRect();
        const rect=selector=>document.querySelector(selector).getBoundingClientRect();
        const center=box=>box.top+box.height/2-shell.top;
        const mark=rect('.rail-brand-seat');
        const name=rect('.eleckoi-wordmark-name');
        const toggle=rect(${JSON.stringify(query.includes('collapsed') ? '.side-panel-expand-button' : '.side-panel-collapse-button')});
        const windowCenters=Array.from(document.querySelectorAll('.window-control-button span'), node=>center(node.getBoundingClientRect()));
        const header=rect('.client-titlebar');
        const main=rect('.main-panel-content');
        const rightbar=rect('.dsh-rightbar-column');
        const resize=rect('.rightbar-resizer');
        const strip=getComputedStyle(document.querySelector('.dsh-rightbar-column'),'::before');
        return {viewport:innerWidth,collapsed:${query.includes('collapsed')},rightbar:${query.includes('rightbar')},
          markCenter:center(mark),nameCenter:center(name),toggleCenter:center(toggle),windowCenters,
          markTop:mark.top-shell.top,markLeft:mark.left-shell.left,captionHeight:header.height,
          mainTop:main.top-shell.top,rightbarTop:rightbar.top-shell.top,resizeTop:resize.top-shell.top,
          stripTop:Number.parseFloat(strip.top),stripHeight:Number.parseFloat(strip.height)};
      })()`));
      const image = await win.webContents.capturePage({x:0,y:0,width,height:reports.at(-1).captionHeight});
      writeFileSync(join(dirname(reportPath), basename(reportPath, '.json') + '-' + width + '.png'), image.toPNG());
    }
    writeFileSync(reportPath, JSON.stringify(reports, null, 2));
    win.destroy();app.exit(0);
  } catch (error) {console.error(error);win.destroy();app.exit(1)}
});
