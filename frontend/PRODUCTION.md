# Production build and static/CSS serving

## Why styles/CSS don’t load in production

Next.js injects CSS and JS from `/_next/static/...`. If the browser can’t load those URLs, the app will render without styles.

Common causes:

1. **Reverse proxy (nginx, Apache, Caddy)**  
   The proxy must forward both `/` and `/_next/*` to the Next server.  
   Example (nginx):

   ```nginx
   location / {
     proxy_pass http://localhost:3000;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection 'upgrade';
     proxy_set_header Host $host;
     proxy_cache_bypass $http_upgrade;
   }
   ```

   Do **not** proxy only `/` and drop `/_next`; the browser needs `/_next/static/...` for CSS and JS.

2. **App served from a subpath**  
   If the app is at e.g. `https://example.com/app`, set in `next.config.mjs`:

   ```js
   basePath: '/app',
   ```

   Rebuild after changing `basePath`.

3. **CDN or custom static host**  
   Only if you serve `/_next/static` from a different origin, set:

   ```js
   assetPrefix: 'https://cdn.example.com',
   ```

   Build and deploy the contents of `.next/static` to that CDN under the same path.

## Recommended: run the Next server in production

- Run `npm run build` then `npm run start` (or `next start -p 3000`).
- The same Node process serves the app and `/_next/static/*`. No extra config needed for CSS/JS.

## Optional: standalone output (Docker / single server)

To get a self-contained server that includes static assets:

1. In `next.config.mjs` add:

   ```js
   output: 'standalone',
   ```

2. Build: `npm run build`
3. Run: `node .next/standalone/server.js` (set `PORT` if needed).

The standalone server serves the app and `/_next/static` correctly.

## Checklist

- [ ] Proxy (if any) forwards `/_next` to the Next server.
- [ ] No `basePath` unless the app really lives under a subpath.
- [ ] No `assetPrefix` unless you use a CDN for `/_next/static`.
- [ ] Production run uses `next start` (or `standalone` server), not only static export.
