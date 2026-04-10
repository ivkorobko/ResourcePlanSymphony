"use strict";

const { endOfMonth, enumerateDays, startOfMonth, toIsoDate } = require("../utils/date");

function buildWeekendFallback(start, end) {
    const result = new Map();

    for (const date of enumerateDays(start, end)) {
        const dayOfWeek = date.getUTCDay();
        result.set(toIsoDate(date), dayOfWeek !== 0 && dayOfWeek !== 6);
    }

    return result;
}

function buildCalendarUrl(config, date1, date2) {
    const url = new URL(config.endpointPath || "/api/getdata", config.baseUrl || "https://isdayoff.ru");
    url.searchParams.set(config.queryFromParam || "date1", date1);
    url.searchParams.set(config.queryToParam || "date2", date2);

    if (config.queryDelimiterParam) {
        url.searchParams.set(config.queryDelimiterParam, config.queryDelimiterValue ?? "\n");
    }

    if (config.authType === "query" && config.apiKey && config.apiKeyParamName) {
        url.searchParams.set(config.apiKeyParamName, config.apiKey);
    }

    if (config.country) {
        url.searchParams.set("cc", String(config.country).toLowerCase());
    }

    return url;
}

function buildCalendarYearUrl(config, year) {
    const url = new URL(config.endpointPath || "/api/getdata", config.baseUrl || "https://isdayoff.ru");
    url.searchParams.set("year", String(year));

    if (config.queryDelimiterParam) {
        url.searchParams.set(config.queryDelimiterParam, config.queryDelimiterValue ?? "\n");
    }

    if (config.authType === "query" && config.apiKey && config.apiKeyParamName) {
        url.searchParams.set(config.apiKeyParamName, config.apiKey);
    }

    if (config.country) {
        url.searchParams.set("cc", String(config.country).toLowerCase());
    }

    return url;
}

function buildCalendarConfig(calendarApi = {}) {
    return {
        enabled: true,
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
        timeoutMs: 10000,
        country: "RU",
        ...calendarApi
    };
}

function buildRequestHeaders(config) {
    const headers = {};

    if (config.authType === "header" && config.apiKey && config.apiKeyParamName) {
        headers[config.apiKeyParamName] = config.apiKey;
    }

    return headers;
}

function parseCalendarResponseValues(responseText) {
    const normalized = String(responseText || "").replace(/\r/g, "").trim();

    if (!normalized) {
        return [];
    }

    const splitByWhitespace = normalized.split(/\s+/).filter(Boolean);
    if (splitByWhitespace.length > 1) {
        return splitByWhitespace;
    }

    return normalized.split("");
}

function isWorkingValue(value, config) {
    const normalized = String(value ?? "");
    const workingValues = new Set([
        String(config.successWorkdayValue ?? "0"),
        "2",
        "4"
    ]);

    return workingValues.has(normalized);
}

async function fetchWorkdayMap(start, end, calendarApi = {}) {
    const fallback = buildWeekendFallback(start, end);
    const years = [];

    for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
        years.push(year);
    }

    try {
        const yearMaps = await Promise.all(years.map(year => fetchYearWorkdayMap(year, calendarApi)));
        const result = new Map();

        enumerateDays(start, end).forEach(date => {
            const iso = toIsoDate(date);
            const yearIndex = date.getUTCFullYear() - years[0];
            result.set(iso, yearMaps[yearIndex]?.get(iso) ?? fallback.get(iso) ?? false);
        });

        return result;
    } catch (error) {
        return fallback;
    }
}

async function fetchYearWorkdayMap(year, calendarApi = {}) {
    const rangeStart = startOfMonth(new Date(Date.UTC(year, 0, 1)));
    const rangeEnd = endOfMonth(new Date(Date.UTC(year, 11, 1)));
    const fallback = buildWeekendFallback(rangeStart, rangeEnd);
    const config = buildCalendarConfig(calendarApi);

    if (!config.enabled) {
        return fallback;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), Number(config.timeoutMs) || 10000);
        const response = await fetch(buildCalendarYearUrl(config, year), {
            method: config.method || "GET",
            headers: buildRequestHeaders(config),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            return fallback;
        }

        const lines = parseCalendarResponseValues(await response.text());
        const dates = enumerateDays(rangeStart, rangeEnd);

        if (lines.length !== dates.length) {
            return fallback;
        }

        const result = new Map();
        dates.forEach((date, index) => {
            result.set(toIsoDate(date), isWorkingValue(lines[index], config));
        });

        return result;
    } catch (error) {
        return fallback;
    }
}

module.exports = {
    fetchWorkdayMap,
    fetchYearWorkdayMap
};
