export function riskScore(symbol: string): number {
  let total = 0;
  for (const character of symbol) total = (total + character.charCodeAt(0)) % 100;
  return total;
}
