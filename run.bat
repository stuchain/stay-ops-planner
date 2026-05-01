@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"
set "ROOT_DIR=%cd%"
set "APP_URL=http://localhost:3000/app/calendar"

echo [stay-ops] Starting one-command local launcher...
echo [stay-ops] Workspace: %ROOT_DIR%

if not exist "pnpm-lock.yaml" (
  echo [stay-ops] ERROR: pnpm-lock.yaml not found. Run this script from repo root.
  exit /b 1
)

set "NEEDS_INSTALL=0"
if not exist "node_modules" set "NEEDS_INSTALL=1"
if not exist "node_modules\.modules.yaml" set "NEEDS_INSTALL=1"

if exist "node_modules\.modules.yaml" (
  for /f %%i in ('powershell -NoProfile -Command "(Get-Item 'pnpm-lock.yaml').LastWriteTimeUtc.Ticks"') do set "LOCK_TICKS=%%i"
  for /f %%i in ('powershell -NoProfile -Command "(Get-Item 'node_modules/.modules.yaml').LastWriteTimeUtc.Ticks"') do set "MODULES_TICKS=%%i"
  if defined LOCK_TICKS if defined MODULES_TICKS (
    if !LOCK_TICKS! GTR !MODULES_TICKS! set "NEEDS_INSTALL=1"
  )
)

if "%NEEDS_INSTALL%"=="1" (
  echo [stay-ops] Installing dependencies with pnpm...
  call corepack pnpm install
  if errorlevel 1 (
    echo [stay-ops] ERROR: Dependency install failed.
    exit /b 1
  )
) else (
  echo [stay-ops] Dependencies look up to date.
)

echo [stay-ops] Stopping anything on port 3000...
for /f "tokens=5" %%p in ('netstat -aon ^| findstr /r /c:":3000 .*LISTENING"') do (
  echo [stay-ops] Killing PID %%p on port 3000
  taskkill /PID %%p /F >nul 2>&1
)

echo [stay-ops] Cleaning stale workspace node processes...
powershell -NoProfile -Command "$workspace = (Resolve-Path '.').Path; $procs = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like \"*$workspace*\" }; foreach ($p in $procs) { Write-Host ('[stay-ops] Killing node PID ' + $p.ProcessId); Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }"

echo [stay-ops] Clearing Next.js cache (.next)...
if exist "apps\web\.next" (
  rmdir /s /q "apps\web\.next"
)

echo [stay-ops] Starting Docker dependencies (postgres, redis)...
docker compose up -d postgres redis
if errorlevel 1 (
  echo [stay-ops] ERROR: Failed to start Docker services. Is Docker Desktop running?
  exit /b 1
)

echo [stay-ops] Preparing browser...
ping 127.0.0.1 -n 4 >nul

set "BRAVE_1=%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
set "BRAVE_2=%ProgramFiles(x86)%\BraveSoftware\Brave-Browser\Application\brave.exe"

if exist "%BRAVE_1%" (
  echo [stay-ops] Opening app in Brave...
  start "" "%BRAVE_1%" "%APP_URL%"
) else if exist "%BRAVE_2%" (
  echo [stay-ops] Opening app in Brave...
  start "" "%BRAVE_2%" "%APP_URL%"
) else (
  echo [stay-ops] Brave not found, opening default browser...
  start "" "%APP_URL%"
)

echo [stay-ops] Starting dev server in this terminal...
call corepack pnpm dev
exit /b %errorlevel%
