@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   ETH合约智能推荐系统 - Windows安装脚本
echo ========================================
echo.

:: 检查管理员权限
net session >nul 2>&1
if %errorLevel% == 0 (
    echo ✅ 管理员权限检查通过
) else (
    echo ❌ 请以管理员身份运行此脚本
    pause
    exit /b 1
)

:: 设置变量
set "PROJECT_DIR=%~dp0"
set "NODE_MIN_VERSION=18.0.0"
set "PYTHON_MIN_VERSION=3.8.0"

echo 📁 项目目录: %PROJECT_DIR%
echo.

:: 检查Node.js
echo 🔍 检查Node.js环境...
node --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ❌ 未检测到Node.js，请先安装Node.js %NODE_MIN_VERSION%或更高版本
    echo 📥 下载地址: https://nodejs.org/
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo ✅ Node.js版本: %NODE_VERSION%
)

:: 检查npm
echo 🔍 检查npm环境...
npm --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ❌ npm未正确安装
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
    echo ✅ npm版本: %NPM_VERSION%
)

:: 检查Python
echo 🔍 检查Python环境...
python --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ⚠️  未检测到Python，尝试检查python3...
    python3 --version >nul 2>&1
    if %errorLevel% neq 0 (
        echo ❌ 未检测到Python，请先安装Python %PYTHON_MIN_VERSION%或更高版本
        echo 📥 下载地址: https://www.python.org/downloads/
        pause
        exit /b 1
    ) else (
        for /f "tokens=2" %%i in ('python3 --version') do set PYTHON_VERSION=%%i
        echo ✅ Python版本: %PYTHON_VERSION%
        set PYTHON_CMD=python3
    )
) else (
    for /f "tokens=2" %%i in ('python --version') do set PYTHON_VERSION=%%i
    echo ✅ Python版本: %PYTHON_VERSION%
    set PYTHON_CMD=python
)

echo.
echo 📦 开始安装依赖...

:: 安装Node.js依赖
echo 🔄 安装Node.js依赖包...
call npm install
if %errorLevel% neq 0 (
    echo ❌ Node.js依赖安装失败
    pause
    exit /b 1
)
echo ✅ Node.js依赖安装完成

:: 安装Python依赖
echo 🔄 安装Python依赖包...
cd /d "%PROJECT_DIR%kronos-service"
if exist requirements.txt (
    %PYTHON_CMD% -m pip install -r requirements.txt
    if %errorLevel% neq 0 (
        echo ❌ Python依赖安装失败
        pause
        exit /b 1
    )
    echo ✅ Python依赖安装完成
) else (
    echo ⚠️  未找到requirements.txt，跳过Python依赖安装
)

:: 返回项目根目录
cd /d "%PROJECT_DIR%"

:: 配置环境文件
echo.
echo ⚙️ 配置环境文件...

if not exist .env (
    if exist .env.windows (
        echo 📋 使用Windows专用配置...
        copy .env.windows .env >nul
        echo ✅ 已复制.env.windows为.env
    ) else if exist .env.example (
        echo 📋 使用示例配置...
        copy .env.example .env >nul
        echo ✅ 已复制.env.example为.env
    ) else (
        echo ❌ 未找到配置模板文件
        pause
        exit /b 1
    )
) else (
    echo ✅ .env文件已存在，跳过配置
)

:: 创建必要目录
echo 🗂️ 创建必要目录...
if not exist data mkdir data
if not exist data\models mkdir data\models
if not exist cache mkdir cache
if not exist logs mkdir logs
if not exist tests\reports mkdir tests\reports
echo ✅ 目录创建完成

:: 编译TypeScript
echo 🔨 编译TypeScript代码...
call npx tsc
if %errorLevel% neq 0 (
    echo ❌ TypeScript编译失败
    pause
    exit /b 1
)
echo ✅ TypeScript编译完成

:: 运行测试
echo 🧪 运行系统测试...
if exist tests\smoke\smoke-test.cjs (
    node tests\smoke\smoke-test.cjs
    if %errorLevel% neq 0 (
        echo ⚠️  冒烟测试失败，但继续安装...
    ) else (
        echo ✅ 冒烟测试通过
    )
) else (
    echo ⚠️  未找到测试文件，跳过测试
)

:: 创建启动脚本
echo 📝 创建启动脚本...
(
echo @echo off
echo chcp 65001 ^>nul
echo echo 🚀 启动ETH合约智能推荐系统...
echo cd /d "%PROJECT_DIR%"
echo call npm start
echo pause
) > start-system.bat
echo ✅ 启动脚本已创建: start-system.bat

:: 创建桌面快捷方式（可选）
echo 🖥️ 创建桌面快捷方式...
set "DESKTOP=%USERPROFILE%\Desktop"
if exist "%DESKTOP%" (
    (
    echo @echo off
    echo cd /d "%PROJECT_DIR%"
    echo start "" "%PROJECT_DIR%start-system.bat"
    ) > "%DESKTOP%\ETH推荐系统.bat"
    echo ✅ 桌面快捷方式已创建
) else (
    echo ⚠️  未找到桌面目录，跳过快捷方式创建
)

:: 防火墙配置提醒
echo.
echo 🔥 防火墙配置提醒:
echo    系统将使用端口3031和8001
echo    如遇连接问题，请检查Windows防火墙设置
echo.

:: 完成安装
echo.
echo ========================================
echo ✅ 安装完成！
echo ========================================
echo.
echo 📋 安装摘要:
echo    • Node.js版本: %NODE_VERSION%
echo    • Python版本: %PYTHON_VERSION%
echo    • 项目目录: %PROJECT_DIR%
echo    • Web端口: 3031
echo    • Kronos端口: 8001
echo.
echo 🚀 启动方式:
echo    1. 双击桌面上的"ETH推荐系统"快捷方式
echo    2. 或运行: start-system.bat
echo    3. 或命令行: npm start
echo.
echo 🌐 访问地址:
echo    • 主控制台: http://localhost:3031
echo    • 推荐条件: http://localhost:3031/recommendation-conditions.html
echo.
echo 📚 更多信息请查看README.md文件
echo.

:: 询问是否立即启动
set /p START_NOW="是否立即启动系统？(Y/N): "
if /i "%START_NOW%"=="Y" (
    echo.
    echo 🚀 正在启动系统...
    start "" "%PROJECT_DIR%start-system.bat"
) else (
    echo.
    echo 💡 您可以稍后通过以下方式启动系统:
    echo    • 双击桌面快捷方式
    echo    • 运行start-system.bat
)

echo.
echo 按任意键退出安装程序...
pause >nul