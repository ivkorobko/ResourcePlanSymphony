"use strict";

const MONTH_NAMES = [
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь"
];

function pad(value) {
    return String(value).padStart(2, "0");
}

function cloneDate(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function excelSerialToDate(serial) {
    const utcDays = Math.floor(serial - 25569);
    const utcValue = utcDays * 86400;
    const info = new Date(utcValue * 1000);
    return new Date(Date.UTC(info.getUTCFullYear(), info.getUTCMonth(), info.getUTCDate()));
}

function toDate(value) {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return cloneDate(value);
    }

    if (typeof value === "number") {
        return excelSerialToDate(value);
    }

    if (typeof value === "string") {
        const direct = new Date(value);
        if (!Number.isNaN(direct.getTime())) {
            return cloneDate(direct);
        }
    }

    return null;
}

function toIsoDate(date) {
    if (!date) {
        return "";
    }

    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function monthKey(date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

function parseMonthKey(value) {
    const [year, month] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, 1));
}

function startOfMonth(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addMonths(date, count) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function startOfIsoWeek(date) {
    const result = cloneDate(date);
    const day = result.getUTCDay() || 7;
    result.setUTCDate(result.getUTCDate() - day + 1);
    return result;
}

function endOfIsoWeek(date) {
    const result = startOfIsoWeek(date);
    result.setUTCDate(result.getUTCDate() + 6);
    return result;
}

function getIsoWeek(date) {
    const target = cloneDate(date);
    const dayNumber = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
}

function enumerateDays(start, end) {
    const days = [];
    const current = cloneDate(start);

    while (current <= end) {
        days.push(cloneDate(current));
        current.setUTCDate(current.getUTCDate() + 1);
    }

    return days;
}

function formatShortRange(start, end) {
    return `${pad(start.getUTCDate())}.${pad(start.getUTCMonth() + 1)}-${pad(end.getUTCDate())}.${pad(end.getUTCMonth() + 1)}`;
}

function getMonthName(date) {
    return MONTH_NAMES[date.getUTCMonth()];
}

function capitalize(value) {
    return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function listMonthKeysBetween(startMonth, endMonth) {
    const values = [];
    let cursor = startOfMonth(startMonth);
    const limit = startOfMonth(endMonth);

    while (cursor <= limit) {
        values.push(monthKey(cursor));
        cursor = addMonths(cursor, 1);
    }

    return values;
}

module.exports = {
    MONTH_NAMES,
    addMonths,
    capitalize,
    cloneDate,
    endOfIsoWeek,
    endOfMonth,
    enumerateDays,
    excelSerialToDate,
    formatShortRange,
    getIsoWeek,
    getMonthName,
    listMonthKeysBetween,
    monthKey,
    pad,
    parseMonthKey,
    startOfIsoWeek,
    startOfMonth,
    toDate,
    toIsoDate
};
