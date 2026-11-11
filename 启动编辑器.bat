@echo off
chcp 65001 >nul
title DB Editor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :missing_node

echo.
echo   Legend of Mir World - DB Editor
echo   Starting local server - the browser will open automatically.
echo   Close this window to stop the editor.
echo.
node server.js
echo.
echo   Editor exited.
pause
exit /b 0

:missing_node
echo.
echo   Node.js not found.
echo   Please install Node.js 18 or newer from https://nodejs.org/
echo.
pause
exit /b 1
