"use strict";

const ExcelJS = require("exceljs");
const { TEMPLATE_PATH } = require("./storage");

function cloneStyle(style) {
    return JSON.parse(JSON.stringify(style || {}));
}

function clearCell(cell) {
    cell.value = null;
}

function setFormulaValue(cell, formula, result) {
    cell.value = {
        formula,
        result
    };
}

function getSprintLabel(count) {
    const value = Math.abs(Number(count) || 0);
    const mod100 = value % 100;
    const mod10 = value % 10;

    if (mod100 >= 11 && mod100 <= 14) {
        return `${value} спринтов`;
    }

    if (mod10 === 1) {
        return `${value} спринт`;
    }

    if (mod10 >= 2 && mod10 <= 4) {
        return `${value} спринта`;
    }

    return `${value} спринтов`;
}

function createCenteredHeaderStyle(baseStyle) {
    return {
        ...cloneStyle(baseStyle),
        font: {
            ...(baseStyle?.font || {}),
            bold: true
        },
        alignment: {
            ...(baseStyle?.alignment || {}),
            horizontal: "center",
            vertical: "middle"
        },
        border: {
            top: { style: "thin", color: { argb: "FFCCD8E6" } },
            left: { style: "thin", color: { argb: "FFCCD8E6" } },
            bottom: { style: "thin", color: { argb: "FFCCD8E6" } },
            right: { style: "thin", color: { argb: "FFCCD8E6" } }
        }
    };
}

function getDetailNameColumnWidth(plan) {
    const maxLabelLength = plan.roles.reduce((maxValue, role) => {
        const employeeNameMax = role.rows.reduce((employeeMax, employee) => Math.max(employeeMax, String(employee.name || "").length), 0);
        return Math.max(maxValue, employeeNameMax, String(role.detailTotalLabel || "").length);
    }, 0);

    return Math.min(Math.max(maxLabelLength + 4, 28), 48);
}

function copyRowStyles(sheet, templateRow, targetRow, columnCount = 9) {
    sheet.getRow(targetRow).height = sheet.getRow(templateRow).height;

    for (let column = 1; column <= columnCount; column += 1) {
        sheet.getCell(targetRow, column).style = cloneStyle(sheet.getCell(templateRow, column).style);
    }
}

function copyRowTemplate(sheet, templateRow, targetRow, columnCount = 9) {
    sheet.getRow(targetRow).height = sheet.getRow(templateRow).height;

    for (let column = 1; column <= columnCount; column += 1) {
        const sourceCell = sheet.getCell(templateRow, column);
        const targetCell = sheet.getCell(targetRow, column);
        targetCell.style = cloneStyle(sourceCell.style);
        targetCell.value = sourceCell.value;
    }
}

function clearSummaryRange(sheet, fromRow, toRow, columnCount = 9) {
    for (let row = fromRow; row <= toRow; row += 1) {
        for (let column = 1; column <= columnCount; column += 1) {
            clearCell(sheet.getCell(row, column));
        }
    }
}

function clearSummarySeparatorRow(sheet, rowNumber, columnCount = 9) {
    sheet.getRow(rowNumber).height = undefined;

    for (let column = 1; column <= columnCount; column += 1) {
        const cell = sheet.getCell(rowNumber, column);
        clearCell(cell);
        cell.style = {};
    }
}

function buildSummaryLayouts(roleCount, topOffset = 0) {
    const overview = {
        labelRow: 14 + topOffset,
        titleRow: 15 + topOffset,
        dataStartRow: 16 + topOffset,
        totalRow: 16 + topOffset + roleCount
    };

    const months = [];
    let nextHeaderRow = overview.totalRow + 2;

    for (let index = 0; index < 3; index += 1) {
        const layout = {
            labelRow: nextHeaderRow,
            titleRow: nextHeaderRow + 1,
            dataStartRow: nextHeaderRow + 2,
            totalRow: nextHeaderRow + 2 + roleCount
        };

        months.push(layout);
        nextHeaderRow = layout.totalRow + 2;
    }

    const period = {
        labelRow: months[2].totalRow + 2,
        titleRow: months[2].totalRow + 3,
        dataStartRow: months[2].totalRow + 4,
        totalRow: months[2].totalRow + 4 + roleCount
    };

    return { overview, months, period };
}

