<?php

namespace App\Service;

use DateTimeImmutable;
use RuntimeException;

final class PlanService
{
    public function __construct(
        private readonly CalendarService $calendarService,
    ) {
    }

    /**
     * @param array<string, mixed> $vacations
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $selection
     *
     * @return array<string, mixed>
     */
    public function buildPlan(array $vacations, array $settings, array $selection): array
    {
        $scopedSettings = $this->getScopedSettings($settings, $selection);
        $months = $this->validateMonthSelection($selection['months'] ?? []);
        $employees = $this->buildSelections($vacations, $scopedSettings, $selection);

        if ([] === $employees) {
            throw new RuntimeException('Выберите хотя бы одного сотрудника.');
        }

        $unassigned = array_values(array_filter($employees, static fn (array $employee): bool => '' === (string) ($employee['roleKey'] ?? '')));
        if ([] !== $unassigned) {
            throw new RuntimeException('У части выбранных сотрудников в файле не заполнена или не распознана должность.');
        }

        $roles = [];
        foreach (($scopedSettings['roles'] ?? []) as $role) {
            $role['employees'] = array_values(array_filter($employees, static fn (array $employee): bool => ($employee['roleKey'] ?? '') === ($role['key'] ?? '')));
            $roles[] = $role;
        }

        $weeks = $this->weeksForMonths($months, $scopedSettings);
        if ([] === $weeks) {
            throw new RuntimeException('Не удалось построить недели выбранного периода.');
        }

        $workdayMap = $this->calendarService->fetchWorkdayMap($weeks[0]['start'], $weeks[count($weeks) - 1]['end'], $scopedSettings['calendarApi'] ?? []);
        foreach ($weeks as &$week) {
            $week['baselineWorkingDays'] = $this->getBaselineWorkdays($week);
            $week['workingDays'] = count(array_filter(
                DateHelper::enumerateDays($week['sprintStart'], $week['sprintEnd']),
                static fn (DateTimeImmutable $day): bool => (bool) ($workdayMap[DateHelper::toIsoDate($day)] ?? false)
            ));
            $week['label'] = DateHelper::formatShortRange($week['sprintStart'], $week['sprintEnd']);
        }
        unset($week);

        $monthBlocks = [];
        foreach ($months as $month) {
            $monthDate = DateHelper::parseMonthKey($month);
            $monthWeeks = array_values(array_filter($weeks, static fn (array $week): bool => $week['monthKey'] === $month));
            $monthBlocks[] = [
                'key' => $month,
                'name' => DateHelper::capitalize(DateHelper::getMonthName($monthDate)),
                'totalLabel' => 'Итого '.DateHelper::getMonthName($monthDate),
                'weeks' => $monthWeeks,
            ];
        }

        $roleSummaries = [];
        foreach ($roles as $role) {
            $rows = [];
            foreach (($role['employees'] ?? []) as $employee) {
                $weekValues = [];
                foreach ($weeks as $week) {
                    $vacationWorkdays = $this->getVacationWorkdays($employee, $week, $workdayMap);
                    $availableDays = max(((int) $week['workingDays']) - $vacationWorkdays, 0);
                    $baselineWorkingDays = (int) ($week['baselineWorkingDays'] ?? $week['workingDays'] ?? 0);
                    $value = $baselineWorkingDays > 0
                        ? (int) round((((float) ($role['primaryHours'] ?? 0)) * $availableDays / $baselineWorkingDays) * ((float) ($employee['participationFactor'] ?? 1)))
                        : 0;

                    $weekValues[] = [
                        'weekKey' => $week['key'],
                        'value' => $value,
                    ];
                }

                $monthTotals = [];
                foreach ($monthBlocks as $block) {
                    $monthTotals[$block['key']] = array_sum(array_map(
                        static fn (array $item): int => (int) $item['value'],
                        array_values(array_filter($weekValues, static fn (array $item): bool => in_array($item['weekKey'], array_map(static fn (array $week): string => $week['key'], $block['weeks']), true)))
                    ));
                }

                $rows[] = [
                    'id' => $employee['id'],
                    'name' => $employee['fullName'],
                    'department' => $employee['department'],
                    'participationPercent' => $employee['participationPercent'],
                    'participationFactor' => $employee['participationFactor'],
                    'weekValues' => $weekValues,
                    'monthTotals' => $monthTotals,
                ];
            }

            $weekTotals = [];
            foreach ($weeks as $week) {
                $weekKey = $week['key'];
                $weekTotals[$weekKey] = array_sum(array_map(static function (array $row) use ($weekKey): int {
                    foreach ($row['weekValues'] as $item) {
                        if ($item['weekKey'] === $weekKey) {
                            return (int) $item['value'];
                        }
                    }

                    return 0;
                }, $rows));
            }

            $monthTotals = [];
            foreach ($monthBlocks as $block) {
                $monthTotals[$block['key']] = array_sum(array_map(static fn (array $week) => (int) ($weekTotals[$week['key']] ?? 0), $block['weeks']));
            }

            $employeeCount = round(array_sum(array_map(static fn (array $row): float => (float) ($row['participationFactor'] ?? 1), $rows)) * 10) / 10;
            $sprintCapacity = array_sum(array_map(static fn (array $row): float => ((float) ($row['participationFactor'] ?? 1)) * ((float) ($role['primaryHours'] ?? 0)), $rows));

            $roleSummaries[] = [
                'key' => $role['key'],
                'name' => $role['name'],
                'summaryLabel' => $role['summaryLabel'] ?? $role['name'],
                'detailTotalLabel' => $role['detailTotalLabel'] ?? ('Итого '.$role['name']),
                'employeeCount' => $employeeCount,
                'sprintHours' => (float) ($role['sprintHours'] ?? 0),
                'primaryHours' => (float) ($role['primaryHours'] ?? 0),
                'secondaryHours' => (float) ($role['secondaryHours'] ?? 0),
                'rows' => $rows,
                'weekTotals' => $weekTotals,
                'monthTotals' => $monthTotals,
                'periodTotal' => array_sum($monthTotals),
                'sprintCapacity' => $sprintCapacity,
            ];
        }

        $roleSummaryMap = [];
        foreach ($roleSummaries as $role) {
            $roleSummaryMap[$role['key']] = $role;
        }

        $groupSummaries = [];
        foreach ($this->getRoleGroups($scopedSettings) as $group) {
            $memberRoles = array_values(array_filter(array_map(
                static fn (string $roleKey): ?array => $roleSummaryMap[$roleKey] ?? null,
                $group['roleKeys'] ?? []
            )));

            $rows = [];
            foreach ($memberRoles as $role) {
                foreach ($role['rows'] as $row) {
                    $rows[] = array_merge($row, [
                        'roleKey' => $role['key'],
                        'roleName' => $role['name'],
                    ]);
                }
            }

            $weekTotals = [];
            foreach ($weeks as $week) {
                $weekTotals[$week['key']] = array_sum(array_map(static fn (array $role): int => (int) ($role['weekTotals'][$week['key']] ?? 0), $memberRoles));
            }

            $monthTotals = [];
            foreach ($monthBlocks as $block) {
                $monthTotals[$block['key']] = array_sum(array_map(static fn (array $role): int => (int) ($role['monthTotals'][$block['key']] ?? 0), $memberRoles));
            }

            $groupSummaries[] = [
                'key' => $group['key'],
                'name' => $group['name'],
                'summaryLabel' => $group['summaryLabel'] ?? $group['name'],
                'detailTotalLabel' => $group['detailTotalLabel'] ?? ('Итого '.$group['name']),
                'employeeCount' => array_sum(array_map(static fn (array $role): float => (float) ($role['employeeCount'] ?? 0), $memberRoles)),
                'sprintCapacity' => array_sum(array_map(static fn (array $role): float => (float) ($role['sprintCapacity'] ?? 0), $memberRoles)),
                'rows' => $rows,
                'weekTotals' => $weekTotals,
                'monthTotals' => $monthTotals,
                'periodTotal' => array_sum($monthTotals),
                'roleKeys' => array_values(array_map(static fn (array $role): string => (string) $role['key'], $memberRoles)),
            ];
        }

        $selectedDepartments = array_values(array_unique(array_map(static fn (array $employee): string => (string) $employee['department'], $employees)));
        $reportGroupingMode = (string) ($scopedSettings['misc']['reportGroupingMode'] ?? 'grouped');
        $reportRoles = 'ungrouped' === $reportGroupingMode
            ? $this->sortUngroupedRoles($roleSummaries)
            : $groupSummaries;
        $reportRoles = array_values(array_filter($reportRoles, static fn (array $role): bool => ((float) ($role['employeeCount'] ?? 0)) > 0 || ((float) ($role['periodTotal'] ?? 0)) > 0));

        return [
            'generatedAt' => (new DateTimeImmutable('now', DateHelper::utc()))->format(DATE_ATOM),
            'teamKey' => (string) ($selection['teamKey'] ?? ''),
            'distribution' => $scopedSettings['distribution'] ?? ($settings['distribution'] ?? []),
            'periodLabel' => $monthBlocks[0]['name'].(count($monthBlocks) > 1 ? ' - '.$monthBlocks[count($monthBlocks) - 1]['name'] : '').' '.DateHelper::parseMonthKey($months[0])->format('Y'),
            'months' => $months,
            'monthBlocks' => $monthBlocks,
            'weeks' => $weeks,
            'roles' => $reportRoles,
            'sourceRoles' => $roleSummaries,
            'reportGroupingMode' => $reportGroupingMode,
            'selectedDepartments' => $selectedDepartments,
            'selectedEmployees' => array_values(array_map(static fn (array $employee): array => [
                'id' => $employee['id'],
                'fullName' => $employee['fullName'],
                'department' => $employee['department'],
                'position' => $employee['position'],
                'participationPercent' => $employee['participationPercent'],
                'roleKey' => $employee['roleKey'],
            ], $employees)),
            'stats' => [
                'departments' => count($selectedDepartments),
                'employees' => count($employees),
                'weeks' => count($weeks),
            ],
        ];
    }

