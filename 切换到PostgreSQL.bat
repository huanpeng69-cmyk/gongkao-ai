@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set LOG=%~dp0切换结果-pg.txt
set GONGKAO_DOMAIN=localhost
set DATABASE_URL=postgres://gongkao:change-me@localhost:5433/gongkao
echo 切换到 PostgreSQL %date% %time% > "%LOG%"

echo ===== 1. 备份 users.json =====
if not exist "data\server\users.json" (echo [失败] 找不到 data\server\users.json >> "%LOG%" & goto fail)
if exist "data\server\users.json.before-pg-20261123" (echo 备份已存在，保留原备份 >> "%LOG%") else copy "data\server\users.json" "data\server\users.json.before-pg-20261123" >> "%LOG%" 2>&1
if errorlevel 1 (echo [失败] 1. 备份 >> "%LOG%" & goto fail)
echo [通过] 1. 备份到 data\server\users.json.before-pg-20261123 >> "%LOG%"

echo ===== 2. 启动 postgres =====
call :step "2. 启动 postgres" "docker compose up -d postgres" || goto fail
echo 等待数据库就绪...
timeout /t 8 /nobreak >nul

echo ===== 3. 导入数据 =====
call :step "3. 建表并导入 users.json" "npm run db:import-json" || goto fail

echo ===== 4. 修改 .env.local =====
call :step "4. 写入 .env.local" "node scripts\switch-env-to-pg.mjs %DATABASE_URL%" || goto fail

echo. >> "%LOG%"
echo ===== 全部完成：请重启 npm run dev，网站即改用 PostgreSQL ===== >> "%LOG%"
goto end

:fail
echo. >> "%LOG%"
echo ===== 有步骤失败，已停止；.env.local 未被修改则网站仍用 users.json ===== >> "%LOG%"

:end
start "" notepad "%LOG%"
pause
exit /b

:step
echo. >> "%LOG%"
echo ===== %~1 ===== >> "%LOG%"
call %~2 >> "%LOG%" 2>&1
if errorlevel 1 (echo [失败] %~1 >> "%LOG%" & exit /b 1)
echo [通过] %~1 >> "%LOG%"
exit /b 0
