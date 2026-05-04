export function camelCase(snakeStr: string): string {
  if (snakeStr.length < 2) {
    return snakeStr;
  }
  return snakeStr
    .toLowerCase()
    .split("_")
    .map((part, index) => (index === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join("");
}

export function normalizeSnakeCaseKeys<T extends Record<string, any>>(data: T): T {
  const normalized = {} as T;
  for (const [key, value] of Object.entries(data)) {
    if (key.includes("_")) {
      continue;
    }
    normalized[key as keyof T] = value;
  }
  for (const [key, value] of Object.entries(data)) {
    if (!key.includes("_")) {
      continue;
    }
    const normalizedKey = camelCase(key);
    if (!(normalizedKey in normalized)) {
      normalized[normalizedKey as keyof T] = value;
    }
  }
  return normalized;
}

export function toCamelCaseDict(data: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [camelCase(key), value]));
}
