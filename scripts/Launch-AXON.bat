@echo off
setlocal enabledelayedexpansion
title AXON

cd /d "%~dp0\.."

echo ============================================
echo   AXON - starting up
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed.
    echo Download it from https://nodejs.org ^(LTS version^), install it, then run this file again.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies - this only happens once, may take a few minutes...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. See the error above.
        pause
        exit /b 1
    )
)

if not exist ".env" (
    echo First run: creating .env with sane defaults...
    copy /y ".env.example" ".env" >nul

    for /f "delims=" %%s in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')"') do set AUTOSECRET=%%s

    powershell -NoProfile -Command ^
      "(Get-Content '.env') -replace '^AUTH_SECRET=.*', 'AUTH_SECRET=!AUTOSECRET!' -replace '^ALLOWED_ORIGINS=.*', 'ALLOWED_ORIGINS=http://localhost:3001' | Set-Content '.env'"

    echo Using AXON's built-in trial AI key by default.
    echo Want to use your own Groq or Gemini key instead? Run: npm run setup:key
    echo.
)

echo Launching AXON...
call npm run electron:dev

pause
