@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\hipos-baslat.ps1" %*
if errorlevel 1 (
  echo.
  echo HIPOS baslatilamadi. Yukaridaki hata mesajini kontrol edin.
  pause
)
