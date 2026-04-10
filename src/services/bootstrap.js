"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const ExcelJS = require("exceljs");
const {
    DEFAULT_VACATIONS_SOURCE,
    SETTINGS_PATH,
    TEMPLATE_PATH,
    VACATIONS_PATH,
    readJson,
    writeJson
} = require("./storage");
const {
    addMonths,
    endOfMonth,
    excelSerialToDate,
    monthKey,
    parseMonthKey,
    startOfMonth,
    toIsoDate
} = require("../utils/date");

function textValue(cell) {
    const { value } = cell;

    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "object") {
        if (value.text) {
            return String(value.text).trim();
        }

        if (value.richText) {
            return value.richText.map(part => part.text).join("").trim();
        }

        if (value.result !== undefined && value.result !== null) {
            return String(value.result).trim();
        }
    }

    return String(value).trim();
}

function numberValue(cell) {
    const { value } = cell;

    if (value === null || value === undefined || value === "") {
        return 0;
    }

    if (typeof value === "object" && value.result !== undefined && value.result !== null) {
        return Number(value.result) || 0;
    }

    return Number(value) || 0;
}

function dateValue(cell) {
    const { value } = cell;

    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return value;
    }

    if (typeof value === "number") {
        return excelSerialToDate(value);
    }

    if (typeof value === "object" && value.result) {
        if (value.result instanceof Date) {
            return value.result;
        }

        if (typeof value.result === "number") {
            return excelSerialToDate(value.result);
        }
    }

    return null;
}

function buildEmployeeId(department, fullName) {
    const source = `${department}::${fullName}`.toLowerCase();
    return source
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}\s:.-]+/gu, "")
        .replace(/\s+/g, "-");
}

function findHeaderRow(sheet) {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const first = textValue(row.getCell(1)).toLowerCase();
        const second = textValue(row.getCell(2)).toLowerCase();

        if (first.includes("отдел") && second.includes("фио")) {
            return rowNumber;
        }
    }

    return 11;
}

