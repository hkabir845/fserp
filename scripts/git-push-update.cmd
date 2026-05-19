@echo off
REM Quick wrapper: git add . && commit && push origin main
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-push-update.ps1" %*
