import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { deviceHttp } from '../device-http.mjs'

describe('ADB HTTP authority transport', () => {
  it('preserves the phone Host and Origin independently of the forwarded TCP port', async () => {
    const server = createServer((request, response) => {
      response.writeHead(303, { 'set-cookie': 'probe=synthetic; HttpOnly', location: '/' })
      response.end(JSON.stringify({ host: request.headers.host, origin: request.headers.origin }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing HTTP address')
      const response = await deviceHttp(`http://127.0.0.1:${address.port}/`, {
        headers: { host: '127.0.0.1:45678', origin: 'http://127.0.0.1:45678' }
      })
      expect(response.status).toBe(303)
      expect(response.headers.get('set-cookie')).toBe('probe=synthetic; HttpOnly')
      expect(await response.json()).toEqual({ host: '127.0.0.1:45678', origin: 'http://127.0.0.1:45678' })
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
