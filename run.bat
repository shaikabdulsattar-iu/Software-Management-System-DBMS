@echo off
title Software Management System
echo ==========================================
echo   Software Management System
echo ==========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)
echo Installing/checking dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. Check your internet connection and try again.
  pause
  exit /b 1
)
echo.
echo Starting application...
echo Open http://localhost:10000 in your browser.
echo.
call npm start
pause
