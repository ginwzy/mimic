# PowerShell 运行脚本
param(
    [Parameter(Mandatory=$true)]
    [string]$ScriptFile,
    
    [string]$EnvFile = "",
    [int]$Timeout = 60000
)

Write-Host ""
Write-Host "========================================"
Write-Host "  JS 沙箱环境 - 一键运行"
Write-Host "========================================"
Write-Host ""

# 切换到脚本所在目录
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# 构建命令
$cmd = "node standalone-runner.js"

if ($EnvFile) {
    $cmd += " --env `"$EnvFile`""
}

if ($Timeout -ne 60000) {
    $cmd += " --timeout $Timeout"
}

$cmd += " `"$ScriptFile`""

Write-Host "正在执行: $ScriptFile"
Write-Host ""
Write-Host "----------------------------------------"

# 执行
Invoke-Expression $cmd

Write-Host "----------------------------------------"
Write-Host ""

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ 执行成功" -ForegroundColor Green
} else {
    Write-Host "✗ 执行失败 (错误代码: $LASTEXITCODE)" -ForegroundColor Red
}

Write-Host ""
