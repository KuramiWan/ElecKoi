import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { JSDOM } from 'jsdom'

const { values } = parseArgs({ options: { adb: { type: 'string' }, serial: { type: 'string' }, variant: { type: 'string', default: 'compat' }, 'expect-missing': { type: 'boolean' } } })
assert(values.serial, 'Pass the exact --serial of the development device')
assert(['standard', 'compat'].includes(values.variant), 'Pass an explicit standard or compat variant')
const executable = values.adb || resolve(process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME, 'platform-tools/adb.exe')
const run = promisify(execFile)
const adb = async args => (await run(executable, ['-s', values.serial, ...args], { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim()
const output = resolve('build/android-runtime/choice-probe')
const records = []
const requests = []
let cookie, port
const fixture = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#fff;color:#171717;font:18px sans-serif}main{padding:24px;display:grid;gap:20px;--mobile-system-bar-bg:#fff}label{display:grid;gap:8px}select,button{width:100%;min-height:48px;font:inherit}html[data-theme=dark] body{background:#141414;color:#eee}html[data-theme=dark] main{--mobile-system-bar-bg:#141414}</style></head>
<body><div id="eleckoi-root"><main class="main-window-shell mobile-shell">
<label>合成单选框<select id="single" aria-label="合成单选框"><option value="alpha">单选甲</option><option value="beta">单选乙</option></select></label>
<label>合成分组框<select id="grouped" aria-label="合成分组框"><option value="base">初始项</option><optgroup label="停用组" disabled><option value="disabled-group">组内停用项</option></optgroup><optgroup label="可用组"><option value="disabled-item" disabled>单独停用项</option><option value="gamma">可用选项</option></optgroup></select></label>
<label>合成多选框<select id="multiple" multiple aria-label="合成多选框"><option value="alpha" selected>多选甲</option><option value="beta">多选乙</option><option value="disabled" disabled>多选停用项</option></select></label>
<label>合成更新框<select id="updated" aria-label="合成更新框"><option value="before">更新前</option></select></label>
<button id="theme">合成深色模式</button><button id="update">准备更新选项</button><button id="remove">准备移除选择框</button>
</main></div><script>
const record=value=>fetch('/record',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
window.addEventListener('error',event=>record({type:'error',message:event.message}));
for(const select of document.querySelectorAll('select')) select.addEventListener('change',()=>record({type:'change',id:select.id,values:[...select.selectedOptions].map(option=>option.value)}));
document.getElementById('theme').onclick=()=>{document.documentElement.dataset.theme='dark';record({type:'theme'})};
document.getElementById('update').onclick=()=>{setTimeout(()=>{document.getElementById('updated').innerHTML='<option value="after">更新后</option><option value="new">新增选项</option>';record({type:'updated'})},2200)};
document.getElementById('remove').onclick=()=>{setTimeout(()=>{document.getElementById('updated').remove();record({type:'removed'})},2200)};
const ready=setInterval(()=>{if(window.ElecKoiAndroid&&document.documentElement.dataset.eleckoiBrowser){clearInterval(ready);record({type:'ready',browser:document.documentElement.dataset.eleckoiBrowser,width:innerWidth,height:innerHeight,controls:[...document.querySelectorAll('select,button')].map(node=>{const r=node.getBoundingClientRect();return {id:node.id,label:node.getAttribute('aria-label')||node.textContent,x:r.x,y:r.y,width:r.width,height:r.height}})})}},50);
</script></body></html>`
const server = createServer(async (request, response) => {
  requests.push({ method: request.method, path: request.url })
  if (request.url === '/record') {
    let body = ''
    for await (const chunk of request) { body += chunk; assert(body.length < 4096) }
    records.push(JSON.parse(body)); response.writeHead(204); response.end(); return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': cookie })
  response.end(fixture)
})
const delay = ms => new Promise(done => setTimeout(done, ms))
async function wait(condition, description, timeout = 20000) {
  const deadline = Date.now() + timeout
  do { const value = await condition(); if (value) return value; await delay(150) } while (Date.now() < deadline)
  throw new Error(`Timed out: ${description}`)
}
async function hierarchy() {
  await adb(['shell', 'uiautomator', 'dump', '/data/local/tmp/eleckoi-choice-probe.xml'])
  const xml = await adb(['shell', 'cat', '/data/local/tmp/eleckoi-choice-probe.xml'])
  const dom = new JSDOM(xml, { contentType: 'application/xml' })
  const nodes = [...dom.window.document.querySelectorAll('node')].map(node => Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value])))
    .filter(node => node.package === 'com.eleckoi.app.dev')
  dom.window.close(); return nodes
}
function exact(nodes, label) {
  const matches = nodes.filter(node => node.text === label || node['content-desc'] === label)
  assert(matches.length <= 1, `Ambiguous UI label: ${label}`)
  return matches[0]
}
async function tap(node) {
  assert(node, 'UI element is absent')
  const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.bounds)
  assert(bounds, 'UI element has no valid bounds')
  await adb(['shell', 'input', 'tap', String(Math.round((Number(bounds[1]) + Number(bounds[3])) / 2)), String(Math.round((Number(bounds[2]) + Number(bounds[4])) / 2))])
}
async function tapLabel(label) {
  const ready = records.find(record => record.type === 'ready'), control = ready?.controls.find(control => control.label === label)
  if (!control) { await tap(await wait(async () => exact(await hierarchy(), label), label)); return }
  const surfaces = (await hierarchy()).filter(node => node['resource-id'] === 'com.eleckoi.app.dev:id/browser_surface')
  assert.equal(surfaces.length, 1, 'Expected the app-owned browser surface')
  const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(surfaces[0].bounds)
  assert(bounds)
  const scale = (Number(bounds[3]) - Number(bounds[1])) / ready.width
  const x = Math.round(Number(bounds[1]) + (control.x + control.width / 2) * scale), y = Math.round(Number(bounds[2]) + (control.y + control.height / 2) * scale)
  await adb(['shell', 'input', 'tap', String(x), String(y)])
}
async function button(id) {
  const matches = (await hierarchy()).filter(node => node['resource-id'] === `android:id/${id}`)
  assert.equal(matches.length, 1, `Expected one native ${id}`); await tap(matches[0])
}
function change(id, values) { return records.some(record => record.type === 'change' && record.id === id && JSON.stringify(record.values) === JSON.stringify(values)) }
async function screenshot(name) {
  const capture = await run(executable, ['-s', values.serial, 'exec-out', 'screencap', '-p'], { windowsHide: true, timeout: 10000, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 })
  await writeFile(resolve(output, name + '.png'), capture.stdout)
}

try {
  assert.match(await adb(['shell', 'pm', 'path', 'com.eleckoi.app.dev']), /^package:/)
  await adb(['shell', 'run-as', 'com.eleckoi.app.dev', 'pwd'])
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  port = server.address().port
  const name = 'dsh-auth-' + createHash('sha256').update(`127.0.0.1:${port}`).digest('base64url')
  cookie = `${name}=synthetic; Path=/; HttpOnly; SameSite=Strict`
  await mkdir(output, { recursive: true })
  await adb(['reverse', `tcp:${port}`, `tcp:${port}`])
  await adb(['shell', 'am', 'force-stop', 'com.eleckoi.app.dev'])
  await adb(['shell', 'am', 'start', '-W', '-n', 'com.eleckoi.app.dev/com.eleckoi.app.MainActivity', '--es', 'eleckoi.previewUrl', `http://127.0.0.1:${port}/`])
  await wait(() => records.find(record => record.type === 'ready'), 'synthetic Gecko page readiness', 30000)
  assert.equal(records.find(record => record.type === 'ready').browser, values.variant)
  await tapLabel('合成单选框')
  if (values['expect-missing']) {
    const nodes = await hierarchy()
    assert(!exact(nodes, '单选乙'), 'Choice prompt was unexpectedly implemented')
    assert(!records.some(record => record.type === 'change'), 'Missing prompt unexpectedly changed the selection')
    await screenshot('missing-prompt')
    await writeFile(resolve(output, 'before.json'), JSON.stringify({ missingPrompt: true, records }, null, 2))
    console.log('Reproduced: clicking a native select opens no picker and produces no change event.')
  } else {
    await tapLabel('单选乙')
    await wait(() => change('single', ['beta']), 'single choice value returned to the document')
    await tapLabel('合成单选框')
    assert.equal(exact(await hierarchy(), '单选乙').checked, 'true')
    await adb(['shell', 'input', 'keyevent', '4'])
    await wait(async () => !exact(await hierarchy(), '单选甲'), 'back dismissed native picker')
    assert.equal(records.filter(record => record.type === 'change' && record.id === 'single').length, 1)
    await tapLabel('合成分组框')
    const nodes = await hierarchy()
    for (const label of ['停用组', '组内停用项', '单独停用项']) assert.equal(exact(nodes, label).enabled, 'false')
    await tapLabel('可用选项')
    await wait(() => change('grouped', ['gamma']), 'grouped choice ID returned to the document')
    await tapLabel('合成多选框')
    assert.equal(exact(await hierarchy(), '多选甲').checked, 'true')
    await tapLabel('多选乙'); await button('button1')
    await wait(() => change('multiple', ['alpha', 'beta']), 'multiple choice IDs returned to the document')
    await tapLabel('合成深色模式'); await tapLabel('合成单选框')
    await screenshot('dark-picker'); await button('button2')
    await tapLabel('准备更新选项'); await tapLabel('合成更新框')
    await wait(async () => exact(await hierarchy(), '新增选项'), 'open picker refreshed after option mutation')
    await tapLabel('新增选项'); await wait(() => change('updated', ['new']), 'updated choice ID returned to the document')
    await tapLabel('准备移除选择框'); await tapLabel('合成更新框')
    await wait(() => records.some(record => record.type === 'removed'), 'select removed')
    await wait(async () => !exact(await hierarchy(), '新增选项'), 'picker dismissed when its select was removed')
    await writeFile(resolve(output, `after-${values.variant}.json`), JSON.stringify({ passed: true, records }, null, 2))
    console.log('Passed: single and multiple choices, selected state, disabled options/groups, cancel/back, dark picker, option updates and document dismissal.')
  }
} catch (error) {
  if (port) {
    const nodes = await hierarchy()
    if (nodes.length) await screenshot('probe-failure')
    await writeFile(resolve(output, 'failure.json'), JSON.stringify({ message: error.message, requests, records, nodes }, null, 2))
  }
  throw error
} finally {
  if (port) {
    await adb(['shell', 'am', 'force-stop', 'com.eleckoi.app.dev'])
    await adb(['reverse', '--remove', `tcp:${port}`])
    await adb(['shell', 'rm', '-f', '/data/local/tmp/eleckoi-choice-probe.xml'])
  }
  server.closeAllConnections(); await new Promise(done => server.close(done))
}
