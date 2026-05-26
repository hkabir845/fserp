@echo off
if exist "%ProgramFiles%\nodejs\node.exe" (
  "%ProgramFiles%\nodejs\node.exe" %*
) else (
  node.exe %*
)
