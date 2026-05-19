@echo off
REM Local shim: "python" in backend folder -> repo-root .venv (no global PATH needed).
"%~dp0..\.venv\Scripts\python.exe" %*
