// Made-up shop data, the same on every run (seeded): orders and customers over the last 14 months.
// Every name is invented; nothing here describes a real person or business.

export type ShopRows = { orders: Record<string, unknown>[]; customers: Record<string, unknown>[] }

const FIRST = ["Ada", "Bruno", "Clara", "Dario", "Elena", "Fabio", "Greta", "Hugo", "Irene", "Jonas", "Kira", "Luca", "Mila", "Nico", "Olga", "Pietro", "Rosa", "Sven", "Tea", "Ugo"]
const LAST = ["Example", "Sample", "Placeholder", "Testa", "Demo", "Fictive", "Mock", "Madeup"]
const COUNTRIES = ["IT", "FR", "DE", "ES"] as const
const STATUSES = ["open", "paid", "shipped", "refunded"] as const
const CHANNELS = ["web", "app", "store"] as const

function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

export function shopRows(today = new Date()): ShopRows {
  const r = random(7)
  const pick = <T>(xs: readonly T[], weights?: number[]) => {
    if (!weights) return xs[Math.floor(r() * xs.length)]
    let x = r() * weights.reduce((a, b) => a + b, 0)
    for (let i = 0; i < xs.length; i++) if ((x -= weights[i]) <= 0) return xs[i]
    return xs[xs.length - 1]
  }
  const day = (offset: number) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    d.setUTCDate(d.getUTCDate() - offset)
    return d
  }
  const customers = Array.from({ length: 90 }, (_, i) => ({
    id: `c-${i + 1}`,
    name: `${pick(FIRST)} ${pick(LAST)}`,
    country: pick(COUNTRIES, [5, 2, 3, 2]),
    signed_up: iso(day(Math.floor(r() * 420))),
  }))
  const orders: Record<string, unknown>[] = []
  for (let offset = 425; offset >= 0; offset--) {
    const date = day(offset)
    const season = 1 + 0.45 * Math.sin(((date.getUTCMonth() - 2) / 12) * 2 * Math.PI) + (date.getUTCMonth() === 10 || date.getUTCMonth() === 11 ? 0.6 : 0)
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 1.3 : 1
    const growth = 0.7 + 0.6 * (1 - offset / 425)
    const n = Math.round(r() * 3 * season * weekend * growth)
    for (let k = 0; k < n; k++) {
      const recent = offset < 10
      orders.push({
        id: `o-${orders.length + 1001}`,
        created_at: iso(date),
        status: recent ? pick(STATUSES, [5, 3, 1, 0.3]) : pick(STATUSES, [0.2, 1.5, 8, 0.7]),
        channel: pick(CHANNELS, [6, 3, 1.5]),
        total: Math.round((15 + r() ** 2 * 260) * 100) / 100,
        customer_id: `c-${1 + Math.floor(r() ** 1.6 * customers.length)}`,
        note: r() < 0.08 ? pick(["gift wrap", "leave at the door", "call before delivery"]) : null,
      })
    }
  }
  return { orders: orders.reverse(), customers }
}
