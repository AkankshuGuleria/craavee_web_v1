/** Integer paise (D7) -> a display string like "₹45.00". */
export function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}
