export interface TavernCompatibilityOptions {
  bridge: { snapshot(): Promise<Record<string, any>>; invoke(method: string, params: Record<string, any>): Promise<any> };
  shared?: Record<string, any>;
  context: { conversationId: string; scriptId?: string; messageId?: string; characterId?: string };
  native: { request(method: string, params: Record<string, any>): Promise<any>; subscribe?(event: string, listener: (value: any) => void): () => void };
  ui?: { formatMessage(text: string, settings?: any): string | Promise<string>; refreshMessage(id: string | number, settings?: any): void | Promise<void> };
  tokens?: { count(text: string): number; encode(text: string, type?: any): number[]; decode(tokens: number[], type?: any): string };
  report?(error: unknown): void;
  resourceUrl?: string;
}
export interface TavernCompatibilityController {
  ready: Promise<void>;
  refresh(): Promise<Record<string, any>>;
  flush(): Promise<void>;
  dispose(): void;
  readonly helper: Record<string, any> | undefined;
  readonly SillyTavern: { getContext(): Record<string, any> } | undefined;
}
export function installTavernCompatibility(view: Window, options: TavernCompatibilityOptions): TavernCompatibilityController;
export function createCompatibilitySharedState(): Record<string, any>;
export const COMPATIBILITY_VERSION: string;
