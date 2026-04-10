"use strict";

const path = require("node:path");
const express = require("express");
const multer = require("multer");
const { createEmptyVacations, ensureSettings, ensureVacations, loadState, parseVacationWorkbook } = require("./services/bootstrap");
const { SETTINGS_PATH, VACATIONS_PATH, writeJson } = require("./services/storage");
const { fetchYearWorkdayMap } = require("./services/calendar");
const { buildPlan } = require("./services/plan");
const { exportWorkbook } = require("./services/export");
const { endOfMonth, enumerateDays, startOfMonth, toIsoDate } = require("./utils/date");

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
const PORT = process.env.PORT || 3000;

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

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/bootstrap", async (request, response, next) => {
    try {
        const state = await loadState();
        response.json(state);
    } catch (error) {
        next(error);
    }
});

app.post("/api/upload-vacations", upload.single("file"), async (request, response, next) => {
    try {
        if (!request.file) {
            response.status(400).json({ error: "Файл не получен." });
            return;
        }

        const vacations = await parseVacationWorkbook(request.file.buffer, request.file.originalname);
        const settings = await ensureSettings();
        const nextAssignments = { ...settings.userAssignments };

        Object.keys(nextAssignments).forEach(key => {
            if (!vacations.employees.some(employee => employee.id === key)) {
                delete nextAssignments[key];
            }
        });

        vacations.employees.forEach(employee => {
            const inferredRoleKey = inferRoleKeyByPosition(settings.roles || [], employee.position);
            if (inferredRoleKey) {
                nextAssignments[employee.id] = inferredRoleKey;
            }
        });

        settings.userAssignments = nextAssignments;
        settings.updatedAt = new Date().toISOString();

        await Promise.all([
            writeJson(VACATIONS_PATH, vacations),
            writeJson(SETTINGS_PATH, settings)
        ]);

        response.json({ vacations, settings });
    } catch (error) {
        next(error);
    }
});

app.put("/api/settings", async (request, response, next) => {
    try {
        const settings = request.body;
        settings.updatedAt = new Date().toISOString();
        await writeJson(SETTINGS_PATH, settings);
        response.json(settings);
    } catch (error) {
        next(error);
    }
});

app.post("/api/reset-workflow", async (request, response, next) => {
    try {
        const settings = await ensureSettings();
        const vacations = createEmptyVacations();
        await writeJson(VACATIONS_PATH, vacations);
        response.json({ settings, vacations });
    } catch (error) {
        next(error);
    }
});

app.get("/api/calendar/month-workdays", async (request, response) => {
    try {
        const year = Number(request.query.year);
        if (!Number.isInteger(year)) {
            response.status(400).json({ error: "Некорректный год." });
            return;
        }

        const { settings } = await loadState();
        const workdayMap = await fetchYearWorkdayMap(year, settings.calendarApi);
        const months = [];

        for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
            const monthStart = startOfMonth(new Date(Date.UTC(year, monthIndex, 1)));
            const monthEnd = endOfMonth(monthStart);
            let workingDays = 0;

            for (const cursor of enumerateDays(monthStart, monthEnd)) {
                if (workdayMap.get(toIsoDate(cursor))) {
                    workingDays += 1;
                }
            }

            months.push({
                key: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
                workingDays
            });
        }

        response.json({ year, months });
    } catch (error) {
        response.status(400).json({ error: error.message || "Не удалось получить рабочие дни." });
    }
});

app.post("/api/analyze", async (request, response) => {
    try {
        const { settings, vacations } = await loadState();
        const plan = await buildPlan(vacations, settings, request.body || {});

        response.json({
            ...plan,
            settings
        });
    } catch (error) {
        response.status(400).json({ error: error.message || "Не удалось выполнить анализ." });
    }
});

