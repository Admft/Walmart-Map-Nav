@echo off
title Walmart Map Nav
cd /d "%~dp0"

if exist "WalmartMapNav.exe" (
  start "" "WalmartMapNav.exe"
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
