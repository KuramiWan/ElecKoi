export const BROWSER_LIBRARY_SCRIPTS: readonly string[];
export const BROWSER_LIBRARY_STYLES: readonly string[];
export const BROWSER_LIBRARY_VERSIONS: Readonly<Record<string, string>>;
export function browserModuleImports(assetsBaseUrl: string): Record<string, string>;
export function installBrowserLibraries(window: Window, baseUrl: string): Promise<{ ready: true; versions: Readonly<Record<string, string>> }>;
