"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPlan } = require("../src/services/plan");

function createBaseSettings(overrides = {}) {
    const settings = {
        calendarApi: {
            enabled: false
        },
        misc: {
            reportGroupingMode: "grouped"
        },
        userAssignments: {},
        roles: [
            {
                key: "analyst",
                name: "Аналитик",
                summaryLabel: "Аналитики",
                detailTotalLabel: "Итого Аналитики",
                sprintHours: 35,
                primaryHours: 15,
                secondaryHours: 10
            },
            {
                key: "lead_analyst",
                name: "Руководитель аналитиков",
                summaryLabel: "Руководитель аналитиков",
                detailTotalLabel: "Итого Руководитель аналитиков",
                sprintHours: 35,
                primaryHours: 20,
                secondaryHours: 5
            },
            {
                key: "developer",
                name: "Разработчик",
                summaryLabel: "Разработчики",
                detailTotalLabel: "Итого Разработчики",
                sprintHours: 35,
                primaryHours: 25,
                secondaryHours: 5
            },
            {
                key: "lead_developer",
                name: "Руководитель разработки",
                summaryLabel: "Руководитель разработки",
                detailTotalLabel: "Итого Руководитель разработки",
                sprintHours: 35,
                primaryHours: 15,
                secondaryHours: 5
            },
            {
                key: "tester",
                name: "Тестировщик",
                summaryLabel: "Тестировщики",
                detailTotalLabel: "Итого Тестировщики",
                sprintHours: 35,
                primaryHours: 25,
                secondaryHours: 5
            }
        ],
        roleGroups: [
            {
                key: "analysts",
                name: "Аналитики",
                summaryLabel: "Аналитики",
                detailTotalLabel: "Итого Аналитики",
                roleKeys: ["analyst", "lead_analyst"]
            },
            {
                key: "development",
                name: "Разработка",
                summaryLabel: "Разработка",
                detailTotalLabel: "Итого Разработчики",
                roleKeys: ["developer", "lead_developer"]
            },
            {
                key: "testing",
                name: "Тестирование",
                summaryLabel: "Тестирование",
                detailTotalLabel: "Итого Тестировщики",
                roleKeys: ["tester"]
            }
        ]
    };

    return {
        ...settings,
        ...overrides
    };
}

function createVacations(employees) {
    return {
        employees
    };
}

test("buildPlan группирует сотрудников по группам 1-го уровня и определяет роль по должности из файла", async () => {
    const vacations = createVacations([
        {
            id: "crm::луха",
            department: "CRM",
            fullName: "Луха Олег Валентинович",
            position: "Разработчик",
            vacations: []
        },
        {
            id: "crm::сидоров",
            department: "CRM",
            fullName: "Сидоров Петр",
            position: "Руководитель аналитиков",
            vacations: []
        }
    ]);

    const plan = await buildPlan(vacations, createBaseSettings(), {
        departments: ["CRM"],
        employeeIds: ["crm::луха", "crm::сидоров"],
        months: ["2026-04"]
    });

    assert.equal(plan.reportGroupingMode, "grouped");
    assert.equal(plan.roles.length, 2);
    assert.deepEqual(
        plan.roles.map(role => role.name),
        ["Аналитики", "Разработка"]
    );

    const analysts = plan.roles.find(role => role.key === "analysts");
    const development = plan.roles.find(role => role.key === "development");

    assert.equal(analysts.employeeCount, 1);
    assert.equal(development.employeeCount, 1);
    assert.equal(plan.selectedEmployees[0].department, "CRM");
    assert.equal(plan.selectedEmployees[0].position, "Разработчик");
    assert.equal(plan.selectedEmployees[0].roleKey, "developer");
});

test("buildPlan в режиме без групп 1-го уровня отдаёт отдельные роли в нужном порядке", async () => {
    const vacations = createVacations([
        {
            id: "e1",
            department: "CRM",
            fullName: "Аналитик",
            position: "Аналитик",
            vacations: []
        },
        {
            id: "e2",
            department: "CRM",
            fullName: "Рук Аналитики",
            position: "Руководитель аналитиков",
            vacations: []
        },
        {
            id: "e3",
            department: "CRM",
            fullName: "Тестировщик",
            position: "Тестировщик",
            vacations: []
        },
        {
            id: "e4",
            department: "CRM",
            fullName: "Разработчик",
            position: "Разработчик",
            vacations: []
        },
        {
            id: "e5",
            department: "CRM",
            fullName: "Рук Разработки",
            position: "Руководитель разработки",
            vacations: []
        }
    ]);

    const plan = await buildPlan(vacations, createBaseSettings({
        misc: {
            reportGroupingMode: "ungrouped"
        }
    }), {
        departments: ["CRM"],
        employeeIds: ["e1", "e2", "e3", "e4", "e5"],
        months: ["2026-04"]
    });

    assert.equal(plan.reportGroupingMode, "ungrouped");
    assert.deepEqual(
        plan.roles.map(role => role.name),
        [
            "Аналитик",
            "Руководитель аналитиков",
            "Тестировщик",
            "Разработчик",
            "Руководитель разработки"
        ]
    );
});

