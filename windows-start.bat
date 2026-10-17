@echo off
rem Double-click to start the companion on Windows. It checks what is needed, offers to install what is missing, and opens the page.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-start.ps1"
echo.
pause
