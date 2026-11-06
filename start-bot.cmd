@echo off
setlocal
set "PROXY=%~dp0"

powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',8787);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 (
  echo [alice] proxy is down, starting it...
  start "alice-proxy" /min cmd /c "node ""%PROXY%src\index.js"" >> ""%PROXY%proxy.log"" 2>&1"
  powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',8787);$c.Close();exit 0}catch{Start-Sleep -Milliseconds 300}};exit 1" >nul 2>&1
)

node "%PROXY%bot\telegram.js" %*
