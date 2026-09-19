// Capture only API validation fields, never headers, credentials or request bodies.
const request = globalThis.fetch
 globalThis.fetch = async (...args) => {
  const response = await request(...args)
  if (!response.ok) {
    const data = await response.clone().json().catch(() => ({}))
    console.error(JSON.stringify({ status: response.status, message: data.message, errors: data.errors }).slice(0, 1500))
  }
  return response
}
