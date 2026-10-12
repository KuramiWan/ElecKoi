import { randomInt } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

const RESPONSE_LIMIT = 32 * 1024 * 1024
const ERROR_LIMIT = 64 * 1024

/** One Host queue serializes NovelAI requests across selected preset instances. */
export function createNovelAiImageGeneration(ctx) {
  let queue = Promise.resolve()
  const lifetime = new AbortController()
  async function generate(entry, settings, frames, callerSignal) {
    const signal = AbortSignal.any([callerSignal, lifetime.signal])
    const previous = queue
    let release
    const saved = []
    queue = new Promise(resolve => { release = resolve })
    try {
      await previous
      signal.throwIfAborted()
      if (!entry.credentialRef) throw new Error('NovelAI 配置没有密钥引用，请重新保存模型配置。')
      const key = (await ctx.credentials.resolve(credentialRef(entry.credentialRef)))?.value?.trim()
      if (!key) throw new Error('NovelAI 配置尚未保存 API Key。')
      const base = new URL(entry.base_url?.trim() || 'https://image.novelai.net')
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('NovelAI API 地址不正确。')
      const pathname = base.pathname.replace(/\/+$/, '')
      base.pathname = pathname.endsWith('/ai/generate-image') ? pathname : `${pathname}/ai/generate-image`
      for (const frame of frames) {
        signal.throwIfAborted()
        try {
          const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(180000)])
          const seed = frame.seed ?? randomInt(0, 4294967296)
          const payload = novelAiRequest(entry.model.trim(), settings, frame, seed)
          const response = await fetch(base, { method: 'POST', redirect: 'error', signal: requestSignal,
            headers: { ...entry.custom_headers, Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          const body = await readBody(response, response.ok ? RESPONSE_LIMIT : ERROR_LIMIT)
          if (!response.ok) throw new Error(`NovelAI 生图失败（HTTP ${response.status}）：${body.replaceAll(key, '[已隐藏]').slice(0, 600)}`)
          let result
          try { result = JSON.parse(body) } catch { throw new Error('NovelAI 返回的生图结果不是合法 JSON。') }
          if (!Array.isArray(result.images) || result.images.length !== 1) throw new Error('NovelAI 没有返回本次请求的唯一图片。')
          const encoded = result.images[0]?.image
          if (typeof encoded !== 'string' || !encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('NovelAI 返回的图片编码不正确。')
          signal.throwIfAborted()
          const attachment = await ctx.attachments.saveImage({ data: new Uint8Array(Buffer.from(encoded, 'base64')), mediaType: 'image/png', name: `分镜-${frame.id}.png` })
          saved.push({ id: frame.id, after_paragraph: frame.after_paragraph, seed, attachment })
          signal.throwIfAborted()
        } catch (error) {
          signal.throwIfAborted()
          const reason = String(error?.message || error).replaceAll(key, '[已隐藏]')
          if (!saved.length) throw new Error(reason)
          return { status: 'partial', frames: saved, error: `分镜 ${frame.id} 生成失败：${reason}` }
        }
      }
      return { status: 'complete', frames: saved }
    } catch (error) {
      if (saved.length && signal.aborted) await ctx.eleckoiSessionEditor.discardGeneratedImages(saved.map(frame => frame.attachment))
      throw error
    } finally { release() }
  }
  return { generate,
    async close() { lifetime.abort(new Error('生图运行环境已关闭。')); await queue }
  }
}

export function novelAiRequest(model, settings, frame, seed) {
  const prompt = [settings.promptPrefix.trim(), frame.prompt.trim()].filter(Boolean).join(', ')
  const negative = [frame.negative_prompt?.trim(), settings.negativePrompt.trim()].filter(Boolean).join(', ')
  const caption = value => ({ caption: { base_caption: value, char_captions: [] }, use_coords: false, use_order: true })
  return { action: 'generate', input: prompt, model, parameters: {
    params_version: 3, width: settings.width, height: settings.height, steps: settings.steps, scale: settings.scale,
    sampler: settings.sampler, n_samples: 1, seed, negative_prompt: negative, noise_schedule: 'karras',
    qualityToggle: true, ucPreset: 0, dynamic_thresholding: false, cfg_rescale: 0.0, image_format: 'png',
    v4_prompt: caption(prompt), v4_negative_prompt: caption(negative)
  } }
}

async function readBody(response, limit) {
  if (!response.body) throw new Error('NovelAI 返回了空响应。')
  const chunks = [], reader = response.body.getReader()
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('NovelAI 响应超过大小限制。')
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
}
