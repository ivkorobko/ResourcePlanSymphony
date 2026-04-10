<?php

namespace App\Service;

use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use RuntimeException;

final class ExportWorkbookService
{
    public function __construct(
        private readonly string $projectDir,
    ) {
    }

    /**
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $plan
     */
    public function exportWorkbook(array $settings, array $plan): string
    {
        $templatePath = dirname($this->projectDir).'/Ресурсный план.xlsx';
        if (!is_file($templatePath)) {
            throw new RuntimeException('Не найден шаблон Excel для выгрузки.');
        }

        $spreadsheet = IOFactory::load($templatePath);
        $summarySheet = $spreadsheet->getSheetByName('Сводный ресурсный план');
        $detailSheet = $spreadsheet->getSheetByName('Детальный ресурсный план ');
        $tasksSheet = $spreadsheet->getSheetByName('Типовые задачи');

        if (!$summarySheet instanceof Worksheet || !$detailSheet instanceof Worksheet || !$tasksSheet instanceof Worksheet) {
            throw new RuntimeException('Шаблон Excel не содержит ожидаемых листов.');
        }

        $this->fillTasksSheet($tasksSheet, $settings, $plan);
        $this->fillDetailSheet($detailSheet, $plan);
        $this->fillSummarySheet($summarySheet, $settings, $plan);

        $writer = new Xlsx($spreadsheet);
        $writer->setPreCalculateFormulas(false);

        ob_start();
        $writer->save('php://output');

        return (string) ob_get_clean();
    }

    /**
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $plan
     */
    private function fillTasksSheet(Worksheet $sheet, array $settings, array $plan): void
    {
        $allowedRoleKeys = array_fill_keys(array_map(static fn (array $role): string => (string) ($role['key'] ?? ''), $plan['sourceRoles'] ?? []), true);
        $roles = array_values(array_filter(
            is_array($settings['roles'] ?? null) ? $settings['roles'] : [],
            static fn (array $role): bool => isset($allowedRoleKeys[(string) ($role['key'] ?? '')])
        ));

        $requiredExtraRows = max(0, count($roles) * 3 - 10);
        if ($requiredExtraRows > 0) {
            $sheet->insertNewRowBefore(14, $requiredExtraRows);
        }

        foreach ($roles as $index => $role) {
            $headerRow = 4 + $index * 3;
            $dataRow = 5 + $index * 3;
            $spacerRow = 6 + $index * 3;
            $categories = $this->getTaskRoleCategories($role);

            $this->copyRowStyles($sheet, 4, $headerRow, 8);
            $this->copyRowStyles($sheet, 5, $dataRow, 8);
            $this->copyRowStyles($sheet, 6, $spacerRow, 8);

            $sheet->setCellValue("A{$dataRow}", (string) ($role['name'] ?? ''));
            $sheet->setCellValue("B{$dataRow}", (float) ($role['sprintHours'] ?? 0));
            $sheet->setCellValue("C{$headerRow}", (string) ($categories['primary']['label'] ?? ''));
            $sheet->setCellValue("C{$dataRow}", (float) ($categories['primary']['hours'] ?? 0));
            $sheet->setCellValue("D{$dataRow}", (string) ($categories['primary']['description'] ?? ''));
            $sheet->setCellValue("E{$headerRow}", (string) ($categories['secondary']['label'] ?? ''));
            $sheet->setCellValue("E{$dataRow}", (float) ($categories['secondary']['hours'] ?? 0));
            $sheet->setCellValue("F{$dataRow}", (string) ($categories['secondary']['description'] ?? ''));
            $sheet->setCellValue("G{$headerRow}", (string) ($categories['extra']['label'] ?? ''));
            $sheet->setCellValue("G{$dataRow}", (float) ($categories['extra']['hours'] ?? 0));
            $sheet->setCellValue("H{$dataRow}", (string) ($categories['extra']['description'] ?? ''));

            for ($column = 1; $column <= 8; ++$column) {
                $this->setCellValueAt($sheet, $column, $spacerRow, null);
            }
        }
    }

