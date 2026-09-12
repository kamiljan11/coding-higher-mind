const VAT_RATE_PERCENT = 24;

export function priceWithVat(netIsk: number): number {
  return Math.round(netIsk * (1 + VAT_RATE_PERCENT / 100));
}
