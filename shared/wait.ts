import { setTimeout } from 'node:timers/promises'
import { record, show } from './values.ts'

export async function waitForCalculation(
  read: () => Promise<unknown>,
  revision: number
) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const portfolio = record(await read())
    if (
      portfolio.calculatedRevision === revision &&
      portfolio.calculation === 'CURRENT'
    ) {
      show('Calculated portfolio', portfolio)
      if (portfolio.isComplete !== true)
        throw new Error(
          'Portfolio has missing prices; inspect holdings before displaying a complete total'
        )
      return
    }
    await setTimeout(2000)
  }
  throw new Error(
    `Calculation not complete within two minutes for revision ${revision}`
  )
}

export async function waitForDocument(read: () => Promise<unknown>) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const document = record(await read())
    if (document.status === 'COMPLETED') {
      show('Document completed', document)
      return
    }
    if (document.status === 'FAILED')
      throw new Error(`Document failed: ${document.error}`)
    await setTimeout(2000)
  }
  throw new Error(
    'Document still processing after two minutes; use its printed ID to inspect status'
  )
}
