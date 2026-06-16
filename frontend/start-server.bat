@echo off
title Next.js Dev Server - FMERP
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"

echo.
echo Starting Next.js at http://127.0.0.1:3000
echo Open this URL in your browser. Close this window to stop the server.
echo.

npm run dev
pause
