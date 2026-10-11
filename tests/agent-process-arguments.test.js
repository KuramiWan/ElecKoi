import { describe, expect, it } from 'vitest';
import { processArgumentSummary } from '../apps/web/src/modules/chat/model/agentProcessArguments.js';
import { processItemDetails } from '../apps/web/src/modules/chat/model/agentProcessDetails.js';

describe('product tool argument presentation', () => {
  it('shows a search pattern and scope rather than the number of returned files on mobile', () => {
    const item = { toolName: 'eleckoi_glob_setting_files', status: 'complete', arguments: '{"pattern":"**","path":"合成组"}', summary: '{"files":[{"path":"合成组/条目"}]}' };
    expect(processArgumentSummary(item.toolName, item.arguments)).toBe('路径模式：**\n范围：合成组');
    expect(processItemDetails(item, { mobile: true }).target).toBe('“**” · 合成组');
    expect(processItemDetails(item).target).toContain('1 项');
    expect(processArgumentSummary('eleckoi_glob_variables', '{}')).toBe('路径模式：**');
  });

  it('keeps all requested files and variable pagination fields readable', () => {
    expect(processArgumentSummary('eleckoi_read_setting_files', { paths: ['合成组/甲', '合成组/乙'] })).toBe('文件：\n合成组/甲\n合成组/乙');
    expect(processArgumentSummary('eleckoi_read_variables', { paths: ['/synthetic/value'], offset: 0, limit: 20, char_offset: 0, char_limit: 4000 })).toBe('变量：\n/synthetic/value\n子项起始位置：0\n每页子项数：20\n字符起始位置：0\n每页字符数：4000');
  });

  it('keeps false and empty replacement text visible', () => {
    expect(processArgumentSummary('eleckoi_apply_setting_patch', { operation: 'edit_file', path: '合成条目', old_string: '原文', new_string: '', replace_all: false })).toContain('替换为：\n替换全部：否');
    expect(processArgumentSummary('eleckoi_apply_variable_patch', { operations: [{ op: 'replace', path: '/synthetic/value', value: { active: false, count: 0 } }] })).toContain('{"active":false,"count":0}');
  });

  it('leaves unsupported, malformed and additional fields in the raw argument view', () => {
    expect(processArgumentSummary('synthetic_read', '{"paths":["甲"]}')).toBeNull();
    expect(processArgumentSummary('eleckoi_read_setting_files', '{invalid')).toBeNull();
    expect(processArgumentSummary('eleckoi_read_setting_files', { paths: [7] })).toBeNull();
    expect(processArgumentSummary('eleckoi_glob_variables', { pattern: '**', extra: 'must remain visible' })).toBeNull();
    expect(processArgumentSummary('eleckoi_apply_variable_patch', { operations: [{ op: 'replace', path: '/synthetic', extra: true }] })).toBeNull();
  });
});
