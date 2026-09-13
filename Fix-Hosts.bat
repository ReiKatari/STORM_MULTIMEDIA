@echo off
chcp 65001 >nul
title Настройка доступа к stormmultimedia.ru

echo ========================================================
echo   🌪️  STORM MULTIMEDIA - ПРИВЯЗКА ЛОКАЛЬНОГО ДОМЕНА
echo ========================================================
echo.

net session >nul 2>&1
if errorlevel 1 (
    echo [ВНИМАНИЕ] Этот скрипт требует прав Администратора для записи в hosts.
    echo Перезапуск с запросом прав Администратора...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b 0
)

findstr /C:"stormmultimedia.ru" "%SystemRoot%\System32\drivers\etc\hosts" >nul 2>&1
if not errorlevel 1 (
    echo [ИНФО] Домен stormmultimedia.ru уже присутствует в файле hosts.
    goto done
)

echo 192.168.1.154 stormmultimedia.ru >> "%SystemRoot%\System32\drivers\etc\hosts"
echo [УСПЕХ] Запись добавлена: 192.168.1.154 stormmultimedia.ru

:done
ipconfig /flushdns >nul 2>&1
echo [УСПЕХ] Кэш DNS успешно очищен.
echo Теперь сайт https://stormmultimedia.ru открывается прямо с вашего Synology NAS!
echo.
start "" "https://stormmultimedia.ru"
pause
