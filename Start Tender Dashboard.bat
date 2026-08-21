@echo off
title Tender Dashboard
cd /d "%~dp0"

set "PYTHON=%~dp0.venv\Scripts\python.exe"
set "PYTHONPATH=%~dp0backend"
set "FRONTEND=%~dp0frontend"

if not exist "%PYTHON%" (
    echo Python virtual environment not found at:
    echo   %PYTHON%
    echo.
    echo Create it first:
    echo   py -m venv .venv
    echo   .venv\Scripts\python.exe -m pip install -r backend\requirements.txt
    echo.
    pause
    exit /b 1
)

if not exist "%FRONTEND%\node_modules\" (
    echo Installing frontend dependencies...
    pushd "%FRONTEND%"
    call npm install
    popd
)

echo Starting API on http://127.0.0.1:8000 ...
start "Tender API" cmd /k "set PYTHONPATH=%PYTHONPATH%&& "%PYTHON%" -m tender_scraper.cli serve --host 127.0.0.1 --port 8000"

timeout /t 2 /nobreak >nul

echo Starting UI on http://127.0.0.1:5173 ...
start "Tender UI" cmd /k "cd /d "%FRONTEND%" && npm run dev"

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173"

echo.
echo Tender Dashboard is starting.
echo   API:  http://127.0.0.1:8000
echo   UI:   http://127.0.0.1:5173
echo.
echo Close the "Tender API" and "Tender UI" windows to stop.
echo.
pause
