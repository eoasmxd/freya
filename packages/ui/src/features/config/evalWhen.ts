/**
 * Evaluates dynamic configuration condition expressions
 */
export function evalWhen(
  expr: string | undefined | null,
  getValueByKey: (key: string) => any
): boolean {
  if (!expr || !expr.trim()) {
    return true;
  }

  const clean = expr.trim();

  const compareMatch = clean.match(/^([a-zA-Z0-9_.-]+)\s*(==|!=)\s*(.+)$/);
  if (compareMatch) {
    const [, key, op, rawTarget] = compareMatch;
    const currentVal = getValueByKey(key);

    let targetVal: any = rawTarget.trim();
    if (targetVal === 'true') {
      targetVal = true;
    } else if (targetVal === 'false') {
      targetVal = false;
    } else if (targetVal === 'null') {
      targetVal = null;
    } else if (targetVal === 'undefined') {
      targetVal = undefined;
    } else if (/^-?\d+(\.\d+)?$/.test(targetVal)) {
      targetVal = Number(targetVal);
    } else {
      targetVal = targetVal.replace(/^['"](.*)['"]$/, '$1');
    }

    return op === '==' ? currentVal === targetVal : currentVal !== targetVal;
  }

  if (clean.startsWith('!')) {
    const key = clean.slice(1).trim();
    return !getValueByKey(key);
  }

  return Boolean(getValueByKey(clean));
}
