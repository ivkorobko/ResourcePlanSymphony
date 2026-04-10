"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { fetchWorkdayMap, fetchYearWorkdayMap } = require("../src/services/calendar");

test("fetchWorkdayMap использует fallback по будням, если API выключено", async () => {
    const map = await fetchWorkdayMap(
        new Date(Date.UTC(2026, 3, 6)),
        new Date(Date.UTC(2026, 3, 12)),
        { enabled: false }
    );

    assert.equal(map.get("2026-04-06"), true);
    assert.equal(map.get("2026-04-10"), true);
    assert.equal(map.get("2026-04-11"), false);
    assert.equal(map.get("2026-04-12"), false);
});

test("fetchWorkdayMap подставляет данные из API, передаёт header auth и считает коды 2/4 рабочими", async (t) => {
    const originalFetch = global.fetch;

    t.after(() => {
        global.fetch = originalFetch;
    });

    global.fetch = async (url, options) => {
        assert.match(String(url), /date1=20260406/);
        assert.match(String(url), /date2=20260408/);
        assert.equal(options.method, "GET");
        assert.equal(options.headers["X-Api-Key"], "secret");

        return {
            ok: true,
            async text() {
                return "0\n2\n4";
            }
        };
    };

    const map = await fetchWorkdayMap(
        new Date(Date.UTC(2026, 3, 6)),
        new Date(Date.UTC(2026, 3, 8)),
        {
            enabled: true,
            authType: "header",
            apiKey: "secret",
            apiKeyParamName: "X-Api-Key",
            timeoutMs: 50
        }
    );

    assert.equal(map.get("2026-04-06"), true);
    assert.equal(map.get("2026-04-07"), true);
    assert.equal(map.get("2026-04-08"), true);
});

test("fetchWorkdayMap возвращает fallback, если API прислал неполный ответ", async (t) => {
    const originalFetch = global.fetch;

    t.after(() => {
        global.fetch = originalFetch;
    });

    global.fetch = async () => ({
        ok: true,
        async text() {
            return "0\n1";
        }
    });

    const map = await fetchWorkdayMap(
        new Date(Date.UTC(2026, 3, 6)),
        new Date(Date.UTC(2026, 3, 8)),
        { enabled: true, timeoutMs: 50 }
    );

    assert.equal(map.get("2026-04-06"), true);
    assert.equal(map.get("2026-04-07"), true);
    assert.equal(map.get("2026-04-08"), true);
});

test("fetchYearWorkdayMap использует годовой endpoint и возвращает полный календарь года", async (t) => {
    const originalFetch = global.fetch;

    t.after(() => {
        global.fetch = originalFetch;
    });

    global.fetch = async url => {
        assert.match(String(url), /\/api\/getdata\?/);
        assert.match(String(url), /year=2025/);
        assert.match(String(url), /delimeter=/);

        const daysInYear = 365;
        return {
            ok: true,
            async text() {
                return Array.from({ length: daysInYear }, (_, index) => {
                    if (index === 0) {
                        return "1";
                    }

                    if (index === 1) {
                        return "0";
                    }

                    return "1";
                }).join("\n");
            }
        };
    };

    const map = await fetchYearWorkdayMap(2025, { enabled: true, timeoutMs: 50 });

    assert.equal(map.get("2025-01-01"), false);
    assert.equal(map.get("2025-01-02"), true);
    assert.equal(map.size, 365);
});
