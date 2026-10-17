import type { WebSearchResult, WebFetchResult } from '@deepseek-ai/dsh-web'
export declare const DEEPSEEK_API_PROVIDER: 'eleckoi-deepseek-api'
export declare const DEEPSEEK_WEB_KEY_REF: 'DEEPSEEK_WEB_API_KEY'
export declare const DEEPSEEK_WEB_NAMESPACE: 'eleckoi-web-deepseek'
export declare function validateFetchUrl(value: string): string
export declare function searchDeepSeek(apiKey: string, input: { query: string; count: number; need_content?: boolean; ori_question?: string | null; localization?: string }, signal?: AbortSignal): Promise<WebSearchResult>
export declare function fetchDeepSeek(apiKey: string, input: { url: string }, signal?: AbortSignal): Promise<WebFetchResult>
export declare function testDeepSeekConnection(apiKey: string, signal?: AbortSignal): Promise<{ ok: true; provider: 'deepseek_api'; search: true; fetch: true }>