    /**
     * @param list<string> $months
     *
     * @return list<string>
     */
    private function validateMonthSelection(array $months): array
    {
        if ([] === $months) {
            throw new RuntimeException('Выберите минимум один месяц.');
        }

        sort($months);

        if (count($months) > 3) {
            throw new RuntimeException('Для экспорта по шаблону можно выбрать не более трёх месяцев.');
        }

        $first = DateHelper::parseMonthKey($months[0]);
        $last = DateHelper::parseMonthKey($months[count($months) - 1]);
        $contiguous = DateHelper::listMonthKeysBetween($first, $last);

        if (count($contiguous) !== count($months) || array_values($contiguous) !== array_values($months)) {
            throw new RuntimeException('Месяцы должны идти подряд без пропусков.');
        }

        return array_values($months);
    }

    /**
     * @param array<string, mixed> $vacations
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $selection
     *
     * @return list<array<string, mixed>>
     */
    private function buildSelections(array $vacations, array $settings, array $selection): array
    {
        $selectedDepartments = array_fill_keys(array_map('strval', $selection['departments'] ?? []), true);
        $selectedEmployees = array_fill_keys(array_map('strval', $selection['employeeIds'] ?? []), true);
        $employeeMap = [];
        foreach (($vacations['employees'] ?? []) as $employee) {
            $employeeMap[(string) $employee['id']] = $employee;
        }

        $teamMembers = [];
        foreach (($settings['teams'] ?? []) as $team) {
            if (($selection['teamKey'] ?? '') === ($team['key'] ?? '')) {
                $teamMembers = $team['members'] ?? [];
                break;
            }
        }

        $result = [];
        foreach (array_keys($selectedEmployees) as $id) {
            $employee = $employeeMap[$id] ?? null;
            if (!is_array($employee)) {
                continue;
            }

            if (!isset($selectedDepartments[(string) ($employee['department'] ?? '')])) {
                continue;
            }

            $matchedMember = null;
            foreach ($teamMembers as $member) {
                if ($this->normalizeComparable((string) ($member['department'] ?? '')) === $this->normalizeComparable((string) ($employee['department'] ?? ''))
                    && $this->normalizeComparable((string) ($member['position'] ?? '')) === $this->normalizeComparable((string) ($employee['position'] ?? ''))
                    && $this->normalizeComparable((string) ($member['fullName'] ?? '')) === $this->normalizeComparable((string) ($employee['fullName'] ?? ''))) {
                    $matchedMember = $member;
                    break;
                }
            }

            $participationPercent = max(0, min(100, (int) ($matchedMember['participationPercent'] ?? 100)));

            $result[] = array_merge($employee, [
                'participationPercent' => $participationPercent,
                'participationFactor' => $participationPercent / 100,
                'roleKey' => $this->inferRoleKeyByPosition($settings['roles'] ?? [], (string) ($employee['position'] ?? ''))
                    ?: (string) (($settings['userAssignments'] ?? [])[$employee['id']] ?? ''),
            ]);
        }

        return $result;
    }

