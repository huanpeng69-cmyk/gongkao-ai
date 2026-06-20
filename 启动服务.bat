@echo off
chcp 65001 >nul
echo ========================================
echo   公考智学 AI 学习系统 - 启动中...
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 检查依赖...
if not exist "node_modules" (
    echo 正在安装依赖，请稍候...
    call npm install
)

echo [2/3] 清理旧进程...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo 终止占用3000端口的进程 PID=%%a
    taskkill /F /PID %%a >nul 2>&1
)

echo [3/3] 启动开发服务器 (端口固定为3000)...
echo.
echo ========================================
echo   请在浏览器打开:  http://localhost:3000
echo ========================================
echo.
set PORT=3000
call npx next dev -p 3000
pause
