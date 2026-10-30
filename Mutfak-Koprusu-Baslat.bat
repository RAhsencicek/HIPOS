@echo off
chcp 65001 >nul
title HIPOS Mutfak Yazici Koprusu (Windows)
echo HIPOS Mutfak Yazici Koprusu Baslatiliyor...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mutfak-yazici-koprusu.ps1"
if %errorlevel% neq 0 (
    echo.
    echo Bir hata olustu. Yonetici olarak calistirmayi deneyebilirsiniz.
)
pause