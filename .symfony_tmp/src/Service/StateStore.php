<?php

namespace App\Service;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception;
use RuntimeException;

final class StateStore
{
    private const SETTINGS_KEY = 'settings';
    private const VACATIONS_KEY = 'vacations';
    private const FALLBACK_STATE_DIR = 'var/state';

    private ?bool $databaseAvailable = null;

    public function __construct(
        private readonly Connection $connection,
        private readonly string $projectDir,
    ) {
    }

    /**
     * @return array{settings: array<mixed>, vacations: array<mixed>}
     */
    public function loadState(): array
    {
        return [
            'settings' => $this->getSettings(),
            'vacations' => $this->getVacations(),
        ];
    }

    /**
     * @return array<mixed>
     */
    public function getSettings(): array
    {
        return $this->getDocument(self::SETTINGS_KEY, $this->buildDefaultSettings());
    }

    /**
     * @param array<mixed> $payload
     *
     * @return array<mixed>
     */
    public function saveSettings(array $payload): array
    {
        $payload['updatedAt'] = $payload['updatedAt'] ?? (new \DateTimeImmutable('now', DateHelper::utc()))->format(DATE_ATOM);
        $this->saveDocument(self::SETTINGS_KEY, $payload);

        return $payload;
    }

    /**
     * @return array<mixed>
     */
    public function getVacations(): array
    {
        return $this->getDocument(self::VACATIONS_KEY, $this->buildEmptyVacations());
    }

    /**
     * @param array<mixed> $payload
     *
     * @return array<mixed>
     */
    public function saveVacations(array $payload): array
    {
        $this->saveDocument(self::VACATIONS_KEY, $payload);

        return $payload;
    }

    /**
     * @return array{settings: array<mixed>, vacations: array<mixed>}
     */
    public function resetWorkflow(): array
    {
        $settings = $this->getSettings();
        $vacations = $this->buildEmptyVacations();
        $this->saveVacations($vacations);

        return [
            'settings' => $settings,
            'vacations' => $vacations,
        ];
    }

    /**
     * @return array<mixed>
     */
    private function getDocument(string $key, array $fallback): array
    {
        if (!$this->ensureStorage()) {
            return $this->getDocumentFromFile($key, $fallback);
        }

        try {
            $payload = $this->connection->fetchOne(
                'SELECT payload FROM app_document WHERE document_key = :document_key',
                ['document_key' => $key]
            );
        } catch (Exception $exception) {
            $this->databaseAvailable = false;
            return $this->getDocumentFromFile($key, $fallback);
        }

        if (is_string($payload) && $payload !== '') {
            /** @var mixed $decoded */
            $decoded = json_decode($payload, true);

            if (is_array($decoded)) {
                return $decoded;
            }
        }

        $seed = $this->readSeedFile($key) ?? $fallback;
        $this->saveDocument($key, $seed);

        return $seed;
    }

