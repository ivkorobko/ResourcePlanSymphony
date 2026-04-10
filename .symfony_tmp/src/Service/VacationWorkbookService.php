<?php

namespace App\Service;

use PhpOffice\PhpSpreadsheet\Cell\Cell;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date as SpreadsheetDate;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

final class VacationWorkbookService
{
    /**
     * @return array<string, mixed>
     */
    public function parseWorkbook(string $path, string $sourceFileName): array
    {
        $spreadsheet = IOFactory::load($path);
        $sheet = $spreadsheet->getSheet(0);
        $schema = $this->getWorkbookSchema($sheet);
        $employees = [];

        for ($rowNumber = $schema['dataStartRow']; $rowNumber <= $sheet->getHighestRow(); ++$rowNumber) {
            $department = $this->textValue($sheet->getCell([$schema['departmentColumn'], $rowNumber]));
            $fullName = $this->textValue($sheet->getCell([$schema['fullNameColumn'], $rowNumber]));
            $position = $schema['positionColumn'] ? $this->textValue($sheet->getCell([$schema['positionColumn'], $rowNumber])) : '';

            if ('' === $department && '' === $fullName) {
                continue;
            }

            $vacations = [];
            foreach ($schema['vacationGroups'] as $group) {
                $start = $this->dateValue($sheet->getCell([$group['startColumn'], $rowNumber]));
                $end = $this->dateValue($sheet->getCell([$group['endColumn'], $rowNumber]));
                $days = $this->numberValue($sheet->getCell([$group['daysColumn'], $rowNumber]));

                if (!$start || !$end || !$days) {
                    continue;
                }

                $vacations[] = [
                    'start' => DateHelper::toIsoDate($start),
                    'end' => DateHelper::toIsoDate($end),
                    'days' => $days,
                ];
            }

            $employees[] = [
                'id' => $this->buildEmployeeId($department, $fullName),
                'department' => $department,
                'fullName' => $fullName,
                'position' => $position,
                'totalVacationDays' => $this->numberValue($sheet->getCell([$schema['totalVacationDaysColumn'], $rowNumber])),
                'vacations' => $vacations,
            ];
        }

        $monthDates = [];
        foreach ($employees as $employee) {
            foreach ($employee['vacations'] as $period) {
                $monthDates[] = DateHelper::parseMonthKey(substr((string) $period['start'], 0, 7));
                $monthDates[] = DateHelper::parseMonthKey(substr((string) $period['end'], 0, 7));
            }
        }

        usort($monthDates, static fn (\DateTimeImmutable $left, \DateTimeImmutable $right): int => $left <=> $right);

        $rangeStart = $monthDates[0] ?? DateHelper::createUtc((int) gmdate('Y'), 1, 1);
        $rangeEnd = $monthDates[count($monthDates) - 1] ?? DateHelper::endOfMonth($rangeStart);

        $departments = array_values(array_unique(array_map(static fn (array $employee): string => (string) $employee['department'], $employees)));
        sort($departments, SORT_NATURAL);

        return [
            'sourceFileName' => $this->normalizeSourceFileName($sourceFileName),
            'importedAt' => (new \DateTimeImmutable('now', DateHelper::utc()))->format(DATE_ATOM),
            'employees' => $employees,
            'departments' => $departments,
            'monthOptions' => $this->buildMonthOptions($rangeStart, $rangeEnd),
        ];
    }

    private function textValue(Cell $cell): string
    {
        $value = $cell->getValue();

        if ($value === null) {
            return '';
        }

        if (is_scalar($value)) {
            return trim((string) $value);
        }

        return trim((string) $cell->getFormattedValue());
    }

    private function numberValue(Cell $cell): int
    {
        $value = $cell->getCalculatedValue();
        if ($value === null || $value === '') {
            return 0;
        }

        return (int) round((float) $value);
    }

    private function dateValue(Cell $cell): ?\DateTimeImmutable
    {
        $value = $cell->getValue();

        try {
            if ($value instanceof \DateTimeInterface) {
                return DateHelper::createUtc(
                    (int) $value->format('Y'),
                    (int) $value->format('m'),
                    (int) $value->format('d')
                );
            }

            if (is_numeric($value) && SpreadsheetDate::isDateTime($cell)) {
                return DateHelper::excelSerialToDate((float) $value);
            }

            $calculatedValue = $cell->getCalculatedValue();
            if ($calculatedValue instanceof \DateTimeInterface) {
                return DateHelper::createUtc(
                    (int) $calculatedValue->format('Y'),
                    (int) $calculatedValue->format('m'),
                    (int) $calculatedValue->format('d')
                );
            }

            if (is_numeric($calculatedValue) && SpreadsheetDate::isDateTime($cell)) {
                return DateHelper::excelSerialToDate((float) $calculatedValue);
            }

            if (is_string($value) && '' !== trim($value)) {
                $direct = new \DateTimeImmutable($value, DateHelper::utc());

                return DateHelper::createUtc(
                    (int) $direct->format('Y'),
                    (int) $direct->format('m'),
                    (int) $direct->format('d')
                );
            }
        } catch (\Throwable) {
        }

        return null;
    }

