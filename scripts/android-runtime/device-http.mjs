import { request } from 'node:http'

/** ADB changes the TCP destination, while DSH cookies and request trust keep the phone authority. */
export function deviceHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      method: options.method ?? 'GET', headers: options.headers,
      signal: AbortSignal.timeout(90_000)
    }, incoming => {
      const chunks = []
      let size = 0
      incoming.on('data', chunk => {
        size += chunk.length
        if (size > 32 * 1024 * 1024) incoming.destroy(new Error('Device probe response exceeds 32 MiB'))
        else chunks.push(chunk)
      })
      incoming.on('error', reject)
      incoming.on('end', () => {
        const headers = new Headers()
        for (let index = 0; index < incoming.rawHeaders.length; index += 2)
          headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1])
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers }))
      })
    })
    outgoing.on('error', reject)
    outgoing.end(options.body)
  })
}
