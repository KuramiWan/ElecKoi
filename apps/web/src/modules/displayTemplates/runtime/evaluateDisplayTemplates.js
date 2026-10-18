import ejs from 'ejs/ejs.min.js';
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes';
import { DesktopError } from '@shared/foundation/DesktopError';
import { decorateRichDisplayReplacement } from '@shared/foundation/richMessage';

const MAX_OUTPUT = 2_000_000;
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}

/** 只使用传入的消息与配置快照计算显示结果，不读写产品状态。 */
export async function evaluateDisplayTemplates({ libraries, message, content, variables }) {
  if (message.role !== 'assistant' || message.status === 'streaming') return { content, errors: [] };
  const snapshot = frozen(structuredClone({ message, variables }));
  const errors = [], before = [], after = [];
  let body = content;
  for (const library of libraries) {
    if (!library.enabled) continue;
    const getvar = (path, options = {}) => {
      if (snapshot.variables === null) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '这条消息缺少变量快照，不能用当前变量代替历史变量。', { what: '消息的变量快照' });
      if (typeof path !== 'string' || !path) throw new DesktopError(ELECKOI_FAILURE_CODES.inputInvalid, 'getvar 需要明确的变量路径。', { field: 'path' });
      const keys = path.split('.');
      if (keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new DesktopError(ELECKOI_FAILURE_CODES.securityDenied, '变量路径包含不支持的字段。', { what: '变量路径' });
      let value = snapshot.variables;
      for (const key of keys) value = value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
      return value === undefined && Object.hasOwn(options, 'defaults') ? options.defaults : value;
    };
    async function render(template, data) {
      const compile = ejs.compile(template.source, { client: true, async: true, compileDebug: true,
        filename: `${library.scope}/${library.ownerId}/${template.name}` });
      const output = await compile({ ...data, getvar });
      if (output.length > MAX_OUTPUT) throw new DesktopError(ELECKOI_FAILURE_CODES.inputInvalid, '显示模板输出超过 200 万字符。', { field: 'size' });
      return output;
    }
    for (const template of library.templates) {
      if (!template.enabled) continue;
      const data = { message: snapshot.message, variables: snapshot.variables,
        rawContent: snapshot.message.content, content: body, match: null, captures: [], groups: {}, index: null };
      try {
        if (template.position === 'replace') {
          if (!template.pattern) throw new DesktopError(ELECKOI_FAILURE_CODES.inputInvalid, '替换模式需要匹配表达式。', { field: 'pattern' });
          const regex = new RegExp(template.pattern, template.flags);
          let replacementBody = '', cursor = 0;
          for (let match = regex.exec(body); match; match = regex.exec(body)) {
            const output = await render(template, { ...data, match: match[0], captures: [...match].slice(1), groups: { ...match.groups }, index: match.index });
            replacementBody += body.slice(cursor, match.index) + decorateRichDisplayReplacement(output);
            cursor = match.index + match[0].length;
            if (!regex.global) break;
            if (!match[0].length) {
              const codePoint = body.codePointAt(regex.lastIndex);
              regex.lastIndex += regex.unicode && codePoint > 0xffff ? 2 : 1;
            }
          }
          body = replacementBody + body.slice(cursor);
        } else {
          const output = decorateRichDisplayReplacement(await render(template, data));
          (template.position === 'before' ? before : after).push(output);
        }
      } catch (error) {
        errors.push({ scope: library.scope, ownerId: library.ownerId, templateId: template.id,
          templateName: template.name, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  const output = [...before, body, ...after].filter(value => value !== '').join('\n');
  if (output.length > MAX_OUTPUT) throw new DesktopError(ELECKOI_FAILURE_CODES.inputInvalid, '显示模板总输出超过 200 万字符。', { field: 'size' });
  return { content: output, errors };
}
