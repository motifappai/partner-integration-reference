import { readFile, writeFile } from 'node:fs/promises'

const source = process.argv[2]
if (!source) throw new Error('Pass the authoritative Motif OpenAPI JSON path')
const contract = JSON.parse(await readFile(source, 'utf8'))
const paths = {}
for (const [path, operations] of Object.entries(contract.paths)) {
  const selected = Object.fromEntries(
    Object.entries(operations).filter(([, operation]) =>
      operation.tags?.includes('sdk')
    )
  )
  if (Object.keys(selected).length) paths[path] = selected
}
if (!Object.keys(paths).length) throw new Error('No public SDK operations found')
const schemas = {}
function includeReferences(value) {
  if (!value || typeof value !== 'object') return
  if (typeof value.$ref === 'string') {
    const prefix = '#/components/schemas/'
    if (!value.$ref.startsWith(prefix))
      throw new Error(`Unsupported reference: ${value.$ref}`)
    const name = value.$ref.slice(prefix.length)
    if (!(name in schemas)) {
      const schema = contract.components.schemas[name]
      if (!schema) throw new Error(`Missing schema: ${name}`)
      schemas[name] = schema
      includeReferences(schema)
    }
  }
  for (const child of Object.values(value)) includeReferences(child)
}
includeReferences(paths)
const publicContract = {
  openapi: contract.openapi,
  info: { title: 'Motif Partner API', version: '0.2.0' },
  servers: [{ url: 'https://backend.motifapp.ai/api' }],
  paths,
  components: { schemas, securitySchemes: contract.components.securitySchemes },
}
await writeFile(
  new URL('src/main/openapi/motif.json', import.meta.url),
  `${JSON.stringify(publicContract, null, 2)}\n`
)
console.log(`Copied ${Object.keys(paths).length} public SDK paths`)
