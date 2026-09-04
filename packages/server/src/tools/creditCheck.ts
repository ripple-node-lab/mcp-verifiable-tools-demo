export function privateCreditCheck(income: number, debt: number): "approved" | "denied" {
  return income > debt * 2 ? "approved" : "denied";
}
