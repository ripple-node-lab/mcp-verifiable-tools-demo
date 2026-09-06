export function riskScore(symbol: string, price: number): number {
  let total = 0;
  for (const character of symbol) total = (total + character.charCodeAt(0)) % 100;
  return (total + price) % 100;
}
