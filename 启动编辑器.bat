@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title DB Editor
cd /d "%~dp0"

set "NODE_EXE="
set "NODE_VER="
set "CUR_EXE="
set "CUR_VER="

for /f "delims=" %%p in ('where node 2^>nul') do (
  if not defined CUR_EXE set "CUR_EXE=%%p"
)
if defined CUR_EXE (
  for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "CUR_VER=%%v"
  if defined CUR_VER call :accept "!CUR_EXE!" "!CUR_VER!"
)

if not defined NODE_EXE (
  set "NVM_ROOT=%NVM_HOME%"
  if not exist "!NVM_ROOT!" set "NVM_ROOT=%APPDATA%\nvm"
  if exist "!NVM_ROOT!" (
    for /f "delims=" %%d in ('dir /b /ad /o-n "!NVM_ROOT!\v*" 2^>nul') do (
      if not defined NODE_EXE (
        set "CAND_VER=%%d"
        if "!CAND_VER:~0,1!"=="v" set "CAND_VER=!CAND_VER:~1!"
        call :accept "!NVM_ROOT!\%%d\node.exe" "!CAND_VER!"
      )
    )
  )
)

if not defined NODE_EXE goto :missing_node

echo.
echo   Legend of Mir World - DB Editor
echo   Node.js !NODE_VER! - !NODE_EXE!
echo   Starting local server - the browser will open automatically.
echo   Close this window to stop the editor.
echo.
"!NODE_EXE!" server.js
echo.
echo   Editor exited.
pause
exit /b 0

:accept
rem %1 = node.exe path, %2 = version
set "TRY_MAJOR="
for /f "tokens=1 delims=." %%m in ("%~2") do set "TRY_MAJOR=%%m"
if not defined TRY_MAJOR goto :eof
echo !TRY_MAJOR!| findstr /r "^[0-9][0-9]*$" >nul || goto :eof
if !TRY_MAJOR! LSS 18 goto :eof
if not exist "%~1" goto :eof
set "NODE_EXE=%~1"
set "NODE_VER=%~2"
goto :eof

:missing_node
echo.
if defined CUR_VER (
  echo   Node.js 18 or newer is required ^(current: v!CUR_VER!^).
) else (
  echo   Node.js 18 or newer is required.
)
echo   Please install it from https://nodejs.org/ or switch versions with nvm,
echo   then run this file again.
echo.
pause
exit /b 1
