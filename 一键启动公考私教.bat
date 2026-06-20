@echo off
chcp 65001 >nul
title 公考私教软件 - 一键启动
cd /d "%~dp0"

echo.
echo ========================================
echo   公考私教软件 - 一键启动
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js 后再运行。
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 正在安装依赖，首次运行会稍慢...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络或 npm 环境。
    pause
    exit /b 1
  )
)

echo 正在打开浏览器...
start "" "http://localhost:3000"

echo 正在启动本地服务：http://localhost:3000
echo 关闭本窗口即可停止服务。
echo.
call npm run dev -- -p 3000
pause
