# Troubleshooting Login Page Not Appearing

## Quick Fixes

### 1. Restart Dev Server
```bash
cd frontend
# Stop current server (Ctrl+C)
npm run dev
```

### 2. Clear Browser Cache
- Press `Ctrl + Shift + R` (hard refresh)
- Or clear browser cache completely

### 3. Try Direct Access
- Go directly to: `http://localhost:3000/login`
- Don't go through root page (`http://localhost:3000/`)

### 4. Check Browser Console
- Open Developer Tools (F12)
- Check Console tab for errors
- Check Network tab to see if requests are failing

### 5. Verify Backend is Running
- Local dev: `https://api.mahasoftcorporation.com` — Test: `https://api.mahasoftcorporation.com/api/docs/`
- Production API host: `https://api.mahasoftcorporation.com` — Test: `https://api.mahasoftcorporation.com/api/docs/`

### 6. Clear LocalStorage
Open browser console and run:
```javascript
localStorage.clear()
location.reload()
```

## Common Issues

1. **Redirect Loop**: Root page keeps redirecting
   - Solution: Use `router.replace()` instead of `router.push()`

2. **SSR Error**: Server-side rendering error
   - Solution: All browser APIs are now guarded

3. **Provider Error**: CompanyProvider or ToastProvider failing
   - Solution: Providers now have fallback rendering

4. **Build Cache**: Old build files
   - Solution: Delete `.next` folder and rebuild
   ```bash
   rm -rf .next
   npm run build
   npm run dev
   ```