app.post("/api/team-members/save", async (request, response) => {
    try {
        const { settings, vacations } = await loadState();
        const teamKey = String(request.body?.teamKey || "").trim();
        const employeeIds = Array.isArray(request.body?.employeeIds) ? request.body.employeeIds.map(String) : [];
        const requestMembers = Array.isArray(request.body?.members) ? request.body.members : [];

        if (!teamKey) {
            response.status(400).json({ error: "Не выбрана команда для сохранения состава." });
            return;
        }

        const team = (settings.teams || []).find(item => item.key === teamKey);
        if (!team) {
            response.status(404).json({ error: "Команда не найдена." });
            return;
        }

        const employeeMap = new Map((vacations.employees || []).map(employee => [employee.id, employee]));
        const normalizedMembers = requestMembers.length
            ? requestMembers
                .filter(member => member && (member.department || member.position || member.fullName))
                .map(member => ({
                    department: String(member.department || "").trim(),
                    position: String(member.position || "").trim(),
                    role: String(member.role || member.position || "").trim(),
                    fullName: String(member.fullName || "").trim(),
                    participationPercent: Math.min(100, Math.max(0, Number.parseInt(member.participationPercent, 10) || 100))
                }))
            : employeeIds
                .map(id => employeeMap.get(id))
                .filter(Boolean)
                .map(employee => ({
                    department: employee.department,
                    position: employee.position,
                    role: employee.position,
                    fullName: employee.fullName,
                    participationPercent: 100
                }));

        team.members = normalizedMembers;

        settings.updatedAt = new Date().toISOString();
        await writeJson(SETTINGS_PATH, settings);
        response.json({ settings, team });
    } catch (error) {
        response.status(400).json({ error: error.message || "Не удалось сохранить состав команды." });
    }
});

app.post("/api/team-members/clear", async (request, response) => {
    try {
        const { settings } = await loadState();
        const teamKey = String(request.body?.teamKey || "").trim();

        if (!teamKey) {
            response.status(400).json({ error: "Не выбрана команда для очистки состава." });
            return;
        }

        const team = (settings.teams || []).find(item => item.key === teamKey);
        if (!team) {
            response.status(404).json({ error: "Команда не найдена." });
            return;
        }

        team.members = [];
        settings.updatedAt = new Date().toISOString();
        await writeJson(SETTINGS_PATH, settings);
        response.json({ settings, team });
    } catch (error) {
        response.status(400).json({ error: error.message || "Не удалось очистить состав команды." });
    }
});

app.post("/api/team-members/refresh", async (request, response) => {
    try {
        const { settings, vacations } = await loadState();
        const teamKey = String(request.body?.teamKey || "").trim();

        if (!teamKey) {
            response.status(400).json({ error: "Не выбрана команда для обновления состава." });
            return;
        }

        const team = (settings.teams || []).find(item => item.key === teamKey);
        if (!team) {
            response.status(404).json({ error: "Команда не найдена." });
            return;
        }

        const employees = Array.isArray(vacations?.employees) ? vacations.employees : [];
        const normalize = value => normalizeComparable(value);

        team.members = (team.members || []).map(member => {
            const exactMatch = employees.find(employee => (
                normalize(employee.department) === normalize(member.department)
                && normalize(employee.fullName) === normalize(member.fullName)
            ));

            const sameNameEmployees = employees.filter(employee => normalize(employee.fullName) === normalize(member.fullName));
            const fallbackByName = sameNameEmployees.length === 1 ? sameNameEmployees[0] : null;
            const matchedEmployee = exactMatch || fallbackByName;

            if (!matchedEmployee) {
                return member;
            }

            return {
                department: matchedEmployee.department,
                position: matchedEmployee.position,
                role: String(member.role || matchedEmployee.position || "").trim(),
                fullName: matchedEmployee.fullName,
                participationPercent: Math.min(100, Math.max(0, Number.parseInt(member.participationPercent, 10) || 100))
            };
        });

        settings.updatedAt = new Date().toISOString();
        await writeJson(SETTINGS_PATH, settings);
        response.json({ settings, team });
    } catch (error) {
        response.status(400).json({ error: error.message || "Не удалось обновить состав команды." });
    }
});

app.post("/api/export", async (request, response) => {
    try {
        const { settings, vacations } = await loadState();
        const plan = await buildPlan(vacations, settings, request.body || {});
        const fileBuffer = await exportWorkbook(settings, plan);
        const safeLabel = plan.periodLabel.toLowerCase().replace(/\s+/g, "_");

        response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`resource_plan_${safeLabel}.xlsx`)}`);
        response.send(Buffer.from(fileBuffer));
    } catch (error) {
        response.status(400).json({ error: error.message || "Не удалось сформировать файл." });
    }
});

app.use((error, request, response, next) => {
    console.error(error);
    response.status(500).json({ error: "Внутренняя ошибка сервера." });
});

async function start() {
    await ensureSettings();
    await ensureVacations();
    app.listen(PORT, () => {
        console.log(`Resource planner started on http://localhost:${PORT}`);
    });
}

start().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
