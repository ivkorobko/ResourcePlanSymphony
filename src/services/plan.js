"use strict";

const { fetchWorkdayMap } = require("./calendar");
const {
    capitalize,
    endOfMonth,
    enumerateDays,
    formatShortRange,
    getIsoWeek,
    getMonthName,
    listMonthKeysBetween,
    monthKey,
    parseMonthKey,
    startOfMonth,
    toIsoDate
} = require("../utils/date");

function validateMonthSelection(months) {
    if (!Array.isArray(months) || months.length === 0) {
        throw new Error("Выберите минимум один месяц.");
    }

    if (months.length > 3) {
        throw new Error("Для экспорта по шаблону можно выбрать не более трёх месяцев.");
    }

    const sorted = [...months].sort();
    const first = parseMonthKey(sorted[0]);
    const last = parseMonthKey(sorted[sorted.length - 1]);
    const contiguous = listMonthKeysBetween(first, last);

    if (contiguous.length !== sorted.length || !contiguous.every((item, index) => item === sorted[index])) {
        throw new Error("Месяцы должны идти подряд без пропусков.");
    }

    return sorted;
}

function normalizeComparable(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function inferRoleKeyByPosition(roles, position) {
    const normalizedPosition = normalizeComparable(position);
    if (!normalizedPosition) {
        return "";
    }

    const exactMatch = roles.find(role => normalizeComparable(role.name) === normalizedPosition);
    if (exactMatch) {
        return exactMatch.key;
    }

    const rules = [
        { token: "разработ", roleToken: "разработ" },
        { token: "тест", roleToken: "тест" },
        { token: "аналит", roleToken: "аналит" }
    ];

    for (const rule of rules) {
        if (!normalizedPosition.includes(rule.token)) {
            continue;
        }

        const matchedRole = roles.find(role => normalizeComparable(role.name).includes(rule.roleToken));
        if (matchedRole) {
            return matchedRole.key;
        }
    }

    return "";
}

function buildSelections(vacations, settings, selection) {
    const selectedDepartments = new Set(selection.departments || []);
    const selectedEmployees = new Set(selection.employeeIds || []);
    const employeeMap = new Map(vacations.employees.map(employee => [employee.id, employee]));
    const teamMembers = (settings.teams || []).find(team => team.key === selection.teamKey)?.members || [];
    const normalize = value => normalizeComparable(value);

    return [...selectedEmployees]
        .map(id => employeeMap.get(id))
        .filter(Boolean)
        .filter(employee => selectedDepartments.has(employee.department))
        .map(employee => {
            const matchedMember = teamMembers.find(member => (
                normalize(member.department) === normalize(employee.department)
                && normalize(member.position) === normalize(employee.position)
                && normalize(member.fullName) === normalize(employee.fullName)
            ));
            const participationPercent = Math.min(
                100,
                Math.max(0, Number.parseInt(matchedMember?.participationPercent, 10) || 100)
            );

            return {
                ...employee,
                participationPercent,
                participationFactor: participationPercent / 100,
                roleKey: inferRoleKeyByPosition(settings.roles || [], employee.position) || settings.userAssignments?.[employee.id] || ""
            };
        });
}

function getScopedSettings(settings, selection) {
    const teamKey = String(selection?.teamKey || "").trim();
    if (!teamKey) {
        return settings;
    }

    const team = (settings.teams || []).find(item => item.key === teamKey);
    if (!team) {
        return settings;
    }

    const allowedGroupKeys = new Set(team.groupKeys || []);
    const scopedGroups = (settings.roleGroups || []).filter(group => allowedGroupKeys.has(group.key));
    if (!scopedGroups.length) {
        return settings;
    }

    const allowedRoleKeys = new Set(scopedGroups.flatMap(group => group.roleKeys || []));
    const scopedRoles = (settings.roles || []).filter(role => allowedRoleKeys.has(role.key));

    return {
        ...settings,
        teamKey: team.key,
        distribution: team.distribution || settings.distribution,
        roles: scopedRoles,
        roleGroups: scopedGroups,
        userAssignments: Object.fromEntries(
            Object.entries(settings.userAssignments || {}).filter(([, roleKey]) => allowedRoleKeys.has(roleKey))
        )
    };
}

function inferRoleGroupKey(role) {
    const normalized = normalizeComparable(role?.name || "");

    if (normalized.includes("аналит")) {
        return "analysts";
    }

    if (normalized.includes("тест")) {
        return "testing";
    }

    return "development";
}

function getRoleGroups(settings) {
    const roles = settings.roles || [];
    const defaultGroups = [
        {
            key: "analysts",
            name: "Аналитики",
            summaryLabel: "Аналитики",
            detailTotalLabel: "Итого Аналитики",
            roleKeys: []
        },
        {
            key: "development",
            name: "Разработка",
            summaryLabel: "Разработка",
            detailTotalLabel: "Итого Разработчики",
            roleKeys: []
        },
        {
            key: "testing",
            name: "Тестирование",
            summaryLabel: "Тестирование",
            detailTotalLabel: "Итого Тестировщики",
            roleKeys: []
        }
    ];

    const sourceGroups = Array.isArray(settings.roleGroups) && settings.roleGroups.length
        ? settings.roleGroups
        : defaultGroups;
    const validRoleKeys = new Set(roles.map(role => role.key));
    const assigned = new Set();
    const groups = sourceGroups.map((group, index) => {
        const fallback = defaultGroups.find(item => item.key === group.key) || defaultGroups[index] || defaultGroups[0];
        const roleKeys = [];

        (group.roleKeys || []).forEach(roleKey => {
            if (!validRoleKeys.has(roleKey) || assigned.has(roleKey)) {
                return;
            }

            assigned.add(roleKey);
            roleKeys.push(roleKey);
        });

        return {
            key: group.key || fallback.key,
            name: group.name || fallback.name,
            summaryLabel: group.summaryLabel || group.name || fallback.summaryLabel,
            detailTotalLabel: group.detailTotalLabel || fallback.detailTotalLabel,
            roleKeys
        };
    });

    roles.forEach(role => {
        if (assigned.has(role.key)) {
            return;
        }

        const target = groups.find(group => group.key === inferRoleGroupKey(role)) || groups[0];
        target.roleKeys.push(role.key);
        assigned.add(role.key);
    });

    return groups;
}

function getUngroupedRoleOrder(role) {
    const normalized = normalizeComparable(role?.name || "");

    if (normalized.includes("руковод") && normalized.includes("аналит")) {
        return 1;
    }

    if (normalized.includes("аналит")) {
        return 0;
    }

    if (normalized.includes("тест")) {
        return 2;
    }

    if (normalized.includes("руковод") && normalized.includes("разработ")) {
        return 4;
    }

    if (normalized.includes("разработ")) {
        return 3;
    }

    return 100;
}

function getSprintDurationDays(settings) {
    const rawValue = Number(settings?.misc?.sprintDurationDays);
    if (!Number.isInteger(rawValue) || rawValue < 1) {
        return 7;
    }

    return Math.min(rawValue, 9);
}

function getSprintStartWeekday(settings) {
    const map = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6
    };
    const key = String(settings?.misc?.sprintStartDay || "monday").toLowerCase();
    return map[key] ?? 1;
}