function normalizeHeaderLabel(value) {
    return value
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function getWorkbookSchema(sheet) {
    const headerRowNumber = findHeaderRow(sheet);
    const headerRow = sheet.getRow(headerRowNumber);
    const headers = [];

    for (let column = 1; column <= Math.max(headerRow.cellCount, 20); column += 1) {
        headers.push({
            column,
            label: normalizeHeaderLabel(textValue(headerRow.getCell(column)))
        });
    }

    const departmentColumn = headers.find(item => item.label.includes("отдел"))?.column || 1;
    const fullNameColumn = headers.find(item => item.label.includes("фио"))?.column || 2;
    const positionColumn = headers.find(item => item.label.includes("долж"))?.column || null;
    const totalVacationDaysColumn = headers.find(item => item.label.includes("итого"))?.column || 12;
    const firstVacationColumn = Math.max(positionColumn || 0, fullNameColumn) + 1;
    const vacationColumns = headers
        .filter(item => item.column >= firstVacationColumn && item.column < totalVacationDaysColumn && item.label)
        .map(item => item.column);

    const vacationGroups = [];

    for (let index = 0; index < vacationColumns.length; index += 3) {
        const columns = vacationColumns.slice(index, index + 3);
        if (columns.length < 3) {
            continue;
        }

        const groupHeaders = columns.map(column => ({
            column,
            label: normalizeHeaderLabel(textValue(headerRow.getCell(column)))
        }));

        vacationGroups.push({
            startColumn: groupHeaders.find(item => item.label.includes("нач"))?.column || columns[0],
            endColumn: groupHeaders.find(item => item.label.includes("оконч"))?.column || columns[1],
            daysColumn: groupHeaders.find(item => item.label.includes("дн") || item.label.includes("кол"))?.column || columns[2]
        });
    }

    return {
        dataStartRow: headerRowNumber + 2,
        departmentColumn,
        fullNameColumn,
        positionColumn,
        totalVacationDaysColumn,
        vacationGroups
    };
}

function buildMonthOptions(startDate, endDate) {
    const start = startOfMonth(startDate);
    const finish = startOfMonth(endDate);
    const result = [];
    let cursor = start;

    while (cursor <= finish) {
        result.push({
            key: monthKey(cursor),
            year: cursor.getUTCFullYear(),
            month: cursor.getUTCMonth() + 1
        });
        cursor = addMonths(cursor, 1);
    }

    return result;
}

function decodeLatin1AsUtf8(value) {
    return Buffer.from(value, "latin1").toString("utf8");
}

function normalizeSourceFileName(value) {
    if (!value) {
        return "";
    }

    const decoded = decodeLatin1AsUtf8(value);

    if (/[А-Яа-яЁё]/.test(decoded) && /[ÐÑ]/.test(value)) {
        return decoded;
    }

    return value;
}

function createEmptyVacations() {
    return {
        sourceFileName: "",
        importedAt: "",
        employees: [],
        departments: [],
        monthOptions: []
    };
}

function normalizeVacationsData(vacations) {
    if (!vacations || !Array.isArray(vacations.employees)) {
        return vacations;
    }

    vacations.employees = vacations.employees.map(employee => ({
        ...employee,
        id: buildEmployeeId(employee.department || "", employee.fullName || ""),
        position: employee.position || ""
    }));

    return vacations;
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

async function syncSettingsWithVacations(settings, vacations) {
    const employees = vacations?.employees || [];
    const validIds = new Set(employees.map(employee => employee.id));
    const nextAssignments = {};

    Object.entries(settings.userAssignments || {}).forEach(([employeeId, roleKey]) => {
        if (validIds.has(employeeId)) {
            nextAssignments[employeeId] = roleKey;
        }
    });

    employees.forEach(employee => {
        if (!nextAssignments[employee.id]) {
            const inferredRoleKey = inferRoleKeyByPosition(settings.roles || [], employee.position);
            if (inferredRoleKey) {
                nextAssignments[employee.id] = inferredRoleKey;
            }
        }
    });

    const changed = JSON.stringify(nextAssignments) !== JSON.stringify(settings.userAssignments || {});
    if (changed) {
        settings.userAssignments = nextAssignments;
        settings.updatedAt = new Date().toISOString();
        await writeJson(SETTINGS_PATH, settings);
    }

    return settings;
}

async function parseVacationWorkbook(buffer, sourceFileName) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    const schema = getWorkbookSchema(sheet);
    const employees = [];

    for (let rowNumber = schema.dataStartRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const department = textValue(row.getCell(schema.departmentColumn));
        const fullName = textValue(row.getCell(schema.fullNameColumn));
        const position = schema.positionColumn ? textValue(row.getCell(schema.positionColumn)) : "";

        if (!department && !fullName) {
            continue;
        }

        const vacations = [];

        for (const group of schema.vacationGroups) {
            const start = dateValue(row.getCell(group.startColumn));
            const end = dateValue(row.getCell(group.endColumn));
            const days = numberValue(row.getCell(group.daysColumn));

            if (!start || !end || !days) {
                continue;
            }

            vacations.push({
                start: toIsoDate(start),
                end: toIsoDate(end),
                days
            });
        }

        employees.push({
            id: buildEmployeeId(department, fullName),
            department,
            fullName,
            position,
            totalVacationDays: numberValue(row.getCell(schema.totalVacationDaysColumn)),
            vacations
        });
    }

    const allDates = employees
        .flatMap(employee => employee.vacations.flatMap(period => [parseMonthKey(period.start.slice(0, 7)), parseMonthKey(period.end.slice(0, 7))]))
        .filter(Boolean)
        .sort((left, right) => left - right);

    const rangeStart = allDates[0] || new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const rangeEnd = allDates[allDates.length - 1] || endOfMonth(rangeStart);
    const departments = [...new Set(employees.map(item => item.department))].sort((left, right) => left.localeCompare(right, "ru"));

    return {
        sourceFileName: normalizeSourceFileName(sourceFileName),
        importedAt: new Date().toISOString(),
        employees: normalizeVacationsData({ employees }).employees,
        departments,
        monthOptions: buildMonthOptions(rangeStart, rangeEnd)
    };
}

function buildRoleConfig(roleKey, summaryLabel, detailTotalLabel, baseRow, headerRow, dataRow, summarySheet, tasksSheet) {
    return {
        key: roleKey,
        name: textValue(summarySheet.getCell(`G${baseRow}`)),
        summaryLabel,
        detailTotalLabel,
        sprintHours: numberValue(tasksSheet.getCell(`B${dataRow}`)),
        primaryLabel: textValue(tasksSheet.getCell(`C${headerRow}`)),
        primaryHours: numberValue(tasksSheet.getCell(`C${dataRow}`)),
        primaryDescription: textValue(tasksSheet.getCell(`D${dataRow}`)),
        secondaryLabel: textValue(tasksSheet.getCell(`E${headerRow}`)),
        secondaryHours: numberValue(tasksSheet.getCell(`E${dataRow}`)),
        secondaryDescription: textValue(tasksSheet.getCell(`F${dataRow}`)),
        extraLabel: textValue(tasksSheet.getCell(`G${headerRow}`)),
        extraHours: numberValue(tasksSheet.getCell(`G${dataRow}`)),
        extraDescription: textValue(tasksSheet.getCell(`H${dataRow}`))
    };
}

function buildDefaultCalendarApiConfig() {
    return {
        enabled: true,
        resourceName: "production_calendar_api",
        displayName: "isdayoff.ru",
        baseUrl: "https://isdayoff.ru",
        endpointPath: "/api/getdata",
        method: "GET",
        queryFromParam: "date1",
        queryToParam: "date2",
        queryDelimiterParam: "delimeter",
        queryDelimiterValue: "\n",
        successWorkdayValue: "0",
        authType: "none",
        apiKey: "",
        apiKeyParamName: "X-Api-Key",
        country: "RU",
        timeoutMs: 10000,
        fallbackMode: "weekends",
        notes: "Источник производственного календаря для расчёта рабочих дней."
    };
}

function buildDefaultMiscConfig() {
    return {
        reportGroupingMode: "grouped",
        sprintDurationDays: 7,
        sprintStartDay: "monday"
    };
}

function getDefaultRoleGroupDefinitions(summarySheet, detailSheet) {
    return [
        {
            key: "analysts",
            name: textValue(summarySheet.getCell("A16")) || "Аналитики",
            summaryLabel: textValue(summarySheet.getCell("A16")) || "Аналитики",
            detailTotalLabel: textValue(detailSheet.getCell("A8")) || "Итого Аналитики"
        },
        {
            key: "development",
            name: textValue(summarySheet.getCell("A17")) || "Разработка",
            summaryLabel: textValue(summarySheet.getCell("A17")) || "Разработка",
            detailTotalLabel: textValue(detailSheet.getCell("A13")) || "Итого Разработчики"
        },
        {
            key: "testing",
            name: textValue(summarySheet.getCell("A18")) || "Тестирование",
            summaryLabel: textValue(summarySheet.getCell("A18")) || "Тестирование",
            detailTotalLabel: textValue(detailSheet.getCell("A18")) || "Итого Тестировщики"
        }
    ];
}

function inferDefaultRoleGroupKey(role) {
    const normalized = normalizeComparable(role?.name || "");

    if (normalized.includes("аналит")) {
        return "analysts";
    }

    if (normalized.includes("тест")) {
        return "testing";
    }

    return "development";
}

function buildDefaultRoleGroups(roles, summarySheet, detailSheet) {
    const groups = getDefaultRoleGroupDefinitions(summarySheet, detailSheet).map(group => ({
        ...group,
        roleKeys: []
    }));

    roles.forEach(role => {
        const group = groups.find(item => item.key === inferDefaultRoleGroupKey(role)) || groups[1];
        group.roleKeys.push(role.key);
    });

    return groups;
}

function normalizeDistributionConfig(distribution, fallback = {}) {
    const nextDistribution = {
        total: Number(distribution?.total ?? fallback?.total) || 0,
        business: Number(distribution?.business ?? fallback?.business) || 0,
        keyTasks: Number(distribution?.keyTasks ?? fallback?.keyTasks) || 0,
        support: Number(distribution?.support ?? fallback?.support) || 0,
        internal: Number(distribution?.internal ?? fallback?.internal) || 0,
        architecture: Number(distribution?.architecture ?? fallback?.architecture) || 0,
        other: Number(distribution?.other ?? fallback?.other) || 0
    };

    nextDistribution.keyTasks = Number(nextDistribution.keyTasks) || 0;
    nextDistribution.support = Number(nextDistribution.support) || 0;
    nextDistribution.architecture = Number(nextDistribution.architecture) || 0;
    nextDistribution.other = Number(nextDistribution.other) || 0;
    nextDistribution.business = nextDistribution.keyTasks + nextDistribution.support;
    nextDistribution.internal = nextDistribution.architecture + nextDistribution.other;
    nextDistribution.total = nextDistribution.business + nextDistribution.internal;

    return nextDistribution;
}

function buildDefaultTeams(roleGroups, distribution) {
    return [
        {
            key: "team_primary",
            name: "Команда 1",
            groupKeys: (roleGroups || []).map(group => group.key),
            members: [],
            distribution: normalizeDistributionConfig(distribution)
        }
    ];
}

function normalizeTeamMembers(members) {
    if (!Array.isArray(members)) {
        return [];
    }

    return members
        .map(member => ({
            department: String(member?.department || "").trim(),
            position: String(member?.position || "").trim(),
            fullName: String(member?.fullName || member?.name || "").trim(),
            participationPercent: Math.min(
                100,
                Math.max(0, Number.parseInt(member?.participationPercent, 10) || 100)
            )
        }))
        .filter(member => member.department || member.position || member.fullName);
}

function normalizeRoleGroups(roleGroups, roles, defaults) {
    const validRoleKeys = new Set((roles || []).map(role => role.key));
    const assignedRoleKeys = new Set();
    const baseGroups = (Array.isArray(defaults) && defaults.length ? defaults : []).map(group => ({
        key: group.key,
        name: group.name,
        summaryLabel: group.summaryLabel || group.name,
        detailTotalLabel: group.detailTotalLabel || (group.name ? `Итого ${group.name}` : "Итого"),
        roleKeys: []
    }));
    const currentGroups = Array.isArray(roleGroups) && roleGroups.length ? roleGroups : baseGroups;

    const normalizedGroups = currentGroups.map((group, index) => {
        const defaultGroup = baseGroups.find(item => item.key === group.key) || baseGroups[index] || {};
        const nextRoleKeys = [];

        (group.roleKeys || []).forEach(roleKey => {
            if (!validRoleKeys.has(roleKey) || assignedRoleKeys.has(roleKey)) {
                return;
            }

            assignedRoleKeys.add(roleKey);
            nextRoleKeys.push(roleKey);
        });

        return {
            key: group.key || defaultGroup.key || `group_${index + 1}`,
            name: group.name || defaultGroup.name || `Группа ${index + 1}`,
            summaryLabel: group.summaryLabel || group.name || defaultGroup.summaryLabel || defaultGroup.name || `Группа ${index + 1}`,
            detailTotalLabel: group.detailTotalLabel || defaultGroup.detailTotalLabel || `Итого ${group.summaryLabel || group.name || defaultGroup.summaryLabel || defaultGroup.name || `Группа ${index + 1}`}`,
            roleKeys: nextRoleKeys
        };
    });

    (roles || []).forEach(role => {
        if (assignedRoleKeys.has(role.key)) {
            return;
        }

        const targetGroupKey = inferDefaultRoleGroupKey(role);
        const targetGroup = normalizedGroups.find(group => group.key === targetGroupKey) || normalizedGroups[0];

        if (targetGroup) {
            targetGroup.roleKeys.push(role.key);
            assignedRoleKeys.add(role.key);
        }
    });

    return normalizedGroups;
}

function normalizeTeams(teams, roleGroups, defaults, fallbackDistribution) {
    const validGroupKeys = new Set((roleGroups || []).map(group => group.key));
    const assignedGroupKeys = new Set();
    const baseTeams = (Array.isArray(defaults) && defaults.length ? defaults : []).map((team, index) => ({
        key: team.key || `team_${index + 1}`,
        name: team.name || `Команда ${index + 1}`,
        groupKeys: [],
        members: normalizeTeamMembers(team.members),
        distribution: normalizeDistributionConfig(team.distribution, fallbackDistribution)
    }));
    const currentTeams = Array.isArray(teams) && teams.length ? teams : baseTeams;

    const normalizedTeams = currentTeams.map((team, index) => {
        const fallback = baseTeams[index] || baseTeams[0] || { key: `team_${index + 1}`, name: `Команда ${index + 1}` };
        const groupKeys = [];

        (team.groupKeys || []).forEach(groupKey => {
            if (!validGroupKeys.has(groupKey) || assignedGroupKeys.has(groupKey)) {
                return;
            }

            assignedGroupKeys.add(groupKey);
            groupKeys.push(groupKey);
        });

        return {
            key: team.key || fallback.key,
            name: team.name || fallback.name,
            groupKeys,
            members: normalizeTeamMembers(team.members),
            distribution: normalizeDistributionConfig(team.distribution, fallback.distribution || fallbackDistribution)
        };
    });

    (roleGroups || []).forEach(group => {
        if (assignedGroupKeys.has(group.key)) {
            return;
        }

        const targetTeam = normalizedTeams[0] || { key: "team_primary", name: "Команда 1", groupKeys: [] };
        if (!normalizedTeams.length) {
            normalizedTeams.push(targetTeam);
        }
        targetTeam.groupKeys.push(group.key);
        assignedGroupKeys.add(group.key);
    });

    return normalizedTeams;
}

async function buildDefaultSettings() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(TEMPLATE_PATH);

    const summarySheet = workbook.getWorksheet("Сводный ресурсный план");
    const detailSheet = workbook.getWorksheet("Детальный ресурсный план ");
    const tasksSheet = workbook.getWorksheet("Типовые задачи");
    const defaultDistribution = normalizeDistributionConfig({
        total: numberValue(summarySheet.getCell("C5")),
        business: numberValue(summarySheet.getCell("C6")),
        keyTasks: numberValue(summarySheet.getCell("C7")),
        support: numberValue(summarySheet.getCell("C8")),
        internal: numberValue(summarySheet.getCell("C9")),
        architecture: numberValue(summarySheet.getCell("C10")),
        other: numberValue(summarySheet.getCell("C11"))
    });
    const defaultRoles = [
        buildRoleConfig("analyst", textValue(summarySheet.getCell("A16")), textValue(detailSheet.getCell("A8")), 7, 4, 5, summarySheet, tasksSheet),
        buildRoleConfig("developer", textValue(summarySheet.getCell("A17")), textValue(detailSheet.getCell("A13")), 8, 7, 8, summarySheet, tasksSheet),
        buildRoleConfig("tester", textValue(summarySheet.getCell("A18")), textValue(detailSheet.getCell("A18")), 9, 10, 11, summarySheet, tasksSheet)
    ];
    const defaultRoleGroups = buildDefaultRoleGroups(defaultRoles, summarySheet, detailSheet);

    return {
        updatedAt: new Date().toISOString(),
        calendarApi: buildDefaultCalendarApiConfig(),
        misc: buildDefaultMiscConfig(),
        distribution: defaultDistribution,
        roles: defaultRoles,
        roleGroups: defaultRoleGroups,
        teams: buildDefaultTeams(defaultRoleGroups, defaultDistribution),
        userAssignments: {}
    };
}

