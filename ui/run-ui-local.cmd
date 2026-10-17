@echo off
rem Local UI dev server on http://localhost:5173, proxying /api and /media to the local API.
cd /d "%~dp0"
set VITE_API_PROXY_TARGET=http://127.0.0.1:8000
node node_modules\vite\bin\vite.js --port 5173 --strictPort
