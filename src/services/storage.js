"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");
const VACATIONS_PATH = path.join(DATA_DIR, "vacations.json");
const TEMPLATE_PATH = path.join(ROOT_DIR, "Ресурсный план.xlsx");
const DEFAULT_VACATIONS_SOURCE = path.join(ROOT_DIR, "График отпусков.xlsx");

async function ensureDataDir() {
    await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === "ENOENT") {
            return fallback;
        }

        throw error;
    }
}

async function writeJson(filePath, value) {
    await ensureDataDir();
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

module.exports = {
    DATA_DIR,
    DEFAULT_VACATIONS_SOURCE,
    ROOT_DIR,
    SETTINGS_PATH,
    TEMPLATE_PATH,
    VACATIONS_PATH,
    ensureDataDir,
    readJson,
    writeJson
};
