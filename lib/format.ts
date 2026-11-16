/** "1.5" + decimals 9 -> 1500000000n. Возвращает null при неверном вводе. */
export function toBaseUnits(input: string, decimals: number): bigint | null {
  const v = input.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  const [whole, frac = ""] = v.split(".");
  if (frac.length > decimals) return null;
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const out = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
  return out > 0n ? out : null;
}

/** 1500000000n, 9 -> "1.5" (без лишних нулей, до maxFrac знаков). */
export function fromBaseUnits(value: bigint | string, decimals: number, maxFrac = 6): string {
  const n = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  let frac = (n % base).toString().padStart(decimals, "0").slice(0, maxFrac);
  frac = frac.replace(/0+$/, "");
  return frac ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
}

export function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
