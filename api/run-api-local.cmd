@echo off
rem Local API (dev profile: SQLite + admin/admin). Requires Elasticsearch on :9200.
cd /d "%~dp0"
set PYTHONUTF8=1
set SHOPMIND_PROFILE=dev
set PRODUCT_IMAGE_DIR=data/a1_abo_1500/images
.venv\Scripts\python.exe -m uvicorn shopmind.main:app --host 127.0.0.1 --port 8000
