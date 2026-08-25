/**
 * Cloudflare Worker — nobinagro.sascorporationbd.com → mahasoftcorporation.com (FSERP).
 *
 * Use when the VPS has no nginx vhost/SSL for the vanity hostname. The browser
 * stays on nobinagro.sascorporationbd.com; this worker fetches the live FSERP site.
 *
 * Dashboard: Workers & Pages → Create → paste this → Deploy → Triggers → Add route:
 *   nobinagro.sascorporationbd.com/*
 *
 * API calls from the app still go to api.mahasoftcorporation.com (configured in FSERP).
 */
const ORIGIN = 'https://mahasoftcorporation.com'

export default {
  async fetch(request) {
    const inUrl = new URL(request.url)
    const target = new URL(inUrl.pathname + inUrl.search, ORIGIN)

    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.set('X-Forwarded-Host', inUrl.hostname)
    headers.set('X-Forwarded-Proto', 'https')

    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body
    }

    const response = await fetch(target, init)
    const outHeaders = new Headers(response.headers)

    const location = outHeaders.get('Location')
    if (location) {
      outHeaders.set(
        'Location',
        location
          .replace('https://mahasoftcorporation.com', `https://${inUrl.hostname}`)
          .replace('http://mahasoftcorporation.com', `https://${inUrl.hostname}`)
      )
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outHeaders,
    })
  },
}
