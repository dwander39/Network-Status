import { createRequire } from 'module'

/**
 * mac-oui-lookup is CJS. ESM `import x from` can resolve to a module object, not the function.
 * require() returns `{ getVendor, default }` where both point at the lookup function.
 */
const require = createRequire(import.meta.url)
const mod: unknown = require('mac-oui-lookup')

function resolveGetVendor(): (mac: string, defaultVendor?: string | null) => string | null {
  if (typeof mod === 'function') {
    return mod as (mac: string, defaultVendor?: string | null) => string | null
  }
  const o = mod as Record<string, unknown>
  if (typeof o.getVendor === 'function') {
    return o.getVendor as (mac: string, defaultVendor?: string | null) => string | null
  }
  if (typeof o.default === 'function') {
    return o.default as (mac: string, defaultVendor?: string | null) => string | null
  }
  throw new Error('mac-oui-lookup: invalid module shape')
}

const getVendor = resolveGetVendor()

/** Short labels for common VM OUIs when the IEEE name is verbose. */
const OVERRIDES: Record<string, string> = {
  '00:50:56': 'VMware',
  '52:54:00': 'QEMU/KVM',
  '08:00:27': 'VirtualBox',
  '00:1c:42': 'Parallels',
  '00:15:5d': 'Microsoft Hyper-V',
  '00:0c:29': 'VMware',
  '00:16:3e': 'Xen',
  'bc:24:11': 'Proxmox VE'
}

const cache = new Map<string, string | null>()

/** Clears OUI/vendor cache (e.g. after switching networks). */
export function clearVendorLookupCache(): void {
  cache.clear()
}

export function lookupVendor(macNormalized: string): string | null {
  const key = macNormalized.trim().toLowerCase()
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  try {
    const fromIeee = getVendor(macNormalized)
    if (fromIeee && String(fromIeee).trim()) {
      const v = String(fromIeee).trim()
      cache.set(key, v)
      return v
    }
  } catch {
    /* ignore bad MAC shapes */
  }

  const prefix = macNormalized.slice(0, 8).toLowerCase()
  const v = OVERRIDES[prefix] ?? null
  cache.set(key, v)
  return v
}
