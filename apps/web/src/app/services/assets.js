import { LOCAL_MEDIA_SCHEME } from "@shared/foundation/mediaReference";

export async function initRendererAssets() {
  return undefined;
}

export function assetSrc(src) {
  return src || "";
}

export function assetFetchSrc(src) {
  if (!src || document.documentElement.dataset.eleckoiMobile !== "true") return src;
  if (new URL(src, window.location.href).protocol !== `${LOCAL_MEDIA_SCHEME}:`) return src;
  const url = new URL("/eleckoi/media/asset", window.location.href);
  url.searchParams.set("reference", src);
  return url.href;
}
