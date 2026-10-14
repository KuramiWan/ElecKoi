import { createMessageApi } from './messages.js';
import { createVariableApi } from './variables.js';
import { createCatalogFunctions } from './catalog.js';
import { createEventFunctions, createRuntimeFunctions } from './helper-runtime.js';
import { createSillyTavernApi } from './st.js';

/** All code here is evaluated in one author frame; only native services and shared references cross realms. */
globalThis.__ElecKoiCreateTavernApi = runtime => {
  const view = runtime.window;
  const definitions = new Map();
  const install = (name, value) => {
    if (!definitions.has(name)) definitions.set(name, Object.getOwnPropertyDescriptor(view, name));
    Object.defineProperty(view, name, { configurable: true, writable: true, value });
  };
  const helper = {
    ...createMessageApi(runtime), ...createVariableApi(runtime),
    ...createCatalogFunctions(runtime), ...createEventFunctions(runtime), ...createRuntimeFunctions(runtime),
    generate: configuration => generate('generation.auxiliary', configuration),
    generateRaw: configuration => generate('generation.raw', configuration),
    stopGeneration: generationId => runtime.request('generation.cancel', { generationId }),
    getLastMessageId: () => runtime.snapshot.messages.length - 1,
    getCurrentMessageId: () => runtime.snapshot.messages.findIndex(item => item.id === runtime.snapshot.context.messageId),
    getIframeName: () => view.name,
    getIframeWindow: () => view,
    getScriptWindow: () => view,
    getTavernHelper: () => helper,
    setInput: text => runtime.native.request('input.set', { text }),
    getInput: () => runtime.native.request('input.get', {}),
    setInputText: text => runtime.native.request('input.set', { text }),
  };
  let SillyTavern;
  async function generate(method, configuration = {}) {
    const input = structuredClone(configuration);
    await runtime.shared.eventHub.emitAndWait('GENERATION_REQUESTED', input);
    const result = await runtime.request(method, input);
    return result.text;
  }
  for (const [name, value] of Object.entries(helper)) install(name, value);
  install('TavernHelper', helper);
  const previousSt = Object.getOwnPropertyDescriptor(view, 'SillyTavern');
  SillyTavern = createSillyTavernApi(runtime, helper);
  helper.substitudeMacros = text => SillyTavern.getContext().substituteParams(String(text));
  helper.substituteMacros = helper.substitudeMacros;
  helper.triggerSlash = text => SillyTavern.getContext().executeSlashCommandsWithOptions(String(text));
  helper.triggerSlashWithOptions = (text, options) => SillyTavern.getContext().executeSlashCommandsWithOptions(String(text), options);
  helper.registerMacro = (name, callback, options) => SillyTavern.getContext().MacroRegistry.registerMacro(name, { ...options, handler: callback });
  helper.unregisterMacro = name => SillyTavern.getContext().MacroRegistry.unregisterMacro(name);
  for (const name of ['substitudeMacros', 'substituteMacros', 'triggerSlash', 'triggerSlashWithOptions', 'registerMacro', 'unregisterMacro']) install(name, helper[name]);
  install('tavern_events', SillyTavern.getContext().eventTypes);
  install('iframe_events', { MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started', MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended', GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped', STREAM_TOKEN_RECEIVED_FULLY: 'stream_token_received_fully', STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'stream_token_received_incrementally' });
  const dispose = () => {
    SillyTavern.dispose();
    for (const [name, descriptor] of definitions) {
      if (descriptor) Object.defineProperty(view, name, descriptor);
      else delete view[name];
    }
    if (previousSt) Object.defineProperty(view, 'SillyTavern', previousSt);
    else delete view.SillyTavern;
  };
  return { helper, SillyTavern, dispose };
};
