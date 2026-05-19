# Resource Plan Symphony для Linux

Инструкция по развертыванию проекта из Git-репозитория и локальному запуску на Linux.

## Что входит в проект

- Основное приложение Symfony находится в каталоге `.symfony_tmp`.
- Веб-интерфейс работает на русском языке и предоставляет ресурсный план, отчет по спринтам, настройки сотрудников и загрузку Excel-файла отпусков.
- Начальные локальные данные хранятся в `data/settings.json` и `data/vacations.json`.
- Windows-скрипты `start.bat` и `stop.bat` в Linux не используются: запуск выполняется обычной командой `php -S`.
- Node/Express-слой из `src`, `public`, `test` остается дополнительной legacy-частью проекта.

## Системные требования

- Linux с доступом к терминалу.
- Git.
- PHP 8.2 или выше.
- Composer.
- Свободный порт `4157`.
- PHP-расширения, необходимые для Symfony и Excel-обработки: `ctype`, `iconv`, `mbstring`, `xml`, `zip`.

Дополнительно:

- Node.js 20+ и npm, если нужно запускать legacy Node-слой или тесты из `package.json`.
- Docker и Docker Compose, если требуется PostgreSQL из `.symfony_tmp/compose.yaml`.

## Клонирование проекта из Git

1. Клонируйте репозиторий:

```bash
git clone <URL_ВАШЕГО_РЕПОЗИТОРИЯ> resource-plan-symphony
```

2. Перейдите в каталог проекта:

```bash
cd resource-plan-symphony
```

## Установка зависимостей

### 1. Установите PHP-зависимости Symfony

```bash
cd .symfony_tmp
composer install
cd ..
```

Если `composer` не найден, установите его через пакетный менеджер вашей системы или с сайта Composer.

### 2. При необходимости установите npm-зависимости

Этот шаг нужен только для legacy Node-слоя и тестов:

```bash
npm install
```

## Настройки окружения

Основные файлы окружения Symfony:

```text
.symfony_tmp/.env
.symfony_tmp/.env.local
```

В текущей локальной конфигурации задано подключение к PostgreSQL:

```text
DATABASE_URL="postgresql://resplan:resplan@127.0.0.1:5432/resplan?serverVersion=17&charset=utf8"
```

PostgreSQL не обязателен для первого локального запуска. Если база недоступна, приложение использует файловое хранилище в `.symfony_tmp/var/state`.

## Опционально: запуск PostgreSQL через Docker

Файл `.symfony_tmp/compose.yaml` использует значения по умолчанию `app / !ChangeMe! / app`, а `.env.local` ожидает `resplan / resplan / resplan`. Перед запуском БД лучше привести их к одному виду.

Пример запуска с параметрами из `.env.local`:

```bash
cd .symfony_tmp
POSTGRES_DB=resplan POSTGRES_USER=resplan POSTGRES_PASSWORD=resplan docker compose up -d database
cd ..
```

После запуска БД Symfony создаст таблицу `app_document` при первом обращении к приложению.

## Запуск приложения на Linux

Из корня проекта выполните:

```bash
mkdir -p logs
php -S 127.0.0.1:4157 -t .symfony_tmp/public .symfony_tmp/public/index.php \
  > logs/site-4157.out.log 2> logs/site-4157.err.log
```

Если нужен запуск в фоне:

```bash
mkdir -p logs
nohup php -S 127.0.0.1:4157 -t .symfony_tmp/public .symfony_tmp/public/index.php \
  > logs/site-4157.out.log 2> logs/site-4157.err.log &
echo $! > logs/active-pid.txt
```

После запуска откройте:

```text
http://127.0.0.1:4157
```

## Остановка приложения

Если процесс был запущен через `nohup` и PID сохранен:

```bash
kill "$(cat logs/active-pid.txt)"
rm -f logs/active-pid.txt
```

Если PID-файла нет, можно найти процесс по порту:

```bash
fuser -k 4157/tcp
```

## Данные и хранилище

- Начальные настройки находятся в `data/settings.json`.
- Начальное состояние отпусков хранится в `data/vacations.json`.
- При доступной PostgreSQL данные пишутся в таблицу `app_document`.
- При недоступной БД данные сохраняются в `.symfony_tmp/var/state`.
- Логи запуска находятся в каталоге `logs`.

## Работа с интерфейсом

1. Откройте `http://127.0.0.1:4157`.
2. На вкладке "Ресурсный план" загрузите Excel-файл графика отпусков.
3. Выберите или настройте команду.
4. Выполните анализ и сформируйте выгрузку ресурсного плана.
5. Для проверки формата входного файла используйте маршрут `/download/vacations-sample-template`.

## Дополнительные Node-команды

Запуск legacy Node-сервера:

```bash
npm start
```

Запуск в режиме разработки:

```bash
npm run dev
```

Запуск тестов:

```bash
npm test
```

По умолчанию Node-сервер использует порт `3000`, а основной Symfony-запуск в этой инструкции использует порт `4157`.

## Проверка установки

После запуска проверьте:

- Главная страница открывается по адресу `http://127.0.0.1:4157`.
- Маршрут `http://127.0.0.1:4157/api/bootstrap` отвечает без ошибки.
- В каталоге `logs` появились файлы `site-4157.out.log` и `site-4157.err.log`.

## Типовые проблемы

### `composer: command not found`

Composer не установлен или отсутствует в `PATH`. Установите Composer и повторите `composer install` в каталоге `.symfony_tmp`.

### `Could not open input file` или ошибки Symfony entrypoint

Проверьте, что запуск выполняется из корня проекта и существует файл `.symfony_tmp/public/index.php`.

### `Address already in use`

Порт `4157` уже занят. Освободите его или измените порт в команде запуска.

### Ошибки по PHP-расширениям

Проверьте, что установлены `mbstring`, `xml`, `zip`, `ctype`, `iconv`. В Debian/Ubuntu это обычно пакеты вида `php8.2-mbstring`, `php8.2-xml`, `php8.2-zip`.

### PostgreSQL не запущен

Для локального режима это не критично: приложение должно переключиться на `.symfony_tmp/var/state`. Если нужна именно БД PostgreSQL, проверьте контейнер и значение `DATABASE_URL`.
