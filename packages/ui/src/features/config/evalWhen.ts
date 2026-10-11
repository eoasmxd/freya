export interface SchemaLike {
  key: string;
  showWhen?: string;
}

/**
 * Extract all referenced field keys from an expression (excluding reserved keywords and numbers)
 */
export function extractReferencedKeys(expr: string | undefined | null): string[] {
  if (!expr || !expr.trim()) return [];
  const tokens = expr.match(/[a-zA-Z0-9_.-]+/g) || [];
  const reserved = new Set(['true', 'false', 'null', 'undefined']);
  const keys: string[] = [];
  for (const token of tokens) {
    if (!reserved.has(token) && !/^-?\d+(\.\d+)?$/.test(token)) {
      keys.push(token);
    }
  }
  return keys;
}

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

  if (expr.includes('&&')) {
    return expr.split('&&').every((part) => evalSingleWhen(part.trim(), getValueByKey));
  }

  return evalSingleWhen(expr.trim(), getValueByKey);
}

function evalSingleWhen(clean: string, getValueByKey: (key: string) => any): boolean {
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

/**
 * Recursively determine whether a field is visible based on the schema dependency chain (hides children if parent is hidden)
 */
export function isFieldVisible(
  field: SchemaLike,
  getValueByKey: (key: string) => any,
  findFieldSchema?: (key: string) => SchemaLike | undefined,
  visited = new Set<string>()
): boolean {
  if (visited.has(field.key)) return false;
  visited.add(field.key);

  const isSelfShown = evalWhen(field.showWhen, getValueByKey);
  if (!isSelfShown) return false;

  if (field.showWhen && findFieldSchema) {
    const refKeys = extractReferencedKeys(field.showWhen);
    for (const refKey of refKeys) {
      const parent = findFieldSchema(refKey);
      if (parent && !isFieldVisible(parent, getValueByKey, findFieldSchema, new Set(visited))) {
        return false;
      }
    }
  }

  return true;
}
