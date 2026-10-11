export function derive(score, multiplier) {
  if (!Number.isFinite(score) || score < 0) throw new Error('score 必须是非负有限数字');
  if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error('倍率必须是正有限数字');
  return { total: score * multiplier, level: Math.floor(score / 10) + 1 };
}