test("buildPlan уменьшает часы на неделе с учётом и праздника, и отпуска", async t => {
    const originalFetch = global.fetch;

    t.after(() => {
        global.fetch = originalFetch;
    });

    global.fetch = async () => ({
        ok: true,
        async text() {
            const daysInYear = 365;
            return Array.from({ length: daysInYear }, (_, index) => {
                const date = new Date(Date.UTC(2026, 0, 1));
                date.setUTCDate(date.getUTCDate() + index);
                const dayOfWeek = date.getUTCDay();
                const iso = date.toISOString().slice(0, 10);

                if (dayOfWeek === 0 || dayOfWeek === 6) {
                    return "1";
                }

                if (iso === "2026-01-02") {
                    return "1";
                }

                return "0";
            }).join("\n");
        }
    });

    const vacations = createVacations([
        {
            id: "crm::байдакова",
            department: "CRM",
            fullName: "Байдакова Евгения",
            position: "Аналитик",
            vacations: [
                {
                    start: "2026-01-05",
                    end: "2026-01-05",
                    days: 1
                }
            ]
        }
    ]);

    const plan = await buildPlan(vacations, createBaseSettings({
        calendarApi: {
            enabled: true,
            timeoutMs: 50
        }
    }), {
        departments: ["CRM"],
        employeeIds: ["crm::байдакова"],
        months: ["2026-01"]
    });

    const analystGroup = plan.roles.find(role => role.key === "analysts");
    const employeeRow = analystGroup.rows.find(row => row.id === "crm::байдакова");

    assert.equal(plan.weeks[0].label, "05.01-11.01");
    assert.equal(plan.weeks[0].baselineWorkingDays, 5);
    assert.equal(plan.weeks[0].workingDays, 5);
    assert.equal(employeeRow.weekValues[0].value, 12);
});

test("buildPlan учитывает процент участия сотрудника в составе команды", async () => {
    const vacations = createVacations([
        {
            id: "crm::аналитик-1",
            department: "CRM",
            fullName: "Аналитик 1",
            position: "Аналитик",
            vacations: []
        },
        {
            id: "crm::аналитик-2",
            department: "CRM",
            fullName: "Аналитик 2",
            position: "Аналитик",
            vacations: []
        }
    ]);

    const plan = await buildPlan(vacations, createBaseSettings({
        teams: [
            {
                key: "team_primary",
                name: "Команда 1",
                groupKeys: ["analysts", "development", "testing"],
                members: [
                    {
                        department: "CRM",
                        position: "Аналитик",
                        fullName: "Аналитик 1",
                        participationPercent: 100
                    },
                    {
                        department: "CRM",
                        position: "Аналитик",
                        fullName: "Аналитик 2",
                        participationPercent: 20
                    }
                ]
            }
        ]
    }), {
        teamKey: "team_primary",
        departments: ["CRM"],
        employeeIds: ["crm::аналитик-1", "crm::аналитик-2"],
        months: ["2026-04"]
    });

    const analysts = plan.roles.find(role => role.key === "analysts");
    const analystTwo = analysts.rows.find(row => row.id === "crm::аналитик-2");

    assert.equal(analysts.employeeCount, 1.2);
    assert.equal(analysts.sprintCapacity, 18);
    assert.equal(analystTwo.participationPercent, 20);
    assert.equal(analystTwo.participationFactor, 0.2);
});

test("buildPlan сообщает ошибку, если должность сотрудника не заполнена", async () => {
    const vacations = createVacations([
        {
            id: "crm::иванов",
            department: "CRM",
            fullName: "Иванов Иван",
            position: "",
            vacations: []
        }
    ]);

    await assert.rejects(
        () => buildPlan(vacations, createBaseSettings(), {
            departments: ["CRM"],
            employeeIds: ["crm::иванов"],
            months: ["2026-04"]
        }),
        /не заполнена или не распознана должность/i
    );
});

test("buildPlan не принимает месяцы с пропусками", async () => {
    const vacations = createVacations([
        {
            id: "crm::луха",
            department: "CRM",
            fullName: "Луха Олег Валентинович",
            position: "Разработчик",
            vacations: []
        }
    ]);

    await assert.rejects(
        () => buildPlan(vacations, createBaseSettings(), {
            departments: ["CRM"],
            employeeIds: ["crm::луха"],
            months: ["2026-04", "2026-06"]
        }),
        /месяцы должны идти подряд/i
    );
});
