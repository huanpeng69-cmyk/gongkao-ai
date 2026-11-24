@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set LOG=%~dp0验证结果-pg.txt
echo 公考私教 阶段1 验证 %date% %time% > "%LOG%"

if "%1"=="pg" goto pgonly
call :step "1. npm install" "npm install"
call :step "2. 类型检查" "npx tsc --noEmit"
call :step "3. 原有 JSON 测试" "npm test"
:pgonly

where docker >nul 2>nul
if errorlevel 1 (
  echo [跳过] 4. 未检测到 Docker，PG 测试跳过 >> "%LOG%"
  goto build
)
set GONGKAO_DOMAIN=localhost
docker rm -f gongkao-postgres >nul 2>nul
call :step "4a. 启动 postgres" "docker compose up -d postgres"
echo 等待数据库就绪...
timeout /t 8 /nobreak >nul
docker exec gongkao-postgres createdb -U gongkao gongkao_test >> "%LOG%" 2>&1
set TEST_DATABASE_URL=postgres://gongkao:change-me@localhost:5433/gongkao_test
call :step "4b. PG 驱动测试" "npm run test:pg"
set DATABASE_URL=postgres://gongkao:change-me@localhost:5433/gongkao_test
call :step "5. 导入预览(只读，不写入)" "npm run db:import-json -- --dry-run"

:build
call :step "6. 构建" "npm run build"

echo.
echo ===== 完成，结果已保存到 验证结果-pg.txt，把它发给我即可 =====
start "" notepad "%LOG%"
pause
exit /b

:step
echo.
echo ===== %~1 =====
echo. >> "%LOG%"
echo ===== %~1 ===== >> "%LOG%"
call %~2 >> "%LOG%" 2>&1
if errorlevel 1 (echo [失败] %~1 >> "%LOG%" & echo [失败] %~1) else (echo [通过] %~1 >> "%LOG%" & echo [通过] %~1)
exit /b
