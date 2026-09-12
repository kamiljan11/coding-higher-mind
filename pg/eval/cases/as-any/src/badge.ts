export function badgeCount(row: unknown): number {
  const data = row as any;
  return data.badges?.length ?? 0;
}
