/* Thin fetch wrapper + one-time external script loader. */

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = {}
  try { json = await res.json() } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`)
    err.status = res.status
    Object.assign(err, json)
    throw err
  }
  return json
}

const scripts = new Map()
export function loadScript(src) {
  if (scripts.has(src)) return scripts.get(src)
  const p = new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => { scripts.delete(src); reject(new Error(`Could not load ${src}`)) }
    document.head.appendChild(el)
  })
  scripts.set(src, p)
  return p
}

export const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`