function getTaskRoleCategories(role) {
    if (Array.isArray(role?.categories) && role.categories.length) {
        const primary = role.categories.find(category => category.key === role.primaryCategoryKey) || role.categories[0];
        const secondary = role.categories.find(category => category.key !== primary?.key) || {};
        const extra = role.categories.find(category => category.key !== primary?.key && category.key !== secondary?.key) || {};

        return {
            primary,
            secondary,
            extra
        };
    }

    return {
        primary: {
            label: role?.primaryLabel || "",
            hours: role?.primaryHours || 0,
            description: role?.primaryDescription || ""
        },
        secondary: {
            label: role?.secondaryLabel || "",
            hours: role?.secondaryHours || 0,
            description: role?.secondaryDescription || ""
        },
        extra: {
            label: role?.extraLabel || "",
            hours: role?.extraHours || 0,
            description: role?.extraDescription || ""
        }
    };
}

function fillTasksSheet(sheet, settings, plan) {
    const allowedRoleKeys = new Set((plan.sourceRoles || []).map(role => role.key));
    const roles = (Array.isArray(settings.roles) ? settings.roles : [])
        .filter(role => allowedRoleKeys.has(role.key));
    const requiredExtraRows = Math.max(0, roles.length * 3 - 10);

    if (requiredExtraRows > 0) {
        sheet.spliceRows(14, 0, ...Array.from({ length: requiredExtraRows }, () => []));
    }

    roles.forEach((role, index) => {
        const headerRow = 4 + index * 3;
        const dataRow = 5 + index * 3;
        const spacerRow = 6 + index * 3;
        const { primary, secondary, extra } = getTaskRoleCategories(role);

        copyRowStyles(sheet, 4, headerRow, 8);
        copyRowStyles(sheet, 5, dataRow, 8);
        copyRowStyles(sheet, 6, spacerRow, 8);

        sheet.getCell(`A${dataRow}`).value = role.name;
        sheet.getCell(`B${dataRow}`).value = role.sprintHours;
        sheet.getCell(`C${headerRow}`).value = primary.label || "";
        sheet.getCell(`C${dataRow}`).value = primary.hours || 0;
        sheet.getCell(`D${dataRow}`).value = primary.description || "";
        sheet.getCell(`E${headerRow}`).value = secondary.label || "";
        sheet.getCell(`E${dataRow}`).value = secondary.hours || 0;
        sheet.getCell(`F${dataRow}`).value = secondary.description || "";
        sheet.getCell(`G${headerRow}`).value = extra.label || "";
        sheet.getCell(`G${dataRow}`).value = extra.hours || 0;
        sheet.getCell(`H${dataRow}`).value = extra.description || "";

        for (let column = 1; column <= 8; column += 1) {
            sheet.getCell(spacerRow, column).value = null;
        }
    });
}

