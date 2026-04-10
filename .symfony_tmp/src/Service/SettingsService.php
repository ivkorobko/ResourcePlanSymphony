<?php

namespace App\Service;

use DateTimeImmutable;
use RuntimeException;

final class SettingsService
{
    /**
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $vacations
     *
     * @return array<string, mixed>
     */
    public function syncSettingsWithVacations(array $settings, array $vacations): array
    {
        $employees = is_array($vacations['employees'] ?? null) ? $vacations['employees'] : [];
        $nextAssignments = is_array($settings['userAssignments'] ?? null) ? $settings['userAssignments'] : [];
        $validIds = array_fill_keys(array_map(static fn (array $employee): string => (string) ($employee['id'] ?? ''), $employees), true);

        foreach (array_keys($nextAssignments) as $employeeId) {
            if (!isset($validIds[(string) $employeeId])) {
                unset($nextAssignments[$employeeId]);
            }
        }

        foreach ($employees as $employee) {
            $employeeId = (string) ($employee['id'] ?? '');
            $inferredRoleKey = $this->inferRoleKeyByPosition($settings['roles'] ?? [], (string) ($employee['position'] ?? ''));
            if ('' !== $employeeId && '' !== $inferredRoleKey) {
                $nextAssignments[$employeeId] = $inferredRoleKey;
            }
        }

        $settings['userAssignments'] = $nextAssignments;
        $settings['updatedAt'] = $this->nowIso();

        return $settings;
    }

    /**
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $vacations
     * @param list<string> $employeeIds
     * @param list<array<string, mixed>> $requestMembers
     *
     * @return array{settings: array<string, mixed>, team: array<string, mixed>}
     */
    public function saveTeamMembers(array $settings, array $vacations, string $teamKey, array $employeeIds, array $requestMembers): array
    {
        $team = &$this->findTeamByKey($settings, $teamKey);
        $employeeMap = [];
        foreach (($vacations['employees'] ?? []) as $employee) {
            $employeeMap[(string) ($employee['id'] ?? '')] = $employee;
        }

        if ([] !== $requestMembers) {
            $normalizedMembers = array_values(array_filter(array_map(function (mixed $member): ?array {
                if (!is_array($member)) {
                    return null;
                }

                $normalized = [
                    'department' => trim((string) ($member['department'] ?? '')),
                    'position' => trim((string) ($member['position'] ?? '')),
                    'role' => trim((string) ($member['role'] ?? $member['position'] ?? '')),
                    'fullName' => trim((string) ($member['fullName'] ?? '')),
                    'participationPercent' => min(100, max(0, (int) ($member['participationPercent'] ?? 100))),
                ];

                return ($normalized['department'] !== '' || $normalized['position'] !== '' || $normalized['fullName'] !== '') ? $normalized : null;
            }, $requestMembers)));
        } else {
            $normalizedMembers = [];
            foreach ($employeeIds as $employeeId) {
                $employee = $employeeMap[$employeeId] ?? null;
                if (!is_array($employee)) {
                    continue;
                }

                $normalizedMembers[] = [
                    'department' => (string) ($employee['department'] ?? ''),
                    'position' => (string) ($employee['position'] ?? ''),
                    'role' => (string) ($employee['position'] ?? ''),
                    'fullName' => (string) ($employee['fullName'] ?? ''),
                    'participationPercent' => 100,
                ];
            }
        }

        $team['members'] = $normalizedMembers;
        $settings['updatedAt'] = $this->nowIso();

        return [
            'settings' => $settings,
            'team' => $team,
        ];
    }

    /**
     * @param array<string, mixed> $settings
     *
     * @return array{settings: array<string, mixed>, team: array<string, mixed>}
     */
    public function clearTeamMembers(array $settings, string $teamKey): array
    {
        $team = &$this->findTeamByKey($settings, $teamKey);
        $team['members'] = [];
        $settings['updatedAt'] = $this->nowIso();

        return [
            'settings' => $settings,
            'team' => $team,
        ];
    }

    /**
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $vacations
     *
     * @return array{settings: array<string, mixed>, team: array<string, mixed>}
     */
    public function refreshTeamMembers(array $settings, array $vacations, string $teamKey): array
    {
        $team = &$this->findTeamByKey($settings, $teamKey);
        $employees = is_array($vacations['employees'] ?? null) ? $vacations['employees'] : [];

        $team['members'] = array_map(function (mixed $member) use ($employees): mixed {
            if (!is_array($member)) {
                return $member;
            }

            $exactMatch = null;
            foreach ($employees as $employee) {
                if (
                    $this->normalizeComparable((string) ($employee['department'] ?? '')) === $this->normalizeComparable((string) ($member['department'] ?? ''))
                    && $this->normalizeComparable((string) ($employee['fullName'] ?? '')) === $this->normalizeComparable((string) ($member['fullName'] ?? ''))
                ) {
                    $exactMatch = $employee;
                    break;
                }
            }

            $sameNameEmployees = array_values(array_filter(
                $employees,
                fn (array $employee): bool => $this->normalizeComparable((string) ($employee['fullName'] ?? '')) === $this->normalizeComparable((string) ($member['fullName'] ?? ''))
            ));
            $fallbackByName = 1 === count($sameNameEmployees) ? $sameNameEmployees[0] : null;
            $matchedEmployee = is_array($exactMatch) ? $exactMatch : $fallbackByName;

            if (!is_array($matchedEmployee)) {
                return $member;
            }

            return [
                'department' => (string) ($matchedEmployee['department'] ?? ''),
                'position' => (string) ($matchedEmployee['position'] ?? ''),
                'role' => trim((string) ($member['role'] ?? $matchedEmployee['position'] ?? '')),
                'fullName' => (string) ($matchedEmployee['fullName'] ?? ''),
                'participationPercent' => min(100, max(0, (int) ($member['participationPercent'] ?? 100))),
            ];
        }, is_array($team['members'] ?? null) ? $team['members'] : []);

        $settings['updatedAt'] = $this->nowIso();

        return [
            'settings' => $settings,
            'team' => $team,
        ];
    }

    /**
     * @param list<array<string, mixed>> $roles
     */
    public function inferRoleKeyByPosition(array $roles, string $position): string
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

    public function normalizeComparable(string $value): string
    {
        $value = mb_strtolower($value);
        $value = str_replace('ё', 'е', $value);

        return trim((string) preg_replace('/[^\p{L}\p{N}]+/u', ' ', $value));
    }

    /**
     * @param array<string, mixed> $settings
     *
     * @return array<string, mixed>
     */
    private function &findTeamByKey(array &$settings, string $teamKey): array
    {
        $teamKey = trim($teamKey);
        if ('' === $teamKey) {
            throw new RuntimeException('Не выбрана команда.');
        }

        if (!isset($settings['teams']) || !is_array($settings['teams'])) {
            throw new RuntimeException('Команда не найдена.');
        }

        foreach ($settings['teams'] as &$team) {
            if (($team['key'] ?? '') === $teamKey) {
                return $team;
            }
        }

        throw new RuntimeException('Команда не найдена.');
    }

    private function nowIso(): string
    {
        return (new DateTimeImmutable('now', DateHelper::utc()))->format(DATE_ATOM);
    }
}
