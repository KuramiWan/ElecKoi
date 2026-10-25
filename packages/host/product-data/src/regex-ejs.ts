import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'
import { foldFailure } from '@shared/foundation/failure'
import { Worker } from 'node:worker_threads'
import { compileRegexEjs, createRegexEjsLocals, type RegexEjsInput } from '@shared/foundation/regex/RegexEjs.js'
import { hasRegexEjsOutput, prepareRegexEjsSource } from '@shared/foundation/regex/RegexEjsMarkers'

/** Compute author text in a disposable worker realm without passing Host objects. */
export async function renderRegexEjs(input: RegexEjsInput, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  if (!hasRegexEjsOutput(input.content)) return input.content
  const fn = compileRegexEjs(prepareRegexEjsSource(input.content), input.filename).toString()
  const code = `(${fn})((${createRegexEjsLocals.toString()})(${JSON.stringify(input)}, ${JSON.stringify(ELECKOI_FAILURE_CODES)}))`
  return await new Promise<string>((resolve, reject) => {
    const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
      const vm=require('node:vm');
      Promise.resolve().then(()=>new vm.Script(workerData).runInNewContext(Object.create(null)))
        .then(content=>parentPort.postMessage({content}),error=>parentPort.postMessage({error:error?.isDSHRemoteError === true && typeof error.code === 'string'
          ? {isDSHRemoteError:true,code:error.code,message:String(error.message),details:error.details}
          : String(error?.message??error)}));`, { eval: true, workerData: code })
    let done = false
    const finish = (error?: unknown, content?: string) => {
      if (done) return
      done = true; signal?.removeEventListener('abort', cancel); void worker.terminate()
      if (error) reject(error); else resolve(content!)
    }
    const cancel = () => finish(signal?.reason ?? new Error('正则 EJS 计算已取消。'))
    worker.on('message', (value: { content?: unknown; error?: unknown }) => {
      if (typeof value.content === 'string') finish(undefined, value.content)
      else if (value.error && typeof value.error === 'object') {
        const failure = foldFailure(value.error)
        finish(new DesktopError(failure.code, failure.message, failure.details))
      } else finish(new Error(typeof value.error === 'string' ? value.error : '正则 EJS 返回无效结果。'))
    })
    worker.on('error', finish)
    worker.on('exit', code => { if (!done) finish(new Error(`正则 EJS 计算进程提前结束：${code}`)) })
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
  })
}

export { hasRegexEjsOutput } from '@shared/foundation/regex/RegexEjsMarkers'
