@echo off
chcp 65001 >nul
title STORM MULTIMEDIA - Настройка доступа

net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ========================================================
echo   🌪️  STORM MULTIMEDIA - ПРИВЯЗКА ЛОКАЛЬНОГО ДОМЕНА
echo ========================================================
echo.

findstr /C:"stormmultimedia.ru" "%SystemRoot%\System32\drivers\etc\hosts" >nul 2>&1
if %errorlevel% equ 0 (
    echo [ИНФО] Домен stormmultimedia.ru уже добавлен в hosts.
) else (
    echo. >> "%SystemRoot%\System32\drivers\etc\hosts"
    echo 192.168.1.154 stormmultimedia.ru >> "%SystemRoot%\System32\drivers\etc\hosts"
    echo [УСПЕХ] Запись добавлена: 192.168.1.154 stormmultimedia.ru
)

ipconfig /flushdns >nul 2>&1
echo [УСПЕХ] Кэш DNS очищен.
echo.
echo [ИНФО] Открытие сайта в браузере...
start "" "https://stormmultimedia.ru"
pause
