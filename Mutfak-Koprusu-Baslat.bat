@echo off
chcp 65001 >nul
title HIPOS Mutfak Yazici Koprusu
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\mutfak-yazici-koprusu.ps1"
pause
