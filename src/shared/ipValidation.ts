/** IPv4 validation — used before persisting device records. */

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function isValidIPv4(s: string): boolean {
  return IPV4.test(s.trim())
}

export function assertValidIPv4(label: string, value: string): void {
  if (!isValidIPv4(value)) {
    throw new Error(`${label} must be a valid IPv4 address`)
  }
}
