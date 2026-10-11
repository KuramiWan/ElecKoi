/** Presentation resources do not install author interfaces or background scripts. */
export class TavernSharedClient {
  constructor({ window, sdk, assetsBaseUrl }) {
    this.window = window;
    this.sdk = sdk;
    this.assetsBaseUrl = assetsBaseUrl;
    this.state = Object.freeze({ status: 'ready', error: '' });
    this.listeners = new Set();
    this.subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    this.getSnapshot = () => this.state;
  }
  start() {
    this.window.__ElecKoiClientCompatibility = this;
    this.window.dispatchEvent(new this.window.Event('eleckoi:shared-runtime'));
  }
  dispose() {
    if (this.window.__ElecKoiClientCompatibility === this) delete this.window.__ElecKoiClientCompatibility;
    this.window.dispatchEvent(new this.window.Event('eleckoi:shared-runtime'));
    this.listeners.clear();
  }
}
