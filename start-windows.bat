@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  python run.py --setup
) else (
  py -3 run.py --setup
)
pause
