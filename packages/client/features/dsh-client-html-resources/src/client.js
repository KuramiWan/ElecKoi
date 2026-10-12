window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-html-resources',
  factory() {
    async function loadScript(url) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = url;
        script.onload = resolve; script.onerror = () => reject(new Error(`HTML library index failed to load: ${url}`));
        document.head.appendChild(script);
      });
    }
    async function apply(ctx) {
      const baseUrl = window.__ELECKOI_HTML_RESOURCES__?.baseUrl;
      if (!baseUrl) throw new Error('HTML presentation resource URL is unavailable');
      await loadScript(baseUrl + 'html-libraries.global.js');
      const { HtmlResourcesClient } = await import(baseUrl + 'client/runtime.js');
      const runtime = new HtmlResourcesClient({ window, sdk: window.ElecKoiHtmlLibraries, assetsBaseUrl: baseUrl });
      ctx.provide('eleckoiHtmlResources', runtime);
      await ctx.effect(async () => {
        runtime.start();
        return () => runtime.dispose();
      }, 'eleckoi: HTML presentation resources');
    }
    return { apply };
  }
});
