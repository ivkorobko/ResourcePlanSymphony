<?php

namespace App\Service;

use DateInterval;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;

final class DateHelper
{
    public const MONTH_NAMES = [
        'январь',
        'февраль',
        'март',
        'апрель',
        'май',
        'июнь',
        'июль',
        'август',
        'сентябрь',
        'октябрь',
        'ноябрь',
        'декабрь',
    ];

    private const UTC = 'UTC';

    public static function utc(): DateTimeZone
    {
        static $timezone = null;

        if (!$timezone instanceof DateTimeZone) {
            $timezone = new DateTimeZone(self::UTC);
        }

        return $timezone;
    }

    public static function createUtc(int $year, int $month, int $day): DateTimeImmutable
    {
        return new DateTimeImmutable(sprintf('%04d-%02d-%02d 00:00:00', $year, $month, $day), self::utc());
    }

    public static function cloneDate(DateTimeInterface $date): DateTimeImmutable
    {
        return self::createUtc(
            (int) $date->format('Y'),
            (int) $date->format('m'),
            (int) $date->format('d')
        );
    }

    public static function excelSerialToDate(float|int $serial): DateTimeImmutable
    {
        $days = (int) floor(((float) $serial) - 25569);
        $base = new DateTimeImmutable('@'.($days * 86400));

        return self::createUtc(
            (int) $base->setTimezone(self::utc())->format('Y'),
            (int) $base->setTimezone(self::utc())->format('m'),
            (int) $base->setTimezone(self::utc())->format('d')
        );
    }

    public static function toIsoDate(?DateTimeInterface $date): string
    {
        if (!$date instanceof DateTimeInterface) {
            return '';
        }

        return $date->setTimezone(self::utc())->format('Y-m-d');
    }

    public static function monthKey(DateTimeInterface $date): string
    {
        return $date->setTimezone(self::utc())->format('Y-m');
    }

    public static function parseMonthKey(string $value): DateTimeImmutable
    {
        [$year, $month] = array_map('intval', explode('-', $value));

        return self::createUtc($year, $month, 1);
    }

    public static function startOfMonth(DateTimeInterface $date): DateTimeImmutable
    {
        return self::createUtc((int) $date->format('Y'), (int) $date->format('m'), 1);
    }

    public static function endOfMonth(DateTimeInterface $date): DateTimeImmutable
    {
        return self::startOfMonth($date)->modify('last day of this month');
    }

    public static function addMonths(DateTimeInterface $date, int $count): DateTimeImmutable
    {
        return self::startOfMonth($date)->modify(sprintf('%+d month', $count));
    }

    /**
     * @return list<DateTimeImmutable>
     */
    public static function enumerateDays(DateTimeInterface $start, DateTimeInterface $end): array
    {
        $result = [];
        $cursor = self::cloneDate($start);
        $finish = self::cloneDate($end);

        while ($cursor <= $finish) {
            $result[] = $cursor;
            $cursor = $cursor->add(new DateInterval('P1D'));
        }

        return $result;
    }

    public static function capitalize(string $value): string
    {
        if ($value === '') {
            return '';
        }

        return mb_strtoupper(mb_substr($value, 0, 1)).mb_substr($value, 1);
    }

    public static function getMonthName(DateTimeInterface $date): string
    {
        return self::MONTH_NAMES[(int) $date->format('n') - 1] ?? '';
    }

    public static function formatShortRange(DateTimeInterface $start, DateTimeInterface $end): string
    {
        return sprintf('%s-%s', $start->format('d.m'), $end->format('d.m'));
    }

    public static function listMonthKeysBetween(DateTimeInterface $startMonth, DateTimeInterface $endMonth): array
    {
        $result = [];
        $cursor = self::startOfMonth($startMonth);
        $limit = self::startOfMonth($endMonth);

        while ($cursor <= $limit) {
            $result[] = self::monthKey($cursor);
            $cursor = self::addMonths($cursor, 1);
        }

        return $result;
    }

    public static function getIsoWeek(DateTimeInterface $date): int
    {
        return (int) $date->format('W');
    }
}
