const globFields = { pattern: ['路径模式', 'string'], path: ['范围', 'string'] };
const grepFields = {
  pattern: ['正则', 'string'], path: ['范围', 'string'], glob: ['文件过滤', 'string'],
  output_mode: ['结果', 'string'], ignore_case: ['忽略大小写', 'boolean'],
  limit: ['返回上限', 'integer'],
};
const argumentFields = {
  eleckoi_glob_setting_files: globFields,
  eleckoi_glob_variables: globFields,
  eleckoi_grep_setting_files: grepFields,
  eleckoi_grep_variables: { ...grepFields, multiline: ['多行匹配', 'boolean'] },
  eleckoi_read_setting_files: { paths: ['文件', 'paths'] },
  eleckoi_read_variables: {
    paths: ['变量', 'paths'], offset: ['子项起始位置', 'integer'], limit: ['每页子项数', 'integer'],
    char_offset: ['字符起始位置', 'integer'], char_limit: ['每页字符数', 'integer'],
  },
  eleckoi_apply_setting_patch: {
    operation: ['操作', 'string'], path: ['路径', 'string'], destination: ['目标', 'string'],
    content: ['正文', 'string'], selection_hint: ['读取提示', 'string'], old_string: ['原文', 'string'],
    new_string: ['替换为', 'string'], replace_all: ['替换全部', 'boolean'], overwrite: ['覆盖目标', 'boolean'],
  },
};

// Summaries cover the exact fields of the registered product tools. Other payloads remain raw.
export function processArgumentSummary(toolName, rawArguments) {
  const fields = argumentFields[toolName];
  if (!fields && toolName !== 'eleckoi_apply_variable_patch') return null;
  let args = rawArguments;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { return null; }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  if (toolName === 'eleckoi_apply_variable_patch') return variablePatchSummary(args);
  const keys = Object.keys(args);
  if (keys.some((key) => !fields[key] || !validValue(args[key], fields[key][1]))) return null;
  if (toolName === 'eleckoi_read_setting_files' || toolName === 'eleckoi_read_variables') {
    if (!Array.isArray(args.paths) || !args.paths.length) return null;
  }
  const lines = Object.entries(fields).flatMap(([key, [label, type]]) => {
    if (!(key in args)) return [];
    const value = args[key];
    return [type === 'paths' ? `${label}：\n${value.join('\n')}`
      : `${label}：${typeof value === 'boolean' ? value ? '是' : '否' : value}`];
  });
  // Both Glob tools formally default an absent or empty pattern to **.
  if (fields === globFields && !args.pattern?.trim()) {
    if ('pattern' in args) lines[0] = '路径模式：**';
    else lines.unshift('路径模式：**');
  }
  return lines.length ? lines.join('\n') : null;
}

function variablePatchSummary(args) {
  if (Object.keys(args).some((key) => key !== 'operations') || !Array.isArray(args.operations) || !args.operations.length) return null;
  const labels = { replace: '替换', delta: '增减', insert: '新增', remove: '删除' };
  if (args.operations.some((operation) => !operation || typeof operation !== 'object'
    || Array.isArray(operation) || Object.keys(operation).some((key) => !['op', 'path', 'value'].includes(key))
    || !Object.hasOwn(labels, operation.op) || typeof operation.path !== 'string')) return null;
  return args.operations.map((operation) => `${labels[operation.op]} ${operation.path}${'value' in operation ? `\n值：${JSON.stringify(operation.value)}` : ''}`).join('\n\n');
}

function validValue(value, type) {
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'paths') return Array.isArray(value) && value.every((path) => typeof path === 'string');
  return typeof value === type;
}
