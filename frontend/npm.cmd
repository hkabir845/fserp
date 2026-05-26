@echo off
REM Local shim: npm in frontend folder (no global PATH needed).
set "NPM=%ProgramFiles%\nodejs\npm.cmd"
if not exist "%NPM%" set "NPM=%ProgramFiles(x86)%\nodejs\npm.cmd"
if not exist "%NPM%" (
  echo ERROR: npm not found. Install Node.js from https://nodejs.org/
  exit /b 1
)
"%NPM%" %*
