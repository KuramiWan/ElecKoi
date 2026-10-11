window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-tavern-shared',
  factory() {
    async function loadScript(url) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = url;
        script.onload = resolve; script.onerror = () => reject(new Error(`Shared Client script failed to load: ${url}`));
        document.head.appendChild(script);
      });
    }
    async function apply(ctx) {
      const baseUrl = window.__ELECKOI_COMPATIBILITY_ASSETS__?.baseUrl;
      if (!baseUrl) throw new Error('HTML presentation resource URL is unavailable');
      await loadScript(baseUrl + 'assets/tavern-shared.global.js');
      const { TavernSharedClient } = await import(baseUrl + 'client/runtime.js');
      const runtime = new TavernSharedClient({ window, sdk: window.ElecKoiTavernShared, assetsBaseUrl: baseUrl });
      ctx.provide('eleckoiTavernShared', runtime);
      await ctx.effect(async () => {
        runtime.start();
        return () => runtime.dispose();
      }, 'eleckoi: HTML presentation resources');
    }
    return { apply };
  }
});
