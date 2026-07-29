@echo off
setlocal enabledelayedexpansion

set "REPO_URL=https://github.com/ENGDOKHA/watchparty.git"
set "REPO=%USERPROFILE%\Desktop\watchparty-repo"

echo =========================================
echo   Watch Party  -  update and push
echo =========================================
echo.

rem ---------- check git ----------
where git >nul 2>nul
if errorlevel 1 (
  echo [X] Git is not installed.
  echo     Install it from https://git-scm.com/download/win  then run this again.
  pause & exit /b 1
)

rem ---------- find the new files ----------
set "SRC="
for %%D in (
  "%~dp0watchparty"
  "%~dp0."
  "%USERPROFILE%\Downloads\watchparty\watchparty"
  "%USERPROFILE%\Downloads\watchparty"
  "%USERPROFILE%\Desktop\watchparty\watchparty"
  "%USERPROFILE%\Desktop\watchparty"
) do (
  if not defined SRC if exist "%%~D\server.js" if exist "%%~D\public\room.html" set "SRC=%%~D"
)

if not defined SRC (
  echo Could not auto-find the new files.
  set /p "SRC=Paste the full path to the unzipped watchparty folder: "
)

if not exist "%SRC%\server.js" (
  echo [X] server.js not found in "%SRC%"
  pause & exit /b 1
)
echo [i] New files from: %SRC%

rem ---------- clone or update repo ----------
if not exist "%REPO%\.git" (
  echo [i] Cloning your repo to %REPO% ...
  git clone "%REPO_URL%" "%REPO%"
  if errorlevel 1 ( echo [X] Clone failed. & pause & exit /b 1 )
) else (
  echo [i] Repo already here, pulling latest ...
  git -C "%REPO%" pull --no-rebase
)

rem ---------- copy files in ----------
echo [i] Copying files ...
copy /Y "%SRC%\server.js"    "%REPO%\server.js"    >nul
copy /Y "%SRC%\package.json" "%REPO%\package.json" >nul
if exist "%SRC%\README.md"    copy /Y "%SRC%\README.md"    "%REPO%\README.md"    >nul
if exist "%SRC%\unittest.js"  copy /Y "%SRC%\unittest.js"  "%REPO%\unittest.js"  >nul
if exist "%SRC%\smoketest.js" copy /Y "%SRC%\smoketest.js" "%REPO%\smoketest.js" >nul
if exist "%SRC%\.gitignore"   copy /Y "%SRC%\.gitignore"   "%REPO%\.gitignore"   >nul
if not exist "%REPO%\public" mkdir "%REPO%\public"
copy /Y "%SRC%\public\*.html" "%REPO%\public\" >nul

rem ---------- commit and push ----------
echo [i] Committing and pushing ...
git -C "%REPO%" add -A
git -C "%REPO%" commit -m "Update watch party (sync, chat, diagnostics)"
if errorlevel 1 echo [i] Nothing new to commit - files may already be up to date.
git -C "%REPO%" push
if errorlevel 1 (
  echo.
  echo [X] Push failed. If a GitHub sign-in window appeared, finish signing in
  echo     and run this script again.
  pause & exit /b 1
)

echo.
echo [OK] Pushed! Render redeploys automatically in 1-2 minutes.
echo      https://watchparty-wh54.onrender.com
echo.
pause
