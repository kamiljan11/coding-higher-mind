export function calc(input: number[]): number {
  const r = input.length;
  const v = input[0] ?? 0;
  const d = input[1] ?? 0;
  const m = input[2] ?? 0;
  return r + v + d + m;
}
