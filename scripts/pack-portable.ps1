#requires -Version 5.1
# 组装便携版发行包：out -> www + 本地静态服务器 + 启动.bat -> zip
# 输出目录与 zip 按 office-toolkit/package.json 的 version 命名：
#   release/浩匣-便携版-v<version>/  和  release/浩匣-便携版-v<version>.zip
# 用法：npm run pack:portable          （使用现有构建产物）
#       npm run pack:portable -- -Build （先重新构建再打包，post-commit 钩子用这个）

param(
    [switch]$Build
)

$ErrorActionPreference = 'Stop'

$root      = Split-Path -Parent $PSScriptRoot
$appDir    = Join-Path $root 'office-toolkit'
$outDir    = Join-Path $appDir 'out'
$releaseDir = Join-Path $root 'release'
$vendorDir = Join-Path $releaseDir '_vendor'
$tplDir    = Join-Path $PSScriptRoot 'portable'

$appVersion = (Get-Content (Join-Path $appDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (-not $appVersion) { throw '读不到 office-toolkit/package.json 里的 version' }
$pkgName   = "浩匣-便携版-v$appVersion"
$pkgDir    = Join-Path $releaseDir $pkgName
$zipPath   = Join-Path $releaseDir "$pkgName.zip"

$swsVersion = '2.44.3'
$swsExe     = Join-Path $vendorDir "static-web-server-$swsVersion.exe"

if ($Build) {
    Write-Host '[1/5] 构建网站 ...'
    Push-Location $appDir
    try { npm run build } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'npm run build 失败，已中止' }
} else {
    Write-Host '[1/5] 跳过构建，使用现有 out 产物'
}

$indexHtml = Join-Path $outDir 'index.html'
if (-not (Test-Path $indexHtml)) {
    throw "找不到构建产物：$outDir`n先执行 npm run build，或加 -Build 参数。"
}

$outTime  = (Get-Item $indexHtml).LastWriteTime
$newerSrc = Get-ChildItem (Join-Path $appDir 'src') -Recurse -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($newerSrc -and $newerSrc.LastWriteTime -gt $outTime) {
    Write-Warning "源码比产物新（$($newerSrc.Name) 修改于 $($newerSrc.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))），产物可能是旧的。加 -Build 重新构建。"
}

$swsLicApache = Join-Path $vendorDir "static-web-server-$swsVersion-LICENSE-APACHE"
$swsLicMit    = Join-Path $vendorDir "static-web-server-$swsVersion-LICENSE-MIT"
$swsCached    = (Test-Path $swsExe) -and (Test-Path $swsLicApache) -and (Test-Path $swsLicMit)

if (-not $swsCached) {
    Write-Host "[2/5] 下载 static-web-server $swsVersion ..."
    New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null
    $url = "https://github.com/static-web-server/static-web-server/releases/download/v$swsVersion/static-web-server-v$swsVersion-x86_64-pc-windows-msvc.zip"
    $tmpZip = Join-Path $vendorDir "sws-$swsVersion.zip"
    $tmpDir = Join-Path $vendorDir '_extract'
    Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing -TimeoutSec 180
    Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force
    $found = Get-ChildItem $tmpDir -Recurse -Filter 'static-web-server.exe' | Select-Object -First 1
    if (-not $found) { throw '压缩包里没找到 static-web-server.exe' }
    Move-Item $found.FullName $swsExe -Force
    # 二进制随包分发必须附许可证声明（MIT OR Apache-2.0 双许可）
    foreach ($pair in @(@('LICENSE-APACHE', $swsLicApache), @('LICENSE-MIT', $swsLicMit))) {
        $lic = Get-ChildItem $tmpDir -Recurse -Filter $pair[0] | Select-Object -First 1
        if (-not $lic) { throw "压缩包里没找到 $($pair[0])" }
        Copy-Item $lic.FullName $pair[1] -Force
    }
    Remove-Item $tmpZip -Force
    Remove-Item $tmpDir -Recurse -Force
} else {
    Write-Host "[2/5] 复用已缓存的 static-web-server $swsVersion"
}

Write-Host '[3/5] 复制静态产物与模板 ...'
# 上一次测试启动的服务会锁住包里的 exe，导致清理失败；它只会来自本发行包，直接结束
$running = Get-CimInstance Win32_Process -Filter "Name = 'static-web-server.exe'"
foreach ($proc in $running) {
    Write-Host "  - 结束残留进程 pid=$($proc.ProcessId)"
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($running) { Start-Sleep -Milliseconds 600 }

if (Test-Path $pkgDir) { Remove-Item $pkgDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null

Copy-Item $outDir -Destination (Join-Path $pkgDir 'www') -Recurse
Copy-Item $swsExe -Destination (Join-Path $pkgDir 'static-web-server.exe')
Copy-Item $swsLicApache -Destination (Join-Path $pkgDir 'LICENSE-APACHE.txt')
Copy-Item $swsLicMit -Destination (Join-Path $pkgDir 'LICENSE-MIT.txt')
foreach ($name in @('启动.bat', 'sws.toml', '使用说明.txt')) {
    $src = Join-Path $tplDir $name
    if (-not (Test-Path $src)) { throw "缺少模板文件：$src" }
    Copy-Item $src -Destination (Join-Path $pkgDir $name)
}

Write-Host '[4/5] 剔除内部调试页 ...'
$removed = 0
Get-ChildItem (Join-Path $pkgDir 'www') -Directory -Filter 'debug-*' | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force
    Write-Host "  - $($_.Name)"
    $removed++
}
if ($removed -eq 0) { Write-Host '  （无）' }

Write-Host '[5/5] 打包 zip ...'
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $pkgDir -DestinationPath $zipPath -CompressionLevel Optimal

$sizeMB = [Math]::Round((Get-Item $zipPath).Length / 1MB, 2)
$files  = (Get-ChildItem $pkgDir -Recurse -File).Count

Write-Host ''
Write-Host "完成：$zipPath"
Write-Host "  版本 $appVersion"
Write-Host "  体积 $sizeMB MB，$files 个文件"
Write-Host "  产物时间 $($outTime.ToString('yyyy-MM-dd HH:mm'))"
