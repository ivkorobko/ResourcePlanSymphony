"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

const { parseVacationWorkbook } = require("../src/services/bootstrap");

async function buildVacationWorkbookBuffer() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Отпуска");

    sheet.getCell("A1").value = "Отдел";
    sheet.getCell("B1").value = "ФИО";
    sheet.getCell("C1").value = "Должность";
    sheet.getCell("D1").value = "Начало";
    sheet.getCell("E1").value = "Окончание";
    sheet.getCell("F1").value = "Дней";
    sheet.getCell("G1").value = "Итого";

    sheet.getCell("A3").value = "Отдел разработки";
    sheet.getCell("B3").value = "Иванов Иван Иванович";
    sheet.getCell("C3").value = "Разработчик";
    sheet.getCell("D3").value = new Date(Date.UTC(2026, 3, 6));
    sheet.getCell("E3").value = new Date(Date.UTC(2026, 3, 10));
    sheet.getCell("F3").value = 5;
    sheet.getCell("G3").value = 5;

    sheet.getCell("A4").value = "Отдел качества";
    sheet.getCell("B4").value = "Петров Петр Петрович";
    sheet.getCell("C4").value = "Тестировщик";
    sheet.getCell("G4").value = 0;

    return workbook.xlsx.writeBuffer();
}

test("parseVacationWorkbook читает должность и отпуска из нового формата файла", async () => {
    const buffer = await buildVacationWorkbookBuffer();

    const result = await parseVacationWorkbook(buffer, "График отпусков.xlsx");

    assert.equal(result.sourceFileName, "График отпусков.xlsx");
    assert.deepEqual(result.departments, ["Отдел качества", "Отдел разработки"]);
    assert.equal(result.employees.length, 2);

    const developer = result.employees.find(employee => employee.fullName === "Иванов Иван Иванович");
    assert.ok(developer);
    assert.equal(developer.position, "Разработчик");
    assert.equal(developer.id, "отдел-разработки::иванов-иван-иванович");
    assert.deepEqual(developer.vacations, [
        {
            start: "2026-04-06",
            end: "2026-04-10",
            days: 5
        }
    ]);

    assert.deepEqual(result.monthOptions, [
        {
            key: "2026-04",
            year: 2026,
            month: 4
        }
    ]);
});

test("parseVacationWorkbook чинит битое имя исходного файла", async () => {
    const buffer = await buildVacationWorkbookBuffer();
    const brokenFileName = Buffer.from("График отпусков.xlsx", "utf8").toString("latin1");

    const result = await parseVacationWorkbook(buffer, brokenFileName);

    assert.equal(result.sourceFileName, "График отпусков.xlsx");
});