    /**
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $selection
     *
     * @return array<string, mixed>
     */
    private function getScopedSettings(array $settings, array $selection): array
    {
        $teamKey = trim((string) ($selection['teamKey'] ?? ''));
        if ('' === $teamKey) {
            return $settings;
        }

        $team = null;
        foreach (($settings['teams'] ?? []) as $item) {
            if (($item['key'] ?? '') === $teamKey) {
                $team = $item;
                break;
            }
        }

        if (!is_array($team)) {
            return $settings;
        }

        $allowedGroupKeys = array_fill_keys(array_map('strval', $team['groupKeys'] ?? []), true);
        $scopedGroups = array_values(array_filter($settings['roleGroups'] ?? [], static fn (array $group): bool => isset($allowedGroupKeys[(string) ($group['key'] ?? '')])));
        if ([] === $scopedGroups) {
            return $settings;
        }

        $allowedRoleKeys = [];
        foreach ($scopedGroups as $group) {
            foreach (($group['roleKeys'] ?? []) as $roleKey) {
                $allowedRoleKeys[(string) $roleKey] = true;
            }
        }

        $scopedRoles = array_values(array_filter($settings['roles'] ?? [], static fn (array $role): bool => isset($allowedRoleKeys[(string) ($role['key'] ?? '')])));
        $userAssignments = [];
        foreach (($settings['userAssignments'] ?? []) as $employeeId => $roleKey) {
            if (isset($allowedRoleKeys[(string) $roleKey])) {
                $userAssignments[$employeeId] = $roleKey;
            }
        }

        return array_merge($settings, [
            'teamKey' => $team['key'],
            'distribution' => $team['distribution'] ?? ($settings['distribution'] ?? []),
            'roles' => $scopedRoles,
            'roleGroups' => $scopedGroups,
            'userAssignments' => $userAssignments,
        ]);
    }

