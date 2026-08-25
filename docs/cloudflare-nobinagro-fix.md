# Fix nobinagro.sascorporationbd.com via Cloudflare

The VPS serves FSERP on `mahasoftcorporation.com` but has **no nginx site** for `nobinagro.sascorporationbd.com`, so Cloudflare gets **502 Bad Gateway** from the origin.

You can fix this **in Cloudflare** (no VPS sudo) with a **Worker** that proxies to the working site.

## Option A — Worker (keeps `nobinagro.sascorporationbd.com` in the address bar)

1. Sign in at [https://dash.cloudflare.com](https://dash.cloudflare.com)
2. Open zone **`sascorporationbd.com`**
3. Go to **Workers & Pages** → **Create** → **Create Worker**
4. Name it e.g. `nobinagro-proxy`
5. Replace the default code with the contents of:
   `cloudflare/workers/nobinagro-proxy.js` in this repo
6. Click **Deploy**
7. Open the worker → **Settings** → **Triggers** → **Add route**
   - Route: `nobinagro.sascorporationbd.com/*`
   - Zone: `sascorporationbd.com`
8. Save

Wait ~1 minute, then open https://nobinagro.sascorporationbd.com/

### SSL (if you still see errors)

Under **SSL/TLS** → **Overview**, set encryption mode to **Full** (not Flexible).

`nobinagro.sascorporationbd.com` DNS record should stay **Proxied** (orange cloud).

## Option B — Redirect (fastest, URL changes to mahasoftcorporation.com)

1. [Cloudflare dashboard](https://dash.cloudflare.com) → zone `sascorporationbd.com`
2. **Rules** → **Redirect Rules** → **Create rule**
3. **When**: Custom filter expression  
   `http.host eq "nobinagro.sascorporationbd.com"`
4. **Then**: Static redirect → `https://mahasoftcorporation.com` — Status **302**
5. Deploy

Users will land on `mahasoftcorporation.com` instead of the vanity hostname.

## Option C — VPS nginx (permanent, needs server sudo)

On the VPS (one-time):

```bash
ssh sas@mahasoftcorporation.com
sudo bash ~/fix-nobinagro-site.sh
```

Script path in repo: `scripts/fix-nobinagro-site.sh`

After nginx + TLS are in place, you can remove the Worker route.

## Already done on the VPS (app layer)

- FSERP CORS / allowed hosts for `nobinagro.sascorporationbd.com`
- Org custom domain set to `nobinagro.sascorporationbd.com`
- Frontend rebuilt with that hostname in app-shell config

Login API: `https://api.mahasoftcorporation.com` (cross-origin; CORS is configured).
