@echo off
rem 카탄 증강 체스 서버 켜기 - 이 파일을 더블클릭하세요.
chcp 65001 >nul
cd /d "%~dp0"

rem 1) 폴더에 node.exe 가 같이 들어 있으면 그걸 쓴다 (설치 불필요)
if exist "%~dp0node.exe" (
  set "NODE=%~dp0node.exe"
  goto :run
)

rem 2) 없으면 이 컴퓨터에 설치된 node 를 찾는다
where node >nul 2>nul
if not errorlevel 1 (
  set "NODE=node"
  goto :run
)

echo.
echo  Node 를 찾지 못했습니다.
echo  node.exe 를 이 폴더에 같이 넣거나, https://nodejs.org 에서 설치해 주세요.
echo.
pause
exit /b 1

:run
start "" http://localhost:8080
"%NODE%" server\server.js
echo.
echo  서버가 멈췄습니다.
pause
