@echo off
title Koka Streamer Bridge
cd /d "%~dp0"

echo ===================================================
echo   Starting Koka Media Streamer Bridge...
echo ===================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

:: Check if cloudflared exists
where cloudflared >nul 2>nul
if %errorlevel% equ 0 (
    echo Starting Cloudflare Tunnel in background window...
    start "Koka Cloudflare Tunnel" cmd /k "cloudflared tunnel --url http://localhost:3399"
) else (
    echo [NOTE] cloudflared command not found in PATH.
    echo If you want automatic tunnels, install cloudflared or run it separately.
)

echo Starting Koka Node.js Streamer...
node index.js

pause
