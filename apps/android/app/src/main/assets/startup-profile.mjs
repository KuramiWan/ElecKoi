import { Session } from 'node:inspector/promises'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const inspector = new Session()
inspector.connect()
await inspector.post('Profiler.enable')
await inspector.post('Profiler.start')
console.info(`ElecKoiStartup node entry at ${Math.round(performance.now())} ms`)
// One bounded debug sample; every launch overwrites the same temporary file.
const sample = setTimeout(async () => {
  try {
    const { profile } = await inspector.post('Profiler.stop')
    await writeFile(join(process.env.TMPDIR, 'eleckoi-startup.cpuprofile'), JSON.stringify(profile))
    console.info('ElecKoiStartup CPU sample complete')
  } catch (error) { console.error('ElecKoiStartup CPU sample failed', error) }
  finally { inspector.disconnect() }
}, 20_000)
sample.unref()
await import(pathToFileURL(process.env.ELECKOI_HOST_ENTRYPOINT).href)
console.info(`ElecKoiStartup host entry imported at ${Math.round(performance.now())} ms`)
