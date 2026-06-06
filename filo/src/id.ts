let nextId = 1;

export function createId(prefix: string): string {
  const id = `${prefix}-${nextId.toString(36)}`;
  nextId += 1;
  return id;
}
