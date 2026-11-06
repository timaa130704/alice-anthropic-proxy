@echo off
setlocal
set "PROXY=%~dp0"

rem из Run-диалога/ярлыка cwd бывает system32 — там писать нельзя
for %%D in ("%CD%") do set "HERE=%%~fD"
if /i "%HERE%"=="%SystemRoot%\system32" cd /d "%USERPROFILE%"
if /i "%HERE%"=="%SystemRoot%" cd /d "%USERPROFILE%"
if /i "%HERE%"=="%SystemRoot%\SysWOW64" cd /d "%USERPROFILE%"

powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',8787);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 (
  echo [alice] proxy is down, starting it...
  start "alice-proxy" /min cmd /c "node ""%PROXY%src\index.js"" >> ""%PROXY%proxy.log"" 2>&1"
  powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',8787);$c.Close();exit 0}catch{Start-Sleep -Milliseconds 300}};exit 1" >nul 2>&1
  if errorlevel 1 (
    echo [alice] failed to start proxy, see %PROXY%proxy.log
    exit /b 1
  )
)

claude %*
