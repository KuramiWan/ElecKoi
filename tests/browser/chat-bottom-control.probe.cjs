const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { dirname } = require('node:path');
const { pathToFileURL } = require('node:url');
const [htmlPath, reportPath] = process.argv.slice(2);
app.setPath('userData', dirname(htmlPath));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message.slice(0, 500)); });
  const evaluate = source => win.webContents.executeJavaScript(source);
  const pause = () => new Promise(resolve => setTimeout(resolve, 60));
  async function waitFor(source) {
    for (let attempt = 0; attempt < 80; attempt++) { if (await evaluate(source)) return; await pause(); }
    throw new Error(`Timed out: ${source}; ${await evaluate('document.body.innerText.slice(0, 180)')}`);
  }
  const measure = () => evaluate(`(() => {
    const scroller = document.querySelector('[data-conversation-scroll]'), composer = document.querySelector('[data-composer-seat]');
    const button = document.querySelector('[data-chat-to-bottom] button'), rect = button?.getBoundingClientRect();
    return { composerTop: composer.getBoundingClientRect().top, buttonTop: rect?.top, buttonBottom: rect?.bottom,
      scrollTop: scroller.scrollTop, floor: scroller.scrollHeight - scroller.clientHeight,
      following: Boolean(document.querySelector('[data-chat-following-tail]')) };
  })()`);
  try {
    const reports = [];
    for (const [width, height] of [[1200, 800], [400, 760]]) {
      win.setContentSize(width, height);
      await win.loadURL(pathToFileURL(htmlPath).href);
      await waitFor('Boolean(document.querySelector("[data-chat-following-tail]"))');
      await evaluate(`(() => { const element = document.querySelector('[data-conversation-scroll]'); element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); element.dispatchEvent(new Event('scrollend')); })()`);
      await waitFor('Boolean(document.querySelector("[data-chat-to-bottom] button"))');
      const long = await measure();
      await evaluate('window.chatBottomFixture.setCount(2)');
      await waitFor('document.querySelectorAll(".synthetic-message").length === 2');
      await pause();
      const shortened = await measure();
      await evaluate('window.chatBottomFixture.setCount(24)');
      await waitFor('document.querySelectorAll(".synthetic-message").length === 24');
      await pause();
      const restored = await measure();
      await evaluate('document.querySelector("[data-chat-to-bottom] button").click()');
      await waitFor('Boolean(document.querySelector("[data-chat-following-tail]"))');
      const returned = await measure();
      reports.push({ width, height, long, shortened, restored, returned });
    }
    writeFileSync(reportPath, JSON.stringify(reports));
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
