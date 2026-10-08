export const MASTER_OBSERVED_AT = '2026-01-01T00:00:00.000Z'

export const FX_PAIRS = [
  { base: 'EUR', quote: 'USD', rate: 1.0875 },
  { base: 'GBP', quote: 'USD', rate: 1.2725 },
  { base: 'USD', quote: 'CHF', rate: 0.8815 },
] as const

export type Instrument = {
  securityId: string
  name: string
  code: string
  currency: string
}

export function sampleInstruments(count: number): Instrument[] {
  return Array.from({ length: count }, (_unused, index) => {
    const number = index + 1
    return {
      securityId: `sample-fund-${number}`,
      name: `Sample Partner Fund ${number}`,
      code: `SMPL${number}`,
      currency: 'USD',
    }
  })
}

export function decimal(value: number, places: number) {
  return value.toFixed(places)
}

export function nextValue(previous: number, random: () => number = Math.random) {
  const change = (random() - 0.5) * 0.02
  return Math.max(0.01, previous * (1 + change))
}

export function securityMessage(instrument: Instrument) {
  return {
    kind: 'security',
    eventId: `security-${instrument.securityId}-v1`,
    securityId: instrument.securityId,
    observedAt: MASTER_OBSERVED_AT,
    version: 1,
    name: instrument.name,
    code: instrument.code,
    ccy: instrument.currency,
  }
}

export function priceMessage(instrument: Instrument, price: number, observedAt: Date) {
  return {
    kind: 'price',
    eventId: `price-${instrument.securityId}-${observedAt.getTime()}`,
    securityId: instrument.securityId,
    observedAt: observedAt.toISOString(),
    version: 1,
    quote: { px: decimal(price, 4), ccy: instrument.currency },
  }
}

export function fxMessage(
  pair: { base: string; quote: string },
  rate: number,
  observedAt: Date
) {
  return {
    kind: 'fx',
    eventId: `fx-${pair.base}${pair.quote}-${observedAt.getTime()}`,
    pair: `${pair.base}/${pair.quote}`,
    base: pair.base,
    quote: pair.quote,
    observedAt: observedAt.toISOString(),
    version: 1,
    mid: decimal(rate, 6),
  }
}
