export function browserModuleImports(assetsBaseUrl) {
  const assets = assetsBaseUrl;
  return {
    zod: assets + 'zod-module.js', lodash: assets + 'lodash-module.js',
  };
}
