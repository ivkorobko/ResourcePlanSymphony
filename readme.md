# Resource Plan Symphony

Инструкция по установке и локальному запуску продукта для формирования ресурсного плана и отчетов по спринтам.

## Что входит в проект

- Symfony-приложение в каталоге `.symfony_tmp`.
- Веб-интерфейс на русском языке: ресурсный план, отчет спринтов, сотрудники, загрузка Excel-файла отпусков.
- Локальные seed-данные в `data/settings.json` и `data/vacations.json`.
- Скрипты запуска для Windows: `start.bat` и `stop.bat`.
- Node/Express-версия и тесты в `src`, `public`, `test` используются как дополнительный/legacy-слой проекта.

## Системные требования

### Основной запуск через `start.bat`

- Windows 10/11.
- Свободный порт `4157`.
- PHP 8.2 или выше. В текущей рабочей копии используется локальный PHP `8.3.30` из `.tools/php83/php.exe`.
- Composer, если зависимости Symfony нужно устанавливать заново. В текущей рабочей копии есть локальный `.tools/composer/composer.phar`.

### Дополнительно

- Node.js 20 или выше и npm, если нужно запускать Node-слой или тесты из `package.json`.
- Docker Desktop, если планируется использовать PostgreSQL через `compose.yaml`.

## Быстрый запуск готовой локальной сборки

Если проект передан как готовая папка вместе с каталогами `.tools`, `.symfony_tmp/vendor` и `node_modules`, установка зависимостей не требуется.

1. Откройте PowerShell или `cmd`.
2. Перейдите в каталог проекта:

```bat
cd /d C:\Users\ivanv\Desktop\Web-проекты\09_10_ResPlan-KPI_Sy
```

3. Запустите продукт:

```bat
start.bat
```

4. Откройте в браузере:

```text
http://127.0.0.1:4157
```

5. Для остановки выполните:

```bat
stop.bat
```

## Установка из чистой копии

### 1. Подготовьте PHP

Вариант A: использовать локальный PHP из проекта.

Проверьте, что существует файл:

```text
.tools/php83/php.exe
```

Скрипт `start.bat` ожидает именно этот путь. Если каталога `.tools` нет, его нужно восстановить из поставки продукта или установить PHP 8.2+ отдельно и скорректировать путь `PHP_EXE` в `start.bat`.

Вариант B: установить PHP отдельно.

Установите PHP 8.2+ для Windows и убедитесь, что доступны необходимые расширения PHP для Symfony, Doctrine и PhpSpreadsheet. Минимально проект требует `ctype` и `iconv`; для работы с Excel обычно также нужны расширения семейства `xml`, `zip` и `mbstring`.

### 2. Установите PHP-зависимости Symfony

Перейдите в Symfony-каталог:

```bat
cd /d C:\Users\ivanv\Desktop\Web-проекты\09_10_ResPlan-KPI_Sy\.symfony_tmp
```

Если в проекте есть локальный Composer:

```bat
..\.tools\php83\php.exe ..\.tools\composer\composer.phar install
```

Если Composer установлен глобально:

```bat
composer install
```

### 3. Проверьте настройки окружения

Основные настройки Symfony находятся в:

```text
.symfony_tmp/.env
.symfony_tmp/.env.local
```

В текущей конфигурации `.env.local` содержит подключение к PostgreSQL:

```text
DATABASE_URL="postgresql://resplan:resplan@127.0.0.1:5432/resplan?serverVersion=17&charset=utf8"
```

База данных не является обязательной для первого локального запуска: если PostgreSQL недоступен, `StateStore` переключается на файловое хранилище в `.symfony_tmp/var/state`.

### 4. При необходимости поднимите PostgreSQL

В проекте есть Docker Compose-конфигурация в `.symfony_tmp/compose.yaml`, но значения по умолчанию в compose отличаются от `DATABASE_URL` из `.env.local`.

Если нужна именно PostgreSQL-БД, приведите настройки к одному виду. Например:

```bat
cd /d C:\Users\ivanv\Desktop\Web-проекты\09_10_ResPlan-KPI_Sy\.symfony_tmp
set POSTGRES_DB=resplan
set POSTGRES_USER=resplan
set POSTGRES_PASSWORD=resplan
docker compose up -d database
```

После запуска БД Symfony сам создаст таблицу `app_document` при первом обращении к приложению.

### 5. Запустите приложение

Вернитесь в корень проекта:

```bat
cd /d C:\Users\ivanv\Desktop\Web-проекты\09_10_ResPlan-KPI_Sy
```

Запустите:

```bat
start.bat
```

Ожидаемый результат:

```text
Symfony is up on http://127.0.0.1:4157
```

## Данные и хранилище

- Начальные настройки продукта лежат в `data/settings.json`.
- Начальный файл отпусков/состояние лежит в `data/vacations.json`.
- При доступной PostgreSQL-БД данные сохраняются в таблицу `app_document`.
- При недоступной БД данные сохраняются локально в `.symfony_tmp/var/state`.
- Логи запуска пишутся в каталог `logs`.

## Работа с интерфейсом

1. Откройте `http://127.0.0.1:4157`.
2. На вкладке "Ресурсный план" загрузите Excel-файл графика отпусков.
3. Выберите или настройте команду.
4. Выполните анализ и сформируйте выгрузку ресурсного плана.
5. Для проверки формата входного файла можно скачать шаблон по маршруту `/download/vacations-sample-template`.

## Дополнительные Node-команды

В корне проекта есть `package.json` с командами для Node/Express-слоя.

Установка npm-зависимостей:

```bat
npm install
```

Запуск Node-сервера:

```bat
npm start
```

Запуск Node-сервера в режиме разработки:

```bat
npm run dev
```

Запуск тестов:

```bat
npm test
```

По умолчанию Node-сервер использует порт `3000`, а основной Symfony-запуск через `start.bat` использует порт `4157`.

## Проверка установки

После запуска проверьте:

- Главная страница открывается по адресу `http://127.0.0.1:4157`.
- API bootstrap отвечает без ошибки:

```text
http://127.0.0.1:4157/api/bootstrap
```

- В каталоге `logs` появились файлы `site-4157.out.log` и `site-4157.err.log`.

## Типовые проблемы

### `Local PHP executable not found: .tools\php83\php.exe`

Каталог `.tools` отсутствует или не был передан вместе с проектом. Восстановите `.tools` из поставки продукта либо установите PHP 8.2+ и измените переменную `PHP_EXE` в `start.bat`.

### `Symfony public entrypoint not found: .symfony_tmp\public\index.php`

Проверьте, что каталог `.symfony_tmp` присутствует полностью и зависимости Symfony установлены.

### `Symfony did not become ready on port 4157`

Проверьте:

- не занят ли порт `4157`;
- нет ли ошибок в `logs/site-4157.err.log`;
- установлен ли каталог `.symfony_tmp/vendor`;
- доступен ли PHP и нужные расширения.

### PostgreSQL не запущен

Для локального режима это не блокирует запуск: приложение должно переключиться на файловое хранилище `.symfony_tmp/var/state`. Если требуется работа именно с PostgreSQL, запустите БД и проверьте `DATABASE_URL`.

## Остановка и повторный запуск

Остановить приложение:

```bat
stop.bat
```

Запустить заново:

```bat
start.bat
```

`stop.bat` завершает процесс из `logs/active-pid.txt` и освобождает порт `4157`.
