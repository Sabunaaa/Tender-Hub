@echo off
REM Start API + frontend for local development
set ROOT=%~dp0..
set PYTHONPATH=%ROOT%\backend
start "Tender API" cmd /k ""%ROOT%\.venv\Scripts\python.exe" -m tender_scraper.cli serve --host 127.0.0.1 --port 8000"
timeout /t 2 >nul
start "Tender UI" cmd /k "cd /d "%ROOT%\frontend" && npm run dev"
echo Started API on http://127.0.0.1:8000 and UI on http://127.0.0.1:5173