function resolveSprintStartForWindow(windowStart, weekday) {
    const sprintStart = new Date(windowStart);

    while (sprintStart.getUTCDay() !== weekday) {
        sprintStart.setUTCDate(sprintStart.getUTCDate() + 1);
    }

    return sprintStart;
}

function weeksForMonths(months, settings) {
    const firstMonth = parseMonthKey(months[0]);
    const lastMonth = parseMonthKey(months[months.length - 1]);
    const selectedMonthSet = new Set(months);
    const firstWeekStart = startOfMonth(firstMonth);
    const endDate = endOfMonth(lastMonth);
    const duration = getSprintDurationDays(settings);
    const sprintWeekday = getSprintStartWeekday(settings);
    const weeks = [];
    let cursor = firstWeekStart;
    let sprintNumber = getIsoWeek(firstWeekStart);

    while (cursor <= endDate) {
        const weekEnd = new Date(cursor);
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
        const sprintStart = resolveSprintStartForWindow(cursor, sprintWeekday);
        const sprintEnd = new Date(sprintStart);
        sprintEnd.setUTCDate(sprintEnd.getUTCDate() + duration - 1);
        const key = monthKey(weekEnd);

        if (selectedMonthSet.has(key)) {
            weeks.push({
                key: `${toIsoDate(sprintStart)}_${toIsoDate(sprintEnd)}`,
                monthKey: key,
                monthName: getMonthName(weekEnd),
                start: new Date(cursor),
                end: new Date(weekEnd),
                sprintStart,
                sprintEnd,
                isoWeek: getIsoWeek(cursor),
                sprintNumber
            });
        }

        cursor = new Date(cursor);
        cursor.setUTCDate(cursor.getUTCDate() + 7);
        sprintNumber += 1;
    }

    return weeks;
}

