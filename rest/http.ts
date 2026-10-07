export function restClient(baseURL: string, apiKey: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${baseURL}${path}`, {
      method,
      headers: {
        'x-api-key': apiKey,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
    if (!response.ok)
      throw new Error(
        `${method} ${path}: HTTP ${response.status} ${await response.text()}`
      )
    if (response.status === 204) return null
    const responseBody = await response.text()
    return responseBody ? JSON.parse(responseBody) : null
  }
}