    /**
     * @param array<string, mixed> $plan
     */
    private function fillDetailSheet(Worksheet $sheet, array $plan): void
    {
        $styleRefs = [
            'workdayHeader' => 'C2',
            'totalHeader' => 'G3',
            'sprintHeader' => 'C3',
            'dateHeader' => 'C4',
            'totalBlank' => 'G2',
            'userName' => 'A5',
            'userWeek' => 'C5',
            'userTotal' => 'G5',
            'totalName' => 'A8',
            'totalWeek' => 'C8',
            'totalTotal' => 'G8',
            'blankA' => 'A9',
            'blankWeek' => 'C9',
        ];

        $workdayRow = 1;
        $sprintRow = 2;
        $dateRow = 3;
        $firstDataRow = 4;
        $maxColumns = 32;
        $maxRows = max(120, $sheet->getHighestRow());

        for ($row = 1; $row <= $maxRows; ++$row) {
            for ($column = 1; $column <= $maxColumns; ++$column) {
                $this->setCellValueAt($sheet, $column, $row, null);
            }
        }

        $sheet->setCellValue("A{$workdayRow}", 'Кол-во раб.дней');
        $sheet->setCellValue("A{$sprintRow}", '№ спринта');
        $sheet->setCellValue("A{$dateRow}", 'Дата спринта');
        $this->copyCellStyle($sheet, 'A5', "A{$workdayRow}");
        $this->copyCellStyle($sheet, 'A5', "A{$sprintRow}");
        $this->copyCellStyle($sheet, 'A5', "A{$dateRow}");

        $columnIndex = 2;
        foreach (($plan['monthBlocks'] ?? []) as $block) {
            foreach (($block['weeks'] ?? []) as $week) {
                $this->setCellValueAt($sheet, $columnIndex, $workdayRow, (int) ($week['workingDays'] ?? 0));
                $this->setCellValueAt($sheet, $columnIndex, $sprintRow, (int) ($week['sprintNumber'] ?? $week['isoWeek'] ?? 0));
                $this->setCellValueAt($sheet, $columnIndex, $dateRow, (string) ($week['label'] ?? ''));
                $this->copyCellStyle($sheet, 'C2', Coordinate::stringFromColumnIndex($columnIndex).$workdayRow);
                $this->copyCellStyle($sheet, 'C3', Coordinate::stringFromColumnIndex($columnIndex).$sprintRow);
                $this->copyCellStyle($sheet, 'C4', Coordinate::stringFromColumnIndex($columnIndex).$dateRow);
                ++$columnIndex;
            }

            $this->setCellValueAt($sheet, $columnIndex, $workdayRow, null);
            $this->setCellValueAt($sheet, $columnIndex, $sprintRow, (string) ($block['totalLabel'] ?? ''));
            $this->setCellValueAt($sheet, $columnIndex, $dateRow, null);
            $this->copyCellStyle($sheet, 'G2', Coordinate::stringFromColumnIndex($columnIndex).$workdayRow);
            $this->copyCellStyle($sheet, 'G3', Coordinate::stringFromColumnIndex($columnIndex).$sprintRow);
            $this->copyCellStyle($sheet, 'G2', Coordinate::stringFromColumnIndex($columnIndex).$dateRow);
            ++$columnIndex;
        }

        $rowIndex = $firstDataRow;
        $roles = is_array($plan['roles'] ?? null) ? $plan['roles'] : [];
        foreach ($roles as $roleIndex => $role) {
            foreach (($role['rows'] ?? []) as $employee) {
                $sheet->setCellValue("A{$rowIndex}", (string) ($employee['name'] ?? ''));
                $this->copyCellStyle($sheet, 'A5', "A{$rowIndex}");
                $cursor = 2;

                foreach (($plan['monthBlocks'] ?? []) as $block) {
                    foreach (($block['weeks'] ?? []) as $week) {
                        $value = 0;
                        foreach (($employee['weekValues'] ?? []) as $weekValue) {
                            if (($weekValue['weekKey'] ?? '') === ($week['key'] ?? '')) {
                                $value = (int) ($weekValue['value'] ?? 0);
                                break;
                            }
                        }

                        $this->setCellValueAt($sheet, $cursor, $rowIndex, $value);
                        $this->copyCellStyle($sheet, 'C5', Coordinate::stringFromColumnIndex($cursor).$rowIndex);
                        ++$cursor;
                    }

                    $monthKey = (string) ($block['key'] ?? '');
                    $this->setCellValueAt($sheet, $cursor, $rowIndex, (int) (($employee['monthTotals'][$monthKey] ?? 0)));
                    $this->copyCellStyle($sheet, 'G5', Coordinate::stringFromColumnIndex($cursor).$rowIndex);
                    ++$cursor;
                }

                ++$rowIndex;
            }

            $sheet->setCellValue("A{$rowIndex}", (string) ($role['detailTotalLabel'] ?? ''));
            $this->copyCellStyle($sheet, 'A8', "A{$rowIndex}");
            $cursor = 2;

            foreach (($plan['monthBlocks'] ?? []) as $block) {
                foreach (($block['weeks'] ?? []) as $week) {
                    $this->setCellValueAt($sheet, $cursor, $rowIndex, (int) (($role['weekTotals'][(string) ($week['key'] ?? '')] ?? 0)));
                    $this->copyCellStyle($sheet, 'C8', Coordinate::stringFromColumnIndex($cursor).$rowIndex);
                    ++$cursor;
                }

                $this->setCellValueAt($sheet, $cursor, $rowIndex, (int) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0)));
                $this->copyCellStyle($sheet, 'G8', Coordinate::stringFromColumnIndex($cursor).$rowIndex);
                ++$cursor;
            }