    /**
     * @param array<int, array<string, mixed>> $settings
     *
     * @return list<array<string, mixed>>
     */
    private function getRoleGroups(array $settings): array
    {
        $roles = $settings['roles'] ?? [];
        $defaultGroups = [
            ['key' => 'analysts', 'name' => 'Аналитики', 'summaryLabel' => 'Аналитики', 'detailTotalLabel' => 'Итого Аналитики', 'roleKeys' => []],
            ['key' => 'development', 'name' => 'Разработка', 'summaryLabel' => 'Разработка', 'detailTotalLabel' => 'Итого Разработчики', 'roleKeys' => []],
            ['key' => 'testing', 'name' => 'Тестирование', 'summaryLabel' => 'Тестирование', 'detailTotalLabel' => 'Итого Тестировщики', 'roleKeys' => []],
        ];

        $sourceGroups = !empty($settings['roleGroups']) ? $settings['roleGroups'] : $defaultGroups;
        $validRoleKeys = [];
        foreach ($roles as $role) {
            $validRoleKeys[(string) ($role['key'] ?? '')] = true;
        }

        $assigned = [];
        $groups = [];
        foreach ($sourceGroups as $index => $group) {
            $fallback = $defaultGroups[$index] ?? $defaultGroups[0];
            $roleKeys = [];
            foreach (($group['roleKeys'] ?? []) as $roleKey) {
                $roleKey = (string) $roleKey;
                if (!isset($validRoleKeys[$roleKey]) || isset($assigned[$roleKey])) {
                    continue;
                }
                $assigned[$roleKey] = true;
                $roleKeys[] = $roleKey;
            }

            $groups[] = [
                'key' => $group['key'] ?? $fallback['key'],
                'name' => $group['name'] ?? $fallback['name'],
                'summaryLabel' => $group['summaryLabel'] ?? ($group['name'] ?? $fallback['summaryLabel']),
                'detailTotalLabel' => $group['detailTotalLabel'] ?? $fallback['detailTotalLabel'],
                'roleKeys' => $roleKeys,
            ];
        }

        foreach ($roles as $role) {
            $roleKey = (string) ($role['key'] ?? '');
            if (isset($assigned[$roleKey])) {
                continue;
            }
            $targetGroupKey = $this->inferRoleGroupKey($role);
            $targetIndex = 0;
            foreach ($groups as $index => $group) {
                if (($group['key'] ?? '') === $targetGroupKey) {
                    $targetIndex = $index;
                    break;
                }
            }
            $groups[$targetIndex]['roleKeys'][] = $roleKey;
            $assigned[$roleKey] = true;
        }

        return $groups;
    }

