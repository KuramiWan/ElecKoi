window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-html-resources',
  factory(require) {
    // 边界⑥ 的信封拆解只有一份实现（@eleckoi/dsh-product-api 的 client 面）。
    const { productFailure, ELECKOI_FAILURE_CODES } = require('@eleckoi/dsh-product-api')
    async function loadScript(url) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = url;
        script.onload = resolve; script.onerror = () => reject(productFailure(ELECKOI_FAILURE_CODES.netOperationFailed, `HTML library index failed to load: ${url}`, { operation: 'load', what: 'HTML 库索引' }));
        document.head.appendChild(script);
      });
    }
    async function apply(ctx) {
      const baseUrl = window.__ELECKOI_HTML_RESOURCES__?.baseUrl;
      if (!baseUrl) throw productFailure(ELECKOI_FAILURE_CODES.internal, 'HTML presentation resource URL is unavailable', { what: 'HTML 显示资源地址' })
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
