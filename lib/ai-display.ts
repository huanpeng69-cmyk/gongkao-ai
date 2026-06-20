export function toDisplayText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(toDisplayText).filter(Boolean).join("；");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = ["title", "name", "text", "content", "point", "value", "summary", "description"];
    for (const key of preferred) {
      const text = toDisplayText(record[key]);
      if (text) return text;
    }
    return Object.entries(record)
      .map(([key, item]) => {
        const text = toDisplayText(item);
        return text ? `${key}：${text}` : "";
      })
      .filter(Boolean)
      .join("；");
  }
  return "";
}

export function toDisplayList(value: unknown, limit = 6): string[] {
  const rawItems = Array.isArray(value) ? value : value ? [value] : [];
  const items = rawItems
    .flatMap((item) => {
      if (Array.isArray(item)) return item.map(toDisplayText);
      return [toDisplayText(item)];
    })
    .map((item) => item.replace(/^[\s•\-0-9.、]+/, "").trim())
    .filter(Boolean);

  return Array.from(new Set(items)).slice(0, limit);
}