    /**
     * @param array<mixed> $payload
     */
    private function saveDocument(string $key, array $payload): void
    {
        if (!$this->ensureStorage()) {
            $this->saveDocumentToFile($key, $payload);
            return;
        }

        try {
            $this->connection->executeStatement(
                <<<'SQL'
                INSERT INTO app_document (document_key, payload, updated_at)
                VALUES (:document_key, CAST(:payload AS JSONB), NOW())
                ON CONFLICT (document_key)
                DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
                SQL,
                [
                    'document_key' => $key,
                    'payload' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT),
                ]
            );
        } catch (Exception $exception) {
            $this->databaseAvailable = false;
            $this->saveDocumentToFile($key, $payload);
        }
    }

    private function ensureStorage(): bool
    {
        if ($this->databaseAvailable === false) {
            return false;
        }

        if ($this->databaseAvailable === true) {
            return true;
        }

        try {
            $this->connection->executeStatement(
                <<<'SQL'
                CREATE TABLE IF NOT EXISTS app_document (
                    document_key VARCHAR(64) PRIMARY KEY,
                    payload JSONB NOT NULL,
                    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
                )
                SQL
            );
        } catch (Exception $exception) {
            $this->databaseAvailable = false;
            return false;
        }

        $this->databaseAvailable = true;
        return true;
    }

    /**
     * @return array<mixed>
     */
    private function getDocumentFromFile(string $key, array $fallback): array
    {
        $path = $this->fallbackStatePath($key);

        if (is_file($path)) {
            $raw = file_get_contents($path);
            if ($raw !== false && $raw !== '') {
                /** @var mixed $decoded */
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }

        $seed = $this->readSeedFile($key) ?? $fallback;
        $this->saveDocumentToFile($key, $seed);
        return $seed;
    }

    /**
     * @param array<mixed> $payload
     */
    private function saveDocumentToFile(string $key, array $payload): void
    {
        $path = $this->fallbackStatePath($key);
        $directory = dirname($path);

        if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new RuntimeException('Не удалось создать директорию для локального состояния.');
        }

        $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        if (!is_string($encoded) || file_put_contents($path, $encoded) === false) {
            throw new RuntimeException('Не удалось сохранить локальное состояние.');
        }
    }

    private function fallbackStatePath(string $key): string
    {
        $safeKey = preg_replace('/[^a-z0-9_-]+/i', '_', $key) ?: 'state';
        return $this->projectDir.'/'.self::FALLBACK_STATE_DIR.'/'.$safeKey.'.json';
    }

    /**
     * @return array<mixed>|null
     */
    private function readSeedFile(string $key): ?array
    {
        $rootDir = dirname($this->projectDir);
        $path = match ($key) {
            self::SETTINGS_KEY => $rootDir.'/data/settings.json',
            self::VACATIONS_KEY => $rootDir.'/data/vacations.json',
            default => null,
        };

        if (!$path || !is_file($path)) {
            return null;
        }

        $raw = file_get_contents($path);
        if ($raw === false || $raw === '') {
            return null;
        }

        /** @var mixed $decoded */
        $decoded = json_decode($raw, true);

        return is_array($decoded) ? $decoded : null;
    }

    /**
     * @return array<string, mixed>
     */
    private function buildDefaultSettings(): array
    {
        return [
            'updatedAt' => (new \DateTimeImmutable('now', DateHelper::utc()))->format(DATE_ATOM),
            'calendarApi' => [
                'enabled' => true,
                'resourceName' => 'production_calendar_api',
                'displayName' => 'isdayoff.ru',
                'baseUrl' => 'https://isdayoff.ru',
                'endpointPath' => '/api/getdata',
                'method' => 'GET',
                'queryFromParam' => 'date1',
                'queryToParam' => 'date2',
                'queryDelimiterParam' => 'delimeter',
                'queryDelimiterValue' => "\n",
                'successWorkdayValue' => '0',
                'authType' => 'none',
                'apiKey' => '',
                'apiKeyParamName' => 'X-Api-Key',
                'country' => 'RU',
                'timeoutMs' => 10000,
                'fallbackMode' => 'weekends',
                'notes' => 'Источник производственного календаря для расчёта рабочих дней.',
            ],
            'misc' => [
                'reportGroupingMode' => 'ungrouped',
                'sprintDurationDays' => 7,
                'sprintStartDay' => 'monday',
            ],
            'distribution' => [
                'total' => 1,
                'business' => 0.7,
                'keyTasks' => 0.55,
                'support' => 0.15,
                'internal' => 0.3,
                'architecture' => 0.15,
                'other' => 0.15,
            ],
            'roles' => [],
            'roleGroups' => [],
            'teams' => [],
            'userAssignments' => new \stdClass(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function buildEmptyVacations(): array
    {
        return [
            'sourceFileName' => '',
            'importedAt' => '',
            'employees' => [],
            'departments' => [],
            'monthOptions' => [],
        ];
    }
}