    private function findHeaderRow(Worksheet $sheet): int
    {
        $limit = min((int) $sheet->getHighestRow(), 20);
        for ($row = 1; $row <= $limit; ++$row) {
            $first = mb_strtolower($this->textValue($sheet->getCell([1, $row])));
            $second = mb_strtolower($this->textValue($sheet->getCell([2, $row])));

            if (str_contains($first, 'отдел') && str_contains($second, 'фио')) {
                return $row;
            }
        }

        return 11;
    }

    private function normalizeHeaderLabel(string $value): string
    {
        return trim(preg_replace('/\s+/u', ' ', mb_strtolower($value)) ?? '');
    }

    /**
     * @return array<string, mixed>
     */
    private function getWorkbookSchema(Worksheet $sheet): array
    {
        $headerRowNumber = $this->findHeaderRow($sheet);
        $headers = [];
        $maxColumns = max((int) \PhpOffice\PhpSpreadsheet\Cell\Coordinate::columnIndexFromString($sheet->getHighestColumn()), 20);

        for ($column = 1; $column <= $maxColumns; ++$column) {
            $headers[] = [
                'column' => $column,
                'label' => $this->normalizeHeaderLabel($this->textValue($sheet->getCell([$column, $headerRowNumber]))),
            ];
        }

        $departmentColumn = $this->findColumnByContains($headers, 'отдел') ?? 1;
        $fullNameColumn = $this->findColumnByContains($headers, 'фио') ?? 2;
        $positionColumn = $this->findColumnByContains($headers, 'долж');
        $totalVacationDaysColumn = $this->findColumnByContains($headers, 'итого') ?? 12;
        $firstVacationColumn = max((int) ($positionColumn ?? 0), $fullNameColumn) + 1;
        $vacationColumns = array_values(array_filter($headers, static fn (array $header): bool => $header['column'] >= $firstVacationColumn && $header['column'] < $totalVacationDaysColumn && '' !== $header['label']));

        $vacationGroups = [];
        for ($index = 0; $index < count($vacationColumns); $index += 3) {
            $chunk = array_slice($vacationColumns, $index, 3);
            if (count($chunk) < 3) {
                continue;
            }

            $vacationGroups[] = [
                'startColumn' => $this->findChunkColumnByContains($chunk, 'нач') ?? $chunk[0]['column'],
                'endColumn' => $this->findChunkColumnByContains($chunk, 'оконч') ?? $chunk[1]['column'],
                'daysColumn' => $this->findChunkColumnByContains($chunk, 'дн') ?? $this->findChunkColumnByContains($chunk, 'кол') ?? $chunk[2]['column'],
            ];
        }

        return [
            'dataStartRow' => $headerRowNumber + 2,
            'departmentColumn' => $departmentColumn,
            'fullNameColumn' => $fullNameColumn,
            'positionColumn' => $positionColumn,
            'totalVacationDaysColumn' => $totalVacationDaysColumn,
            'vacationGroups' => $vacationGroups,
        ];
    }

    private function findColumnByContains(array $headers, string $needle): ?int
    {
        foreach ($headers as $header) {
            if (str_contains((string) $header['label'], $needle)) {
                return (int) $header['column'];
            }
        }

        return null;
    }

    private function findChunkColumnByContains(array $headers, string $needle): ?int
    {
        foreach ($headers as $header) {
            if (str_contains((string) $header['label'], $needle)) {
                return (int) $header['column'];
            }
        }

        return null;
    }

    private function buildEmployeeId(string $department, string $fullName): string
    {
        $source = mb_strtolower($department.'::'.$fullName);
        $normalized = preg_replace('/[^\p{L}\p{N}\s:.-]+/u', '', normalizer_normalize($source, \Normalizer::FORM_KD) ?: $source) ?? $source;

        return preg_replace('/\s+/u', '-', $normalized) ?? $normalized;
    }

    private function normalizeSourceFileName(string $value): string
    {
        if ('' === $value) {
            return '';
        }

        $decoded = mb_convert_encoding($value, 'UTF-8', 'ISO-8859-1');
        if (preg_match('/[А-Яа-яЁё]/u', $decoded) && preg_match('/[ÐÑ]/u', $value)) {
            return $decoded;
        }

        return $value;
    }

    /**
     * @return list<array<string, int|string>>
     */
    private function buildMonthOptions(\DateTimeImmutable $startDate, \DateTimeImmutable $endDate): array
    {
        $start = DateHelper::startOfMonth($startDate);
        $finish = DateHelper::startOfMonth($endDate);
        $result = [];
        $cursor = $start;

        while ($cursor <= $finish) {
            $result[] = [
                'key' => DateHelper::monthKey($cursor),
                'year' => (int) $cursor->format('Y'),
                'month' => (int) $cursor->format('n'),
            ];
            $cursor = DateHelper::addMonths($cursor, 1);
        }

        return $result;
    }
}
