# If you see a white page and no "compiling" in the terminal

1. **Stop the dev server** (Ctrl+C in the terminal).

2. **Delete the Next.js cache:**
   - In the `frontend` folder, delete the `.next` folder (or run: `rmdir /s /q .next` in Command Prompt from the frontend folder).

3. **Start again:**
   ```bash
   cd d:\ITProjects\ERP_Filling_Station\frontend
   npm run dev
   ```

4. **Open the app:** In the browser go to **http://localhost:3000** (use a new tab or hard refresh: Ctrl+Shift+R).

5. **If it’s still white,** open **DevTools (F12)** → **Console** tab. Note any red errors and share them. Also check the **Network** tab: make sure the first document request returns **200** and that no `_next/static` or main JS files return **404**.

The app now has a root **loading.tsx** (shows "Loading..." while the page compiles) and a gray background so you should see something as soon as the server responds.
