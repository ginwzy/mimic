@echo off
REM 一键运行脚本 - 在 IDE 中双击运行

echo.
echo ========================================
echo   JS 沙箱环境 - 一键运行
echo ========================================
echo.

REM 检查参数
if "%1"=="" (
    echo 用法: run.bat ^<script.js^>
    echo.
    echo 示例:
    echo   run.bat a_bogus119.js
    echo   run.bat test.js
    echo.
    pause
    exit /b 1
)

REM 切换到项目目录
cd /d "%~dp0"

echo 正在执行: %1
echo.
echo ----------------------------------------
node standalone-runner.js %*
echo ----------------------------------------
echo.

if %ERRORLEVEL% EQU 0 (
    echo ✓ 执行成功
) else (
    echo ✗ 执行失败 (错误代码: %ERRORLEVEL%)
)

echo.
pause
