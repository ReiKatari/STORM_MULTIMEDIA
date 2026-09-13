@echo off
chcp 65001 >nul
title STORM MULTIMEDIA

echo.
echo ========================================================
echo   🌪️  STORM MULTIMEDIA
echo   Мультимедийный портал фильмов, сериалов и аниме
echo ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

netstat -ano | findstr :3900 >nul 2>&1
if not errorlevel 1 goto already_running

echo [ИНФО] Запуск локального сервера STORM MULTIMEDIA на порту 3900...
echo [ИНФО] Открытие веб-интерфейса в браузере...
start "" "http://localhost:3900"
node server.js
goto end

:already_running
echo [ИНФО] Сервер STORM MULTIMEDIA уже запущен на порту 3900.
echo [ИНФО] Открытие веб-интерфейса в браузере: http://localhost:3900
start "" "http://localhost:3900"
goto end

:no_node
echo [ОШИБКА] Node.js не найден в системе!
echo Установите Node.js с официального сайта: nodejs.org
pause

:end
