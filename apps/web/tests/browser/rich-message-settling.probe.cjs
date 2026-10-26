const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const [htmlPath, reportPath] = process.argv.slice(2);
app.setPath('userData', join(dirname(htmlPath), 'profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 800,
    webPreferences: { sandbox: true, backgroundThrottling: false } });
  const evaluate = source => win.webContents.executeJavaScript(source);
  const pause = () => new Promise(resolve => setTimeout(resolve, 25));
  const reports = [];
  try {
    for (const width of [1100, 400]) for (const enabled of [false, true]) for (const native of [false, true]) {
      win.setContentSize(width, 800);
      await win.loadURL(pathToFileURL(htmlPath).href);
      await evaluate(`window.renderPresentation(${JSON.stringify({ enabled, native })})`);
      for (const key of ['first', 'returned']) {
        if (key === 'returned') {
          await evaluate(`window.renderPresentation({ key:'other' })`);
          await pause();
          await evaluate(`window.renderPresentation(${JSON.stringify({ enabled, native, key })})`);
        }
        const deadline = Date.now() + 5000;
        let state;
        do {
          await pause();
          state = await evaluate(`({
            stages:[...document.querySelectorAll('.rich-message-staging')].map(node=>node.getAttribute('aria-hidden')),
            heights:[...document.querySelectorAll('iframe')].map(frame=>frame.style.height),
            modules:[...document.querySelectorAll('iframe')].map(frame=>frame.contentWindow.syntheticModuleOrder || null),
            raw:document.body.innerText.includes('[TOP]'),
            scrollTop:document.querySelector('[data-conversation-scroll]')?.scrollTop
          })`);
          if (state.stages.length === 1 && state.stages[0] === 'false' && state.heights.length === 3
            && state.heights.every(height => height === '600px') && !state.raw) break;
        } while (Date.now() < deadline);
        reports.push({ width, enabled, native, key, ...state });
        if (state.stages.length !== 1 || state.stages[0] !== 'false' || state.heights.length !== 3
          || state.heights.some(height => height !== '600px') || state.raw) {
          throw new Error(`Rich presentation did not settle: ${JSON.stringify(reports.at(-1))}`);
        }
        if (!native) {
          const value = () => evaluate(`(()=>{const frames=[...document.querySelectorAll('iframe')];return {
            names:frames.map(frame=>frame.name),values:frames.map(frame=>frame.contentDocument.querySelector('[data-native-variable]')?.textContent || null),
            diagnostics:document.querySelectorAll('.rich-message-diagnostics').length}})()`);
          const initial = await value();
          if (JSON.stringify(initial.values) !== JSON.stringify([null, null, '7']) || initial.diagnostics) throw new Error(`Variable initialization failed: ${JSON.stringify(initial)}`);
          await evaluate(`window.updateSyntheticVariables({counter:11})`);
          const updateDeadline = Date.now() + 5000;
          let updated;
          do { await pause(); updated = await value(); } while (updated.values[2] !== '11' && Date.now() < updateDeadline);
          if (JSON.stringify(updated.values) !== JSON.stringify([null, null, '11']) || updated.diagnostics
            || JSON.stringify(initial.names) !== JSON.stringify(updated.names)) throw new Error(`Variable notification failed: ${JSON.stringify(updated)}`);
        }
      }
    }
    writeFileSync(reportPath, JSON.stringify(reports));
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