async function ensureSettings() {
    const current = await readJson(SETTINGS_PATH, null);
    if (current) {
        const defaults = await buildDefaultSettings();
        const merged = {
            ...defaults,
            ...current,
            calendarApi: {
                ...defaults.calendarApi,
                ...(current.calendarApi || {})
            },
            misc: {
                ...defaults.misc,
                ...(current.misc || {})
            }
        };
        merged.roleGroups = normalizeRoleGroups(current.roleGroups, merged.roles, defaults.roleGroups);
        merged.teams = normalizeTeams(current.teams, merged.roleGroups, defaults.teams, merged.distribution);

        if (JSON.stringify(merged) !== JSON.stringify(current)) {
            await writeJson(SETTINGS_PATH, merged);
        }

        return merged;
    }

    const defaults = await buildDefaultSettings();
    await writeJson(SETTINGS_PATH, defaults);
    return defaults;
}

async function ensureVacations() {
    const current = await readJson(VACATIONS_PATH, null);
    if (current) {
        const normalizedName = normalizeSourceFileName(current.sourceFileName);
        const before = JSON.stringify(current);
        current.sourceFileName = normalizedName;
        normalizeVacationsData(current);
        if (JSON.stringify(current) !== before) {
            current.sourceFileName = normalizedName;
            await writeJson(VACATIONS_PATH, current);
        }
        return current;
    }

    try {
        const buffer = await fs.readFile(DEFAULT_VACATIONS_SOURCE);
        const defaults = await parseVacationWorkbook(buffer, path.basename(DEFAULT_VACATIONS_SOURCE));
        await writeJson(VACATIONS_PATH, defaults);
        return defaults;
    } catch (error) {
        if (error.code === "ENOENT") {
            const empty = createEmptyVacations();
            await writeJson(VACATIONS_PATH, empty);
            return empty;
        }

        throw error;
    }
}

async function loadState() {
    const [settings, vacations] = await Promise.all([ensureSettings(), ensureVacations()]);
    await syncSettingsWithVacations(settings, vacations);
    return { settings, vacations };
}

module.exports = {
    createEmptyVacations,
    ensureSettings,
    ensureVacations,
    loadState,
    parseVacationWorkbook
};
