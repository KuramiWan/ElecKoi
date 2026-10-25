import { ELECKOI_FAILURE_CODES } from '../../contracts/errors/codes';
import ejs from 'ejs/ejs.min.js';
import { hasRegexEjsOutput, prepareRegexEjsSource } from './RegexEjsMarkers';

/** Build isolated read-only locals from the exact input snapshot. */
export function createRegexEjsLocals(input, failureCodes = ELECKOI_FAILURE_CODES) {
  // This function is serialized into the isolated VM: dependencies must be explicit data.
  const failure = (code, message, details) => Object.assign(new Error(message), {
    name: 'DesktopError', isDSHRemoteError: true, code, details
  });
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const snapshot = freeze(JSON.parse(JSON.stringify(input)));
  if (snapshot.variables !== null && (!snapshot.variables || typeof snapshot.variables !== 'object' || Array.isArray(snapshot.variables))) {
    throw failure(failureCodes.dataShapeInvalid, '变量快照必须是 JSON 对象或 null。', { what: '变量快照' });
  }
  const getvar = (path, options = {}) => {
    if (snapshot.variables == null) throw failure(failureCodes.dataShapeInvalid, '缺少本次内容的变量快照，不能用其他消息或聊天的变量代替。', { what: '本次内容的变量快照' });
    if (typeof path !== 'string' || !path) throw failure(failureCodes.inputInvalid, 'getvar 需要明确的变量路径。', { field: 'getvar 变量路径' });
    const keys = path.split('.');
    if (keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw failure(failureCodes.securityDenied, '变量路径包含不支持的字段。', { what: '变量路径', guard: '变量字段边界' });
    let value = snapshot.variables;
    for (const key of keys) value = value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
    return value === undefined && Object.hasOwn(options, 'defaults') ? options.defaults : value;
  };
  return { ...snapshot, getvar };
}

export function compileRegexEjs(source, filename = 'regex-replacement.ejs') {
  // Client compilation embeds this function's source, so it must have no module-scope dependencies.
  const escapeFunction = function (markup) {
    return markup == null ? '' : String(markup).replace(/[&<>"']/g,
      character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' })[character]);
  };
  return ejs.compile(source, { client: true, async: true, compileDebug: true, filename, escapeFunction });
}

/** EJS runs after the existing regex surface pipeline, once per resulting text. */
export async function evaluateRegexEjs(input) {
  if (!hasRegexEjsOutput(input.content)) return input.content;
  return await compileRegexEjs(prepareRegexEjsSource(input.content), input.filename)(createRegexEjsLocals(input));
}