function fillSummarySheet(sheet, settings, plan, detailMeta) {
    sheet.getCell("A1").value = `Ресурсный план ${plan.periodLabel}`;
    const distribution = plan.distribution || settings.distribution;
    const sourceRoles = Array.isArray(plan.sourceRoles) && plan.sourceRoles.length
        ? plan.sourceRoles
        : (Array.isArray(settings.roles) ? settings.roles : []);
    const topTableVisibleRows = 5;
    const topTableExtraRows = Math.max(0, sourceRoles.length - topTableVisibleRows);

    setFormulaValue(sheet.getCell("C5"), "C6+C9", distribution.total);
    setFormulaValue(sheet.getCell("C6"), "C7+C8", distribution.business);
    sheet.getCell("C7").value = distribution.keyTasks;
    sheet.getCell("C8").value = distribution.support;
    setFormulaValue(sheet.getCell("C9"), "C10+C11", distribution.internal);
    sheet.getCell("C10").value = distribution.architecture;
    sheet.getCell("C11").value = distribution.other;

    try {
        sheet.unMergeCells("F11:H11");
    } catch (error) {
        // nothing to unmerge
    }

    const topRoleStyle = {
        name: cloneStyle(sheet.getCell("G7").style),
        primary: cloneStyle(sheet.getCell("H7").style),
        support: cloneStyle(sheet.getCell("I7").style)
    };

    for (let row = 7; row <= 11 + topTableExtraRows; row += 1) {
        for (let column = 7; column <= 9; column += 1) {
            clearCell(sheet.getCell(row, column));
        }
    }

    clearCell(sheet.getCell("F11"));
    clearCell(sheet.getCell("G11"));
    clearCell(sheet.getCell("H11"));

    sourceRoles.forEach((role, index) => {
        const row = 7 + index;
        sheet.getCell(`G${row}`).style = cloneStyle(topRoleStyle.name);
        sheet.getCell(`H${row}`).style = cloneStyle(topRoleStyle.primary);
        sheet.getCell(`I${row}`).style = cloneStyle(topRoleStyle.support);
        sheet.getCell(`G${row}`).value = role.name;
        sheet.getCell(`H${row}`).value = Number(role.primaryHours) || 0;
        sheet.getCell(`I${row}`).value = Number(role.secondaryHours) || 0;
    });

    if (topTableExtraRows > 0) {
        clearSummaryRange(sheet, 14, 13 + topTableExtraRows, 9);
    }

    const layouts = buildSummaryLayouts(plan.roles.length, topTableExtraRows);
    clearSummaryRange(sheet, layouts.overview.labelRow, Math.max(layouts.period.totalRow, 60 + topTableExtraRows), 9);

    [
        { target: layouts.overview.labelRow, template: 14 },
        { target: layouts.overview.titleRow, template: 15, withValues: true },
        { target: layouts.overview.totalRow, template: 19 },
        { target: layouts.period.labelRow, template: 45 },
        { target: layouts.period.titleRow, template: 46, withValues: true },
        { target: layouts.period.totalRow, template: 50 }
    ].forEach(item => {
        if (item.withValues) {
            copyRowTemplate(sheet, item.template, item.target);
            return;
        }

        copyRowStyles(sheet, item.template, item.target);
    });

    layouts.months.forEach(layout => {
        copyRowStyles(sheet, 22, layout.labelRow);
        copyRowTemplate(sheet, 23, layout.titleRow);
        copyRowStyles(sheet, 27, layout.totalRow);
    });

    const separatorRows = [
        layouts.overview.totalRow + 1,
        ...layouts.months.map(layout => layout.totalRow + 1)
    ];

    separatorRows.forEach(rowNumber => clearSummarySeparatorRow(sheet, rowNumber));
    for (let row = layouts.period.totalRow + 1; row <= Math.max(layouts.period.totalRow + 7, 60 + topTableExtraRows); row += 1) {
        clearSummarySeparatorRow(sheet, row);
    }

    sheet.getCell(`A${layouts.overview.labelRow}`).value = "1 спринт (полный, без учета отпусков)";
    sheet.getCell(`B${layouts.overview.labelRow}`).value = "2 спринт (полный, без учета отпусков)";
    sheet.getCell(`C${layouts.overview.labelRow}`).value = "3 спринт (полный, без учета отпусков)";
    sheet.getCell(`A${layouts.period.labelRow}`).value = "Итого период";

    plan.roles.forEach((role, index) => {
        const row = layouts.overview.dataStartRow + index;
        copyRowStyles(sheet, 16, row);
        const keyTasksValue = (role.sprintCapacity || 0) * distribution.keyTasks;
        const supportValue = (role.sprintCapacity || 0) * distribution.support;
        const architectureValue = (role.sprintCapacity || 0) * distribution.architecture;
        const otherValue = (role.sprintCapacity || 0) * distribution.other;
        const totalValue = role.sprintCapacity || 0;
        sheet.getCell(`A${row}`).value = role.summaryLabel;
        sheet.getCell(`B${row}`).value = role.employeeCount;
        setFormulaValue(sheet.getCell(`C${row}`), `G${row}*$C$7`, keyTasksValue);
        setFormulaValue(sheet.getCell(`D${row}`), `G${row}*$C$8`, supportValue);
        setFormulaValue(sheet.getCell(`E${row}`), `G${row}*$C$10`, architectureValue);
        setFormulaValue(sheet.getCell(`F${row}`), `G${row}*$C$11`, otherValue);
        sheet.getCell(`G${row}`).value = totalValue;
    });

    setFormulaValue(sheet.getCell(`B${layouts.overview.totalRow}`), `SUM(B${layouts.overview.dataStartRow}:B${layouts.overview.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + role.employeeCount, 0));
    setFormulaValue(sheet.getCell(`C${layouts.overview.totalRow}`), `SUM(C${layouts.overview.dataStartRow}:C${layouts.overview.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + ((role.sprintCapacity || 0) * distribution.keyTasks), 0));
    setFormulaValue(sheet.getCell(`D${layouts.overview.totalRow}`), `SUM(D${layouts.overview.dataStartRow}:D${layouts.overview.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + ((role.sprintCapacity || 0) * distribution.support), 0));
    setFormulaValue(sheet.getCell(`E${layouts.overview.totalRow}`), `SUM(E${layouts.overview.dataStartRow}:E${layouts.overview.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + ((role.sprintCapacity || 0) * distribution.architecture), 0));
    setFormulaValue(sheet.getCell(`F${layouts.overview.totalRow}`), `SUM(F${layouts.overview.dataStartRow}:F${layouts.overview.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + ((role.sprintCapacity || 0) * distribution.other), 0));
    setFormulaValue(sheet.getCell(`G${layouts.overview.totalRow}`), `SUM(G${layouts.overview.dataStartRow}:G${layouts.overview.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + (role.sprintCapacity || 0), 0));

    layouts.months.forEach((layout, blockIndex) => {
        const block = plan.monthBlocks[blockIndex];

        if (!block) {
            for (let row = layout.labelRow; row <= layout.totalRow; row += 1) {
                for (let column = 1; column <= 7; column += 1) {
                    sheet.getRow(row).getCell(column).value = null;
                }
            }
            return;
        }

        sheet.getCell(`A${layout.labelRow}`).value = `${blockIndex + 1} месяц`;
        sheet.getCell(`B${layout.labelRow}`).value = getSprintLabel(block.weeks.length);
        sheet.getCell(`C${layout.labelRow}`).value = null;

        plan.roles.forEach((role, roleIndex) => {
            const row = layout.dataStartRow + roleIndex;
            copyRowStyles(sheet, 24, row);
            const detailAddress = detailMeta[role.key].monthColumns[block.key];
            const monthTotal = role.monthTotals[block.key] || 0;
            const keyTasksValue = monthTotal * distribution.keyTasks;
            const supportValue = monthTotal * distribution.support;
            const architectureValue = monthTotal * distribution.architecture;
            const otherValue = monthTotal * distribution.other;
            sheet.getCell(`A${row}`).value = role.summaryLabel;
            sheet.getCell(`B${row}`).value = role.employeeCount;
            setFormulaValue(sheet.getCell(`G${row}`), `'Детальный ресурсный план '!${detailAddress}`, monthTotal);
            setFormulaValue(sheet.getCell(`C${row}`), `G${row}*$C$7`, keyTasksValue);
            setFormulaValue(sheet.getCell(`D${row}`), `G${row}*$C$8`, supportValue);
            setFormulaValue(sheet.getCell(`E${row}`), `G${row}*$C$10`, architectureValue);
            setFormulaValue(sheet.getCell(`F${row}`), `G${row}*$C$11`, otherValue);
        });

        setFormulaValue(sheet.getCell(`B${layout.totalRow}`), `SUM(B${layout.dataStartRow}:B${layout.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + role.employeeCount, 0));
        setFormulaValue(sheet.getCell(`C${layout.totalRow}`), `SUM(C${layout.dataStartRow}:C${layout.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + ((role.monthTotals[block.key] || 0) * distribution.keyTasks), 0));
        setFormulaValue(sheet.getCell(`D${layout.totalRow}`), `SUM(D${layout.dataStartRow}:D${layout.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + ((role.monthTotals[block.key] || 0) * distribution.support), 0));
        setFormulaValue(sheet.getCell(`E${layout.totalRow}`), `SUM(E${layout.dataStartRow}:E${layout.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + ((role.monthTotals[block.key] || 0) * distribution.architecture), 0));
        setFormulaValue(sheet.getCell(`F${layout.totalRow}`), `SUM(F${layout.dataStartRow}:F${layout.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + ((role.monthTotals[block.key] || 0) * distribution.other), 0));
        setFormulaValue(sheet.getCell(`G${layout.totalRow}`), `SUM(G${layout.dataStartRow}:G${layout.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + (role.monthTotals[block.key] || 0), 0));
        sheet.getCell(`A${layout.totalRow}`).value = "Итого";
    });

    plan.roles.forEach((role, index) => {
        const row = layouts.period.dataStartRow + index;
        copyRowStyles(sheet, 47, row);
        const monthRows = layouts.months
            .filter((_, blockIndex) => blockIndex < plan.monthBlocks.length)
            .map(layout => layout.dataStartRow + index);
        const keyTasksTotal = plan.monthBlocks.reduce((sum, block) => sum + ((role.monthTotals[block.key] || 0) * distribution.keyTasks), 0);
        const supportTotal = plan.monthBlocks.reduce((sum, block) => sum + ((role.monthTotals[block.key] || 0) * distribution.support), 0);
        const architectureTotal = plan.monthBlocks.reduce((sum, block) => sum + ((role.monthTotals[block.key] || 0) * distribution.architecture), 0);
        const otherTotal = plan.monthBlocks.reduce((sum, block) => sum + ((role.monthTotals[block.key] || 0) * distribution.other), 0);

        sheet.getCell(`A${row}`).value = role.summaryLabel;
        sheet.getCell(`B${row}`).value = role.employeeCount;
        setFormulaValue(sheet.getCell(`C${row}`), monthRows.map(item => `C${item}`).join("+") || "0", keyTasksTotal);
        setFormulaValue(sheet.getCell(`D${row}`), monthRows.map(item => `D${item}`).join("+") || "0", supportTotal);
        setFormulaValue(sheet.getCell(`E${row}`), monthRows.map(item => `E${item}`).join("+") || "0", architectureTotal);
        setFormulaValue(sheet.getCell(`F${row}`), monthRows.map(item => `F${item}`).join("+") || "0", otherTotal);
        setFormulaValue(sheet.getCell(`G${row}`), monthRows.map(item => `G${item}`).join("+") || "0", role.periodTotal);
    });

    setFormulaValue(sheet.getCell(`B${layouts.period.totalRow}`), `SUM(B${layouts.period.dataStartRow}:B${layouts.period.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + role.employeeCount, 0));
    setFormulaValue(sheet.getCell(`C${layouts.period.totalRow}`), `SUM(C${layouts.period.dataStartRow}:C${layouts.period.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + plan.monthBlocks.reduce((inner, block) => inner + ((role.monthTotals[block.key] || 0) * distribution.keyTasks), 0), 0));
    setFormulaValue(sheet.getCell(`D${layouts.period.totalRow}`), `SUM(D${layouts.period.dataStartRow}:D${layouts.period.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + plan.monthBlocks.reduce((inner, block) => inner + ((role.monthTotals[block.key] || 0) * distribution.support), 0), 0));
    setFormulaValue(sheet.getCell(`E${layouts.period.totalRow}`), `SUM(E${layouts.period.dataStartRow}:E${layouts.period.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + plan.monthBlocks.reduce((inner, block) => inner + ((role.monthTotals[block.key] || 0) * distribution.architecture), 0), 0));
    setFormulaValue(sheet.getCell(`F${layouts.period.totalRow}`), `SUM(F${layouts.period.dataStartRow}:F${layouts.period.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + plan.monthBlocks.reduce((inner, block) => inner + ((role.monthTotals[block.key] || 0) * distribution.other), 0), 0));
    setFormulaValue(sheet.getCell(`G${layouts.period.totalRow}`), `SUM(G${layouts.period.dataStartRow}:G${layouts.period.totalRow - 1})`, plan.roles.reduce((sum, role) => sum + role.periodTotal, 0));
    sheet.getCell(`A${layouts.period.totalRow}`).value = "Итого";
}

function fillDetailSheet(sheet, plan) {
    const styleRefs = {
        workdayHeader: cloneStyle(sheet.getCell("C2").style),
        totalHeader: cloneStyle(sheet.getCell("G3").style),
        sprintHeader: cloneStyle(sheet.getCell("C3").style),
        dateHeader: cloneStyle(sheet.getCell("C4").style),
        totalBlank: cloneStyle(sheet.getCell("G2").style),
        userName: cloneStyle(sheet.getCell("A5").style),
        userWeek: cloneStyle(sheet.getCell("C5").style),
        userTotal: cloneStyle(sheet.getCell("G5").style),
        totalName: cloneStyle(sheet.getCell("A8").style),
        totalWeek: cloneStyle(sheet.getCell("C8").style),
        totalTotal: cloneStyle(sheet.getCell("G8").style),
        blankA: cloneStyle(sheet.getCell("A9").style),
        blankWeek: cloneStyle(sheet.getCell("C9").style)
    };

    const weekWidth = sheet.getColumn(3).width;
    const totalWidth = sheet.getColumn(7).width;
    const workdayHeaderStyle = createCenteredHeaderStyle(styleRefs.workdayHeader);
    const workdayRow = 1;
    const sprintRow = 2;
    const dateRow = 3;
    const firstDataRow = 4;

    sheet.spliceRows(1, 1);

    for (let row = 1; row <= Math.max(sheet.rowCount, 120); row += 1) {
        for (let column = 1; column <= Math.max(sheet.columnCount, 32); column += 1) {
            clearCell(sheet.getRow(row).getCell(column));
        }
    }

    sheet.getColumn(1).width = getDetailNameColumnWidth(plan);
    sheet.getCell(`A${workdayRow}`).value = "Кол-во раб.дней";
    sheet.getCell(`A${sprintRow}`).value = "№ спринта";
    sheet.getCell(`A${dateRow}`).value = "Дата спринта";
    sheet.getCell(`A${workdayRow}`).style = cloneStyle(styleRefs.userName);
    sheet.getCell(`A${sprintRow}`).style = cloneStyle(styleRefs.userName);
    sheet.getCell(`A${dateRow}`).style = cloneStyle(styleRefs.userName);

    let columnIndex = 2;
    const detailMeta = {};

    plan.monthBlocks.forEach(block => {
        block.weeks.forEach(week => {
            sheet.getColumn(columnIndex).width = weekWidth;
            sheet.getCell(workdayRow, columnIndex).value = week.workingDays;
            sheet.getCell(sprintRow, columnIndex).value = week.sprintNumber ?? week.isoWeek;
            sheet.getCell(dateRow, columnIndex).value = week.label;
            sheet.getCell(workdayRow, columnIndex).style = cloneStyle(workdayHeaderStyle);
            sheet.getCell(sprintRow, columnIndex).style = cloneStyle(styleRefs.sprintHeader);
            sheet.getCell(dateRow, columnIndex).style = cloneStyle(styleRefs.dateHeader);
            columnIndex += 1;
        });

        sheet.getColumn(columnIndex).width = totalWidth;
        sheet.getCell(workdayRow, columnIndex).value = null;
        sheet.getCell(sprintRow, columnIndex).value = block.totalLabel;
        sheet.getCell(dateRow, columnIndex).value = null;
        sheet.getCell(workdayRow, columnIndex).style = cloneStyle(styleRefs.totalBlank);
        sheet.getCell(sprintRow, columnIndex).style = cloneStyle(styleRefs.totalHeader);
        sheet.getCell(dateRow, columnIndex).style = cloneStyle(styleRefs.totalBlank);
        columnIndex += 1;
    });

    for (let column = 1; column < columnIndex; column += 1) {
        const cell = sheet.getCell(workdayRow, column);
        if (cell.value === null || cell.value === "") {
            continue;
        }

        cell.style = {
            ...cloneStyle(cell.style),
            border: {
                top: { style: "thin", color: { argb: "FFCCD8E6" } },
                left: { style: "thin", color: { argb: "FFCCD8E6" } },
                bottom: { style: "thin", color: { argb: "FFCCD8E6" } },
                right: { style: "thin", color: { argb: "FFCCD8E6" } }
            }
        };
    }

    let rowIndex = firstDataRow;

    plan.roles.forEach((role, roleIndex) => {
        const employeeStart = rowIndex;

        role.rows.forEach(employee => {
            sheet.getCell(`A${rowIndex}`).value = employee.name;
            sheet.getCell(`A${rowIndex}`).style = cloneStyle(styleRefs.userName);

            let cursor = 2;
            plan.monthBlocks.forEach(block => {
                block.weeks.forEach(week => {
                    const value = employee.weekValues.find(item => item.weekKey === week.key)?.value || 0;
                    sheet.getCell(rowIndex, cursor).value = value;
                    sheet.getCell(rowIndex, cursor).style = cloneStyle(styleRefs.userWeek);
                    cursor += 1;
                });

                const startColumn = cursor - block.weeks.length;
                const endColumn = cursor - 1;
                setFormulaValue(
                    sheet.getCell(rowIndex, cursor),
                    `SUM(${sheet.getCell(rowIndex, startColumn).address}:${sheet.getCell(rowIndex, endColumn).address})`,
                    employee.monthTotals[block.key] || 0
                );
                sheet.getCell(rowIndex, cursor).style = cloneStyle(styleRefs.userTotal);
                cursor += 1;
            });

            rowIndex += 1;
        });

        const totalRow = rowIndex;
        detailMeta[role.key] = { totalRow, monthColumns: {} };
        sheet.getCell(`A${totalRow}`).value = role.detailTotalLabel;
        sheet.getCell(`A${totalRow}`).style = cloneStyle(styleRefs.totalName);

        let cursor = 2;
        plan.monthBlocks.forEach(block => {
            block.weeks.forEach(week => {
                const columnLetter = sheet.getCell(totalRow, cursor).address.replace(/\d+/g, "");
                const result = role.weekTotals[week.key] || 0;
                if (role.rows.length) {
                    setFormulaValue(
                        sheet.getCell(totalRow, cursor),
                        `SUM(${columnLetter}${employeeStart}:${columnLetter}${totalRow - 1})`,
                        result
                    );
                } else {
                    sheet.getCell(totalRow, cursor).value = 0;
                }
                sheet.getCell(totalRow, cursor).style = cloneStyle(styleRefs.totalWeek);
                cursor += 1;
            });

            const monthColumn = cursor;
            detailMeta[role.key].monthColumns[block.key] = sheet.getCell(totalRow, monthColumn).address;
            const startColumn = cursor - block.weeks.length;
            const endColumn = cursor - 1;
            setFormulaValue(
                sheet.getCell(totalRow, monthColumn),
                `SUM(${sheet.getCell(totalRow, startColumn).address}:${sheet.getCell(totalRow, endColumn).address})`,
                role.monthTotals[block.key] || 0
            );
            sheet.getCell(totalRow, monthColumn).style = cloneStyle(styleRefs.totalTotal);
            cursor += 1;
        });

        rowIndex += 1;

        if (roleIndex < plan.roles.length - 1) {
            for (let column = 1; column < columnIndex; column += 1) {
                const cell = sheet.getCell(rowIndex, column);
                cell.value = null;
                cell.style = cloneStyle(column < 2 ? styleRefs.blankA : styleRefs.blankWeek);
            }
            rowIndex += 1;
        }
    });

    return detailMeta;
}

async function exportWorkbook(settings, plan) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(TEMPLATE_PATH);
    workbook.calcProperties.fullCalcOnLoad = true;

    const summarySheet = workbook.getWorksheet("Сводный ресурсный план");
    const detailSheet = workbook.getWorksheet("Детальный ресурсный план ");
    const tasksSheet = workbook.getWorksheet("Типовые задачи");

    fillTasksSheet(tasksSheet, settings, plan);
    const detailMeta = fillDetailSheet(detailSheet, plan);
    fillSummarySheet(summarySheet, settings, plan, detailMeta);

    return workbook.xlsx.writeBuffer();
}

module.exports = {
    exportWorkbook
};
