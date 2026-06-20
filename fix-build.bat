@echo off
cd /d "%~dp0"
echo ========================================
echo Fixing Next.js Build Issues...
echo ========================================
echo.

echo [Step 1/4] Stopping Node processes...
taskkill /F /IM node.exe 2>nul
if %errorlevel% equ 0 (
    echo [OK] Node processes stopped
    timeout /t 3 >nul
) else (
    echo [OK] No Node processes running
)
echo.

echo [Step 2/4] Cleaning build cache...
if exist .next (
    echo Deleting .next folder...
    rmdir /s /q .next 2>nul
    timeout /t 2 >nul
    if exist .next (
        echo [WARNING] Could not delete .next, trying again...
        rmdir /s /q .next 2>nul
    )
    if exist .next (
        echo [ERROR] Cannot delete .next folder. Please delete it manually.
        pause
        exit /b 1
    ) else (
        echo [OK] .next folder deleted
    )
) else (
    echo [OK] .next folder does not exist
)
echo.

echo [Step 3/4] Checking Node.js and npm...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm not found. Please check Node.js installation.
    pause
    exit /b 1
)
echo [OK] Node.js and npm are installed
echo.

echo [Step 4/4] Reinstalling dependencies (may take a few minutes)...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to install dependencies. Please check network or npm config.
    echo.
    pause
    exit /b 1
)
echo [OK] Dependencies installed
echo.

echo ========================================
echo SUCCESS! Build fixed.
echo ========================================
echo.
echo You can now run: npm run dev
echo.
pause
