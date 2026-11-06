# alice-anthropic-proxy
@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo [i] no dependencies needed - plain node
)
node src\index.js