function overlaps(date, start, end) {
    return date >= start && date <= end;
}

function getVacationWorkdays(employee, week, workdayMap) {
    let count = 0;
    const days = enumerateDays(week.sprintStart || week.start, week.sprintEnd || week.end);

    for (const day of days) {
        const iso = toIsoDate(day);

        if (!workdayMap.get(iso)) {
            continue;
        }

        const isVacation = employee.vacations.some(period => {
            const start = new Date(`${period.start}T00:00:00Z`);
            const end = new Date(`${period.end}T00:00:00Z`);
            return overlaps(day, start, end);
        });

        if (isVacation) {
            count += 1;
        }
    }

    return count;
}

function getBaselineWorkdays(week) {
    return enumerateDays(week.sprintStart || week.start, week.sprintEnd || week.end)
        .filter(day => {
            const dayOfWeek = day.getUTCDay();
            return dayOfWeek !== 0 && dayOfWeek !== 6;
        })
        .length;
}

async function buildPlan(vacations, settings, selection) {
    const scopedSettings = getScopedSettings(settings, selection);
    const months = validateMonthSelection(selection.months || []);
    const employees = buildSelections(vacations, scopedSettings, selection);

    if (!employees.length) {
        throw new Error("Выберите хотя бы одного сотрудника.");
    }

    const unassigned = employees.filter(employee => !employee.roleKey);
    if (unassigned.length) {
        throw new Error("У части выбранных сотрудников в файле не заполнена или не распознана должность.");
    }

    const roles = scopedSettings.roles.map(role => ({
        ...role,
        employees: employees.filter(employee => employee.roleKey === role.key)
    }));

    const weeks = weeksForMonths(months, scopedSettings);
    const workdayRangeStart = weeks[0].start;
    const workdayRangeEnd = weeks[weeks.length - 1].end;
    const workdayMap = await fetchWorkdayMap(workdayRangeStart, workdayRangeEnd, scopedSettings.calendarApi);

    weeks.forEach(week => {
        week.baselineWorkingDays = getBaselineWorkdays(week);
        week.workingDays = enumerateDays(week.sprintStart, week.sprintEnd)
            .map(day => workdayMap.get(toIsoDate(day)))
            .filter(Boolean)
            .length;
        week.label = formatShortRange(week.sprintStart, week.sprintEnd);
    });

    const monthBlocks = months.map(month => {
        const monthWeeks = weeks.filter(week => week.monthKey === month);
        return {
            key: month,
            name: capitalize(getMonthName(parseMonthKey(month))),
            totalLabel: `Итого ${getMonthName(parseMonthKey(month))}`,
            weeks: monthWeeks
        };
    });

    const roleSummaries = roles.map(role => {
        const rows = role.employees.map(employee => {
            const weekValues = weeks.map(week => {
                const vacationWorkdays = getVacationWorkdays(employee, week, workdayMap);
                const availableDays = Math.max(week.workingDays - vacationWorkdays, 0);
                const baselineWorkingDays = week.baselineWorkingDays || week.workingDays || 0;
                const value = baselineWorkingDays
                    ? Math.round(((role.primaryHours * availableDays) / baselineWorkingDays) * (employee.participationFactor || 1))
                    : 0;

                return {
                    weekKey: week.key,
                    value
                };
            });

            const monthTotals = Object.fromEntries(
                monthBlocks.map(block => [
                    block.key,
                    weekValues
                        .filter(item => block.weeks.some(week => week.key === item.weekKey))
                        .reduce((sum, item) => sum + item.value, 0)
                ])
            );

            return {
                id: employee.id,
                name: employee.fullName,
                department: employee.department,
                participationPercent: employee.participationPercent || 100,
                participationFactor: employee.participationFactor || 1,
                weekValues,
                monthTotals
            };
        });

        const weekTotals = Object.fromEntries(weeks.map(week => [
            week.key,
            rows.reduce((sum, row) => sum + row.weekValues.find(item => item.weekKey === week.key).value, 0)
        ]));

        const monthTotals = Object.fromEntries(monthBlocks.map(block => [
            block.key,
            block.weeks.reduce((sum, week) => sum + (weekTotals[week.key] || 0), 0)
        ]));

        return {
            key: role.key,
            name: role.name,
            summaryLabel: role.summaryLabel,
            detailTotalLabel: role.detailTotalLabel,
            employeeCount: Math.round(rows.reduce((sum, row) => sum + (row.participationFactor || 1), 0) * 10) / 10,
            sprintHours: role.sprintHours,
            primaryHours: role.primaryHours,
            secondaryHours: role.secondaryHours,
            rows,
            weekTotals,
            monthTotals,
            periodTotal: Object.values(monthTotals).reduce((sum, value) => sum + value, 0),
            sprintCapacity: rows.reduce((sum, row) => sum + ((row.participationFactor || 1) * (Number(role.primaryHours) || 0)), 0)
        };
    });

    const roleSummaryMap = new Map(roleSummaries.map(role => [role.key, role]));
    const groupSummaries = getRoleGroups(scopedSettings).map(group => {
        const memberRoles = group.roleKeys
            .map(roleKey => roleSummaryMap.get(roleKey))
            .filter(Boolean);
        const rows = memberRoles.flatMap(role => role.rows.map(row => ({
            ...row,
            roleKey: role.key,
            roleName: role.name
        })));
        const weekTotals = Object.fromEntries(weeks.map(week => [
            week.key,
            memberRoles.reduce((sum, role) => sum + (role.weekTotals[week.key] || 0), 0)
        ]));
        const monthTotals = Object.fromEntries(monthBlocks.map(block => [
            block.key,
            memberRoles.reduce((sum, role) => sum + (role.monthTotals[block.key] || 0), 0)
        ]));
        const employeeCount = memberRoles.reduce((sum, role) => sum + role.employeeCount, 0);
        const sprintCapacity = memberRoles.reduce((sum, role) => sum + (role.sprintCapacity || 0), 0);

        return {
            key: group.key,
            name: group.name,
            summaryLabel: group.summaryLabel || group.name,
            detailTotalLabel: group.detailTotalLabel || `Итого ${group.name}`,
            employeeCount,
            sprintCapacity,
            rows,
            weekTotals,
            monthTotals,
            periodTotal: Object.values(monthTotals).reduce((sum, value) => sum + value, 0),
            roleKeys: memberRoles.map(role => role.key)
        };
    });

    const selectedDepartments = [...new Set(employees.map(employee => employee.department))];
    const reportGroupingMode = scopedSettings?.misc?.reportGroupingMode || "grouped";
    const reportRoles = (reportGroupingMode === "ungrouped"
        ? [...roleSummaries].sort((left, right) => {
            const orderDelta = getUngroupedRoleOrder(left) - getUngroupedRoleOrder(right);
            if (orderDelta !== 0) {
                return orderDelta;
            }

            return String(left.name || "").localeCompare(String(right.name || ""), "ru");
        })
        : groupSummaries)
        .filter(role => role.employeeCount > 0 || role.periodTotal > 0);

    return {
        generatedAt: new Date().toISOString(),
        teamKey: selection.teamKey || "",
        distribution: scopedSettings.distribution || settings.distribution,
        periodLabel: `${monthBlocks[0].name}${monthBlocks.length > 1 ? ` - ${monthBlocks[monthBlocks.length - 1].name}` : ""} ${parseMonthKey(months[0]).getUTCFullYear()}`,
        months,
        monthBlocks,
        weeks,
        roles: reportRoles,
        sourceRoles: roleSummaries,
        reportGroupingMode,
        selectedDepartments,
        selectedEmployees: employees.map(employee => ({
            id: employee.id,
            fullName: employee.fullName,
            department: employee.department,
            position: employee.position,
            participationPercent: employee.participationPercent || 100,
            roleKey: employee.roleKey
        })),
        stats: {
            departments: selectedDepartments.length,
            employees: employees.length,
            weeks: weeks.length
        }
    };
}

module.exports = {
    buildPlan
};
