@echo off
chcp 65001 >nul
echo 🚀 启动ETH智能交易系统 (Windows版)
echo.

REM 检查Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未安装Node.js
    echo 请从 https://nodejs.org 下载并安装Node.js
    pause
    exit /b 1
)

REM 检查npm
npm --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: npm不可用
    pause
    exit /b 1
)

echo ✅ Node.js环境检查通过

REM 进入data目录
cd /d "%~dp0data"
if not exist package.json (
    echo ❌ 错误: 找不到package.json文件
    pause
    exit /b 1
)

echo 📦 安装依赖包...
call npm install
if errorlevel 1 (
    echo ❌ 依赖安装失败
    pause
    exit /b 1
)

echo ✅ 依赖安装完成

REM 复制Windows配置
if exist "..\configs\.env.windows" (
    copy "..\configs\.env.windows" ".env" >nul
    echo ✅ Windows配置已应用
) else (
    echo ⚠️  警告: 未找到Windows配置文件，使用默认配置
)

echo.
echo 🚀 启动系统...
echo 📊 Web界面: http://localhost:3031
echo 🔧 API接口: http://localhost:3031/api
echo.
echo 按 Ctrl+C 停止服务
echo.

REM 设置环境变量并启动
set WEB_PORT=3031
set NODE_ENV=production
call npm start

pause
