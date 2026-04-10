<?php

namespace App\Service;

use DateTimeInterface;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class CalendarService
{
    public function __construct(
        private readonly HttpClientInterface $httpClient,
    ) {
    }

    /**
     * @param array<string, mixed> $calendarApi
     *
     * @return array<string, bool>
     */
    public function fetchWorkdayMap(DateTimeInterface $start, DateTimeInterface $end, array $calendarApi = []): array
    {
        $fallback = $this->buildWeekendFallback($start, $end);
        $years = range((int) $start->format('Y'), (int) $end->format('Y'));
        $maps = [];

        try {
            foreach ($years as $year) {
                $maps[$year] = $this->fetchYearWorkdayMap($year, $calendarApi);
            }
        } catch (\Throwable) {
            return $fallback;
        }

        $result = [];
        foreach (DateHelper::enumerateDays($start, $end) as $date) {
            $iso = DateHelper::toIsoDate($date);
            $year = (int) $date->format('Y');
            $result[$iso] = $maps[$year][$iso] ?? $fallback[$iso] ?? false;
        }

        return $result;
    }

    /**
     * @param array<string, mixed> $calendarApi
     *
     * @return array<string, bool>
     */
    public function fetchYearWorkdayMap(int $year, array $calendarApi = []): array
    {
        $rangeStart = DateHelper::startOfMonth(DateHelper::createUtc($year, 1, 1));
        $rangeEnd = DateHelper::endOfMonth(DateHelper::createUtc($year, 12, 1));
        $fallback = $this->buildWeekendFallback($rangeStart, $rangeEnd);
        $config = $this->buildCalendarConfig($calendarApi);

        if (empty($config['enabled'])) {
            return $fallback;
        }

        try {
            $response = $this->httpClient->request(
                (string) ($config['method'] ?? 'GET'),
                $this->buildCalendarYearUrl($config, $year),
                [
                    'headers' => $this->buildRequestHeaders($config),
                    'timeout' => (float) (($config['timeoutMs'] ?? 10000) / 1000),
                ]
            );

            if (200 !== $response->getStatusCode()) {
                return $fallback;
            }

            $values = $this->parseCalendarResponseValues($response->getContent(false));
            $dates = DateHelper::enumerateDays($rangeStart, $rangeEnd);

            if (count($values) !== count($dates)) {
                return $fallback;
            }

            $result = [];
            foreach ($dates as $index => $date) {
                $result[DateHelper::toIsoDate($date)] = $this->isWorkingValue($values[$index] ?? '', $config);
            }

            return $result;
        } catch (ExceptionInterface|\Throwable) {
            return $fallback;
        }
    }

    /**
     * @param array<string, mixed> $calendarApi
     *
     * @return array<string, mixed>
     */
    private function buildCalendarConfig(array $calendarApi): array
    {
        return array_merge([
            'enabled' => true,
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
            'timeoutMs' => 10000,
            'country' => 'RU',
        ], $calendarApi);
    }

    /**
     * @param array<string, mixed> $config
     */
    private function buildCalendarYearUrl(array $config, int $year): string
    {
        $url = rtrim((string) ($config['baseUrl'] ?? 'https://isdayoff.ru'), '/').'/'.ltrim((string) ($config['endpointPath'] ?? '/api/getdata'), '/');
        $params = ['year' => (string) $year];

        if (!empty($config['queryDelimiterParam'])) {
            $params[(string) $config['queryDelimiterParam']] = (string) ($config['queryDelimiterValue'] ?? "\n");
        }

        if (($config['authType'] ?? 'none') === 'query' && !empty($config['apiKey']) && !empty($config['apiKeyParamName'])) {
            $params[(string) $config['apiKeyParamName']] = (string) $config['apiKey'];
        }

        if (!empty($config['country'])) {
            $params['cc'] = mb_strtolower((string) $config['country']);
        }

        return $url.'?'.http_build_query($params);
    }

    /**
     * @param array<string, mixed> $config
     *
     * @return array<string, string>
     */
    private function buildRequestHeaders(array $config): array
    {
        $headers = [];

        if (($config['authType'] ?? 'none') === 'header' && !empty($config['apiKey']) && !empty($config['apiKeyParamName'])) {
            $headers[(string) $config['apiKeyParamName']] = (string) $config['apiKey'];
        }

        return $headers;
    }

    /**
     * @return array<string, bool>
     */
    private function buildWeekendFallback(DateTimeInterface $start, DateTimeInterface $end): array
    {
        $result = [];
        foreach (DateHelper::enumerateDays($start, $end) as $date) {
            $dayOfWeek = (int) $date->format('w');
            $result[DateHelper::toIsoDate($date)] = 0 !== $dayOfWeek && 6 !== $dayOfWeek;
        }

        return $result;
    }

    /**
     * @return list<string>
     */
    private function parseCalendarResponseValues(string $responseText): array
    {
        $normalized = trim(str_replace("\r", '', $responseText));
        if ('' === $normalized) {
            return [];
        }

        $split = preg_split('/\s+/', $normalized, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if (count($split) > 1) {
            return array_values($split);
        }

        return preg_split('//u', $normalized, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    }

    /**
     * @param array<string, mixed> $config
     */
    private function isWorkingValue(string $value, array $config): bool
    {
        return in_array($value, [
            (string) ($config['successWorkdayValue'] ?? '0'),
            '2',
            '4',
        ], true);
    }
}