            ++$rowIndex;
            if ($roleIndex < count($roles) - 1) {
                for ($column = 1; $column < $columnIndex; ++$column) {
                    $address = Coordinate::stringFromColumnIndex($column).$rowIndex;
                    $this->copyCellStyle($sheet, $column < 2 ? 'A9' : 'C9', $address);
                    $sheet->setCellValue($address, null);
                }
                ++$rowIndex;
            }
        }
    }

    /**
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $plan
     */
    private function fillSummarySheet(Worksheet $sheet, array $settings, array $plan): void
    {
        $sheet->setCellValue('A1', 'Ресурсный план '.(string) ($plan['periodLabel'] ?? ''));
        $distribution = is_array($plan['distribution'] ?? null) ? $plan['distribution'] : (is_array($settings['distribution'] ?? null) ? $settings['distribution'] : []);
        $sourceRoles = is_array($plan['sourceRoles'] ?? null) && [] !== $plan['sourceRoles']
            ? $plan['sourceRoles']
            : (is_array($settings['roles'] ?? null) ? $settings['roles'] : []);

        $topTableVisibleRows = 5;
        $topTableExtraRows = max(0, count($sourceRoles) - $topTableVisibleRows);

        if ($topTableExtraRows > 0) {
            $sheet->insertNewRowBefore(14, $topTableExtraRows);
        }

        try {
            $sheet->unmergeCells('F11:H11');
        } catch (\Throwable) {
        }

        foreach (range(7, 11 + $topTableExtraRows) as $row) {
            foreach (range(7, 9) as $column) {
                $this->setCellValueAt($sheet, $column, $row, null);
            }
        }

        $sheet->setCellValue('C5', (float) ($distribution['total'] ?? 0));
        $sheet->setCellValue('C6', (float) ($distribution['business'] ?? 0));
        $sheet->setCellValue('C7', (float) ($distribution['keyTasks'] ?? 0));
        $sheet->setCellValue('C8', (float) ($distribution['support'] ?? 0));
        $sheet->setCellValue('C9', (float) ($distribution['internal'] ?? 0));
        $sheet->setCellValue('C10', (float) ($distribution['architecture'] ?? 0));
        $sheet->setCellValue('C11', (float) ($distribution['other'] ?? 0));

        foreach ($sourceRoles as $index => $role) {
            $row = 7 + $index;
            $this->copyCellStyle($sheet, 'G7', "G{$row}");
            $this->copyCellStyle($sheet, 'H7', "H{$row}");
            $this->copyCellStyle($sheet, 'I7', "I{$row}");
            $sheet->setCellValue("G{$row}", (string) ($role['name'] ?? ''));
            $sheet->setCellValue("H{$row}", (float) ($role['primaryHours'] ?? 0));
            $sheet->setCellValue("I{$row}", (float) ($role['secondaryHours'] ?? 0));
        }

        $layouts = $this->buildSummaryLayouts(count(is_array($plan['roles'] ?? null) ? $plan['roles'] : []), $topTableExtraRows);
        $this->copyRowStyles($sheet, 14, $layouts['overview']['labelRow'], 9);
        $this->copyRowTemplate($sheet, 15, $layouts['overview']['titleRow'], 9);
        $this->copyRowStyles($sheet, 19, $layouts['overview']['totalRow'], 9);
        foreach ($layouts['months'] as $layout) {
            $this->copyRowStyles($sheet, 22, $layout['labelRow'], 9);
            $this->copyRowTemplate($sheet, 23, $layout['titleRow'], 9);
            $this->copyRowStyles($sheet, 27, $layout['totalRow'], 9);
        }
        $this->copyRowStyles($sheet, 45, $layouts['period']['labelRow'], 9);
        $this->copyRowTemplate($sheet, 46, $layouts['period']['titleRow'], 9);
        $this->copyRowStyles($sheet, 50, $layouts['period']['totalRow'], 9);

        $sheet->setCellValue('A'.$layouts['overview']['labelRow'], '1 спринт (полный, без учета отпусков)');
        $sheet->setCellValue('B'.$layouts['overview']['labelRow'], '2 спринт (полный, без учета отпусков)');
        $sheet->setCellValue('C'.$layouts['overview']['labelRow'], '3 спринт (полный, без учета отпусков)');
        $sheet->setCellValue('A'.$layouts['period']['labelRow'], 'Итого период');

        $reportRoles = is_array($plan['roles'] ?? null) ? $plan['roles'] : [];
        foreach ($reportRoles as $index => $role) {
            $row = $layouts['overview']['dataStartRow'] + $index;
            $this->copyRowStyles($sheet, 16, $row, 9);
            $sheet->setCellValue("A{$row}", (string) ($role['summaryLabel'] ?? $role['name'] ?? ''));
            $sheet->setCellValue("B{$row}", (float) ($role['employeeCount'] ?? 0));
            $sheet->setCellValue("C{$row}", ((float) ($role['sprintCapacity'] ?? 0)) * ((float) ($distribution['keyTasks'] ?? 0)));
            $sheet->setCellValue("D{$row}", ((float) ($role['sprintCapacity'] ?? 0)) * ((float) ($distribution['support'] ?? 0)));
            $sheet->setCellValue("E{$row}", ((float) ($role['sprintCapacity'] ?? 0)) * ((float) ($distribution['architecture'] ?? 0)));
            $sheet->setCellValue("F{$row}", ((float) ($role['sprintCapacity'] ?? 0)) * ((float) ($distribution['other'] ?? 0)));
            $sheet->setCellValue("G{$row}", (float) ($role['sprintCapacity'] ?? 0));
        }

        $overviewTotalRow = $layouts['overview']['totalRow'];
        $sheet->setCellValue("A{$overviewTotalRow}", 'Итого');
        $sheet->setCellValue("B{$overviewTotalRow}", array_sum(array_map(static fn (array $role): float => (float) ($role['employeeCount'] ?? 0), $reportRoles)));
        $sheet->setCellValue("C{$overviewTotalRow}", array_sum(array_map(static fn (array $role): float => ((float) ($role['sprintCapacity'] ?? 0)) * ((float) ($distribution['keyTasks'] ?? 0)), $reportRoles)));
        $sheet->setCellValue("D{$overviewTotalRow}", array_sum(array_map(static fn (array $role): float => ((float) ($role['sprintCapacity'] ?? 0)) * ((float) ($distribution['support'] ?? 0)), $reportRoles)));
        $sheet->setCellValue("E{$overviewTotalRow}", array_sum(array_map(static fn (array $role): float => ((float) ($role['sprintCapacity'] ?? 0)) * ((float) ($distribution['architecture'] ?? 0)), $reportRoles)));
        $sheet->setCellValue("F{$overviewTotalRow}", array_sum(array_map(static fn (array $role): float => ((float) ($role['sprintCapacity'] ?? 0)) * ((float) ($distribution['other'] ?? 0)), $reportRoles)));
        $sheet->setCellValue("G{$overviewTotalRow}", array_sum(array_map(static fn (array $role): float => (float) ($role['sprintCapacity'] ?? 0), $reportRoles)));

        foreach ($layouts['months'] as $blockIndex => $layout) {
            $block = $plan['monthBlocks'][$blockIndex] ?? null;
            if (!is_array($block)) {
                continue;
            }

            $sheet->setCellValue('A'.$layout['labelRow'], ($blockIndex + 1).' месяц');
            $sheet->setCellValue('B'.$layout['labelRow'], $this->getSprintLabel(count(is_array($block['weeks'] ?? null) ? $block['weeks'] : [])));

            foreach ($reportRoles as $roleIndex => $role) {
                $row = $layout['dataStartRow'] + $roleIndex;
                $this->copyRowStyles($sheet, 24, $row, 9);
                $monthTotal = (float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0));
                $sheet->setCellValue("A{$row}", (string) ($role['summaryLabel'] ?? $role['name'] ?? ''));
                $sheet->setCellValue("B{$row}", (float) ($role['employeeCount'] ?? 0));
                $sheet->setCellValue("C{$row}", $monthTotal * ((float) ($distribution['keyTasks'] ?? 0)));
                $sheet->setCellValue("D{$row}", $monthTotal * ((float) ($distribution['support'] ?? 0)));
                $sheet->setCellValue("E{$row}", $monthTotal * ((float) ($distribution['architecture'] ?? 0)));
                $sheet->setCellValue("F{$row}", $monthTotal * ((float) ($distribution['other'] ?? 0)));
                $sheet->setCellValue("G{$row}", $monthTotal);
            }

            $sheet->setCellValue('A'.$layout['totalRow'], 'Итого');
            $sheet->setCellValue('B'.$layout['totalRow'], array_sum(array_map(static fn (array $role): float => (float) ($role['employeeCount'] ?? 0), $reportRoles)));
            $sheet->setCellValue('C'.$layout['totalRow'], array_sum(array_map(fn (array $role): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['keyTasks'] ?? 0)), $reportRoles)));
            $sheet->setCellValue('D'.$layout['totalRow'], array_sum(array_map(fn (array $role): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['support'] ?? 0)), $reportRoles)));
            $sheet->setCellValue('E'.$layout['totalRow'], array_sum(array_map(fn (array $role): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['architecture'] ?? 0)), $reportRoles)));
            $sheet->setCellValue('F'.$layout['totalRow'], array_sum(array_map(fn (array $role): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['other'] ?? 0)), $reportRoles)));
            $sheet->setCellValue('G'.$layout['totalRow'], array_sum(array_map(fn (array $role): float => (float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0)), $reportRoles)));
        }

        foreach ($reportRoles as $index => $role) {
            $row = $layouts['period']['dataStartRow'] + $index;
            $this->copyRowStyles($sheet, 47, $row, 9);
            $sheet->setCellValue("A{$row}", (string) ($role['summaryLabel'] ?? $role['name'] ?? ''));
            $sheet->setCellValue("B{$row}", (float) ($role['employeeCount'] ?? 0));
            $sheet->setCellValue("C{$row}", array_sum(array_map(fn (array $block): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['keyTasks'] ?? 0)), $plan['monthBlocks'] ?? [])));
            $sheet->setCellValue("D{$row}", array_sum(array_map(fn (array $block): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['support'] ?? 0)), $plan['monthBlocks'] ?? [])));
            $sheet->setCellValue("E{$row}", array_sum(array_map(fn (array $block): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['architecture'] ?? 0)), $plan['monthBlocks'] ?? [])));
            $sheet->setCellValue("F{$row}", array_sum(array_map(fn (array $block): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['other'] ?? 0)), $plan['monthBlocks'] ?? [])));
            $sheet->setCellValue("G{$row}", (float) ($role['periodTotal'] ?? 0));
        }

        $periodTotalRow = $layouts['period']['totalRow'];
        $sheet->setCellValue("A{$periodTotalRow}", 'Итого');
        $sheet->setCellValue("B{$periodTotalRow}", array_sum(array_map(static fn (array $role): float => (float) ($role['employeeCount'] ?? 0), $reportRoles)));
        $sheet->setCellValue("C{$periodTotalRow}", array_sum(array_map(fn (array $role): float => array_sum(array_map(fn (array $block): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['keyTasks'] ?? 0)), $plan['monthBlocks'] ?? [])), $reportRoles)));
        $sheet->setCellValue("D{$periodTotalRow}", array_sum(array_map(fn (array $role): float => array_sum(array_map(fn (array $block): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['support'] ?? 0)), $plan['monthBlocks'] ?? [])), $reportRoles)));
        $sheet->setCellValue("E{$periodTotalRow}", array_sum(array_map(fn (array $role): float => array_sum(array_map(fn (array $block): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['architecture'] ?? 0)), $plan['monthBlocks'] ?? [])), $reportRoles)));
        $sheet->setCellValue("F{$periodTotalRow}", array_sum(array_map(fn (array $role): float => array_sum(array_map(fn (array $block): float => ((float) (($role['monthTotals'][(string) ($block['key'] ?? '')] ?? 0))) * ((float) ($distribution['other'] ?? 0)), $plan['monthBlocks'] ?? [])), $reportRoles)));
        $sheet->setCellValue("G{$periodTotalRow}", array_sum(array_map(static fn (array $role): float => (float) ($role['periodTotal'] ?? 0), $reportRoles)));
    }

    /**
     * @return array{overview: array<string, int>, months: list<array<string, int>>, period: array<string, int>}
     */
    private function buildSummaryLayouts(int $roleCount, int $topOffset = 0): array
    {
        $overview = [
            'labelRow' => 14 + $topOffset,
            'titleRow' => 15 + $topOffset,
            'dataStartRow' => 16 + $topOffset,
            'totalRow' => 16 + $topOffset + $roleCount,
        ];

        $months = [];
        $nextHeaderRow = $overview['totalRow'] + 2;
        for ($index = 0; $index < 3; ++$index) {
            $layout = [
                'labelRow' => $nextHeaderRow,
                'titleRow' => $nextHeaderRow + 1,
                'dataStartRow' => $nextHeaderRow + 2,
                'totalRow' => $nextHeaderRow + 2 + $roleCount,
            ];
            $months[] = $layout;
            $nextHeaderRow = $layout['totalRow'] + 2;
        }

        $period = [
            'labelRow' => $months[2]['totalRow'] + 2,
            'titleRow' => $months[2]['totalRow'] + 3,
            'dataStartRow' => $months[2]['totalRow'] + 4,
            'totalRow' => $months[2]['totalRow'] + 4 + $roleCount,
        ];

        return [
            'overview' => $overview,
            'months' => $months,
            'period' => $period,
        ];
    }

    /**
     * @param array<string, mixed> $role
     *
     * @return array{primary: array<string, mixed>, secondary: array<string, mixed>, extra: array<string, mixed>}
     */
    private function getTaskRoleCategories(array $role): array
    {
        if (!empty($role['categories']) && is_array($role['categories'])) {
            $categories = array_values(array_filter($role['categories'], 'is_array'));
            $primary = $categories[0] ?? [];
            foreach ($categories as $category) {
                if (($category['key'] ?? null) === ($role['primaryCategoryKey'] ?? null)) {
                    $primary = $category;
                    break;
                }
            }

            $secondary = [];
            $extra = [];
            foreach ($categories as $category) {
                if (($category['key'] ?? null) === ($primary['key'] ?? null)) {
                    continue;
                }
                if ([] === $secondary) {
                    $secondary = $category;
                    continue;
                }
                if ([] === $extra) {
                    $extra = $category;
                    break;
                }
            }

            return [
                'primary' => $primary,
                'secondary' => $secondary,
                'extra' => $extra,
            ];
        }

        return [
            'primary' => [
                'label' => $role['primaryLabel'] ?? '',
                'hours' => $role['primaryHours'] ?? 0,
                'description' => $role['primaryDescription'] ?? '',
            ],
            'secondary' => [
                'label' => $role['secondaryLabel'] ?? '',
                'hours' => $role['secondaryHours'] ?? 0,
                'description' => $role['secondaryDescription'] ?? '',
            ],
            'extra' => [
                'label' => $role['extraLabel'] ?? '',
                'hours' => $role['extraHours'] ?? 0,
                'description' => $role['extraDescription'] ?? '',
            ],
        ];
    }

    private function getSprintLabel(int $count): string
    {
        $value = abs($count);
        $mod100 = $value % 100;
        $mod10 = $value % 10;

        if ($mod100 >= 11 && $mod100 <= 14) {
            return $value.' спринтов';
        }

        if (1 === $mod10) {
            return $value.' спринт';
        }

        if ($mod10 >= 2 && $mod10 <= 4) {
            return $value.' спринта';
        }

        return $value.' спринтов';
    }

    private function copyRowStyles(Worksheet $sheet, int $templateRow, int $targetRow, int $columnCount = 9): void
    {
        $sheet->getRowDimension($targetRow)->setRowHeight($sheet->getRowDimension($templateRow)->getRowHeight());

        for ($column = 1; $column <= $columnCount; ++$column) {
            $source = Coordinate::stringFromColumnIndex($column).$templateRow;
            $target = Coordinate::stringFromColumnIndex($column).$targetRow;
            $sheet->duplicateStyle($sheet->getStyle($source), $target);
        }
    }

    private function copyRowTemplate(Worksheet $sheet, int $templateRow, int $targetRow, int $columnCount = 9): void
    {
        $sheet->getRowDimension($targetRow)->setRowHeight($sheet->getRowDimension($templateRow)->getRowHeight());

        for ($column = 1; $column <= $columnCount; ++$column) {
            $source = Coordinate::stringFromColumnIndex($column).$templateRow;
            $target = Coordinate::stringFromColumnIndex($column).$targetRow;
            $sheet->duplicateStyle($sheet->getStyle($source), $target);
            $sheet->setCellValue($target, $sheet->getCell($source)->getValue());
        }
    }

    private function copyCellStyle(Worksheet $sheet, string $sourceAddress, string $targetAddress): void
    {
        $sheet->duplicateStyle($sheet->getStyle($sourceAddress), $targetAddress);
    }

    private function setCellValueAt(Worksheet $sheet, int $column, int $row, mixed $value): void
    {
        $sheet->setCellValue(Coordinate::stringFromColumnIndex($column).$row, $value);
    }
}