    /**
     * @param list<string> $months
     * @param array<string, mixed> $settings
     *
     * @return list<array<string, mixed>>
     */
    private function weeksForMonths(array $months, array $settings): array
    {
        $firstMonth = DateHelper::parseMonthKey($months[0]);
        $lastMonth = DateHelper::parseMonthKey($months[count($months) - 1]);
        $selectedMonthSet = array_fill_keys($months, true);
        $cursor = DateHelper::startOfMonth($firstMonth);
        $endDate = DateHelper::endOfMonth($lastMonth);
        $duration = $this->getSprintDurationDays($settings);
        $weekday = $this->getSprintStartWeekday($settings);
        $weeks = [];
        $sprintNumber = DateHelper::getIsoWeek($cursor);

        while ($cursor <= $endDate) {
            $weekEnd = $cursor->modify('+6 day');
            $sprintStart = $this->resolveSprintStartForWindow($cursor, $weekday);
            $sprintEnd = $sprintStart->modify(sprintf('+%d day', $duration - 1));
            $key = DateHelper::monthKey($weekEnd);

            if (isset($selectedMonthSet[$key])) {
                $weeks[] = [
                    'key' => DateHelper::toIsoDate($sprintStart).'_'.DateHelper::toIsoDate($sprintEnd),
                    'monthKey' => $key,
                    'monthName' => DateHelper::getMonthName($weekEnd),
                    'start' => $cursor,
                    'end' => $weekEnd,
                    'sprintStart' => $sprintStart,
                    'sprintEnd' => $sprintEnd,
                    'isoWeek' => DateHelper::getIsoWeek($cursor),
                    'sprintNumber' => $sprintNumber,
                ];
            }

            $cursor = $cursor->modify('+7 day');
            ++$sprintNumber;
        }

        return $weeks;
    }

    private function getSprintDurationDays(array $settings): int
    {
        $value = (int) ($settings['misc']['sprintDurationDays'] ?? 7);
        if ($value < 1) {
            return 7;
        }

        return min($value, 9);
    }

    private function getSprintStartWeekday(array $settings): int
    {
        return match (strtolower((string) ($settings['misc']['sprintStartDay'] ?? 'monday'))) {
            'sunday' => 0,
            'monday' => 1,
            'tuesday' => 2,
            'wednesday' => 3,
            'thursday' => 4,
            'friday' => 5,
            'saturday' => 6,
            default => 1,
        };
    }

    private function resolveSprintStartForWindow(DateTimeImmutable $windowStart, int $weekday): DateTimeImmutable
    {
        $result = $windowStart;
        while ((int) $result->format('w') !== $weekday) {
            $result = $result->modify('+1 day');
        }

        return $result;
    }

    /**
     * @param array<string, mixed> $employee
     * @param array<string, mixed> $week
     * @param array<string, bool> $workdayMap
     */
    private function getVacationWorkdays(array $employee, array $week, array $workdayMap): int
    {
        $count = 0;
        foreach (DateHelper::enumerateDays($week['sprintStart'], $week['sprintEnd']) as $day) {
            $iso = DateHelper::toIsoDate($day);
            if (!($workdayMap[$iso] ?? false)) {
                continue;
            }

            foreach (($employee['vacations'] ?? []) as $period) {
                $start = new DateTimeImmutable((string) $period['start'].' 00:00:00', DateHelper::utc());
                $end = new DateTimeImmutable((string) $period['end'].' 00:00:00', DateHelper::utc());
                if ($day >= $start && $day <= $end) {
                    ++$count;
                    break;
                }
            }
        }

        return $count;
    }

    /**
     * @param array<string, mixed> $week
     */
    private function getBaselineWorkdays(array $week): int
    {
        return count(array_filter(
            DateHelper::enumerateDays($week['sprintStart'], $week['sprintEnd']),
            static fn (DateTimeImmutable $day): bool => !in_array((int) $day->format('w'), [0, 6], true)
        ));
    }

    /**
     * @param list<array<string, mixed>> $roles
     *
     * @return list<array<string, mixed>>
     */
    private function sortUngroupedRoles(array $roles): array
    {
        usort($roles, function (array $left, array $right): int {
            $leftOrder = $this->getUngroupedRoleOrder($left);
            $rightOrder = $this->getUngroupedRoleOrder($right);

            if ($leftOrder !== $rightOrder) {
                return $leftOrder <=> $rightOrder;
            }

            return strnatcasecmp((string) ($left['name'] ?? ''), (string) ($right['name'] ?? ''));
        });

        return $roles;
    }

    private function getUngroupedRoleOrder(array $role): int
    {
        $normalized = $this->normalizeComparable((string) ($role['name'] ?? ''));

        return match (true) {
            str_contains($normalized, 'руковод') && str_contains($normalized, 'аналит') => 1,
            str_contains($normalized, 'аналит') => 0,
            str_contains($normalized, 'тест') => 2,
            str_contains($normalized, 'руковод') && str_contains($normalized, 'разработ') => 4,
            str_contains($normalized, 'разработ') => 3,
            default => 100,
        };
    }

    /**
     * @param list<array<string, mixed>> $roles
     */
    private function inferRoleKeyByPosition(array $roles, string $position): string
    {
        $normalizedPosition = $this->normalizeComparable($position);
        if ('' === $normalizedPosition) {
            return '';
        }

        foreach ($roles as $role) {
            if ($this->normalizeComparable((string) ($role['name'] ?? '')) === $normalizedPosition) {
                return (string) ($role['key'] ?? '');
            }
        }

        $rules = [
            ['token' => 'разработ', 'roleToken' => 'разработ'],
            ['token' => 'тест', 'roleToken' => 'тест'],
            ['token' => 'аналит', 'roleToken' => 'аналит'],
        ];

        foreach ($rules as $rule) {
            if (!str_contains($normalizedPosition, $rule['token'])) {
                continue;
            }

            foreach ($roles as $role) {
                if (str_contains($this->normalizeComparable((string) ($role['name'] ?? '')), $rule['roleToken'])) {
                    return (string) ($role['key'] ?? '');
                }
            }
        }

        return '';
    }

    private function inferRoleGroupKey(array $role): string
    {
        $normalized = $this->normalizeComparable((string) ($role['name'] ?? ''));

        if (str_contains($normalized, 'аналит')) {
            return 'analysts';
        }

        if (str_contains($normalized, 'тест')) {
            return 'testing';
        }

        return 'development';
    }

    private function normalizeComparable(string $value): string
    {
        $value = mb_strtolower($value);
        $value = str_replace('ё', 'е', $value);

        return trim((string) preg_replace('/[^\p{L}\p{N}]+/u', ' ', $value));
    }
}
