const state = {
    settings: null,
    settingsDraft: null,
    vacations: null,
    analysis: null,
    workflow: {
        uploaded: false
    },
    invalidSettingsFields: new Set(),
    selection: {
        teamKey: "",
        departments: [],
        employeeIds: [],
        months: []
    },
    currentYear: null,
    monthWorkdaysByYear: {},
    monthWorkdaysLoadingYear: null,
    expandedStep: 1,
    workflowTeamWarning: null,
    expandedTeamKey: null,
    activeTeamPanels: {},
    expandedRoleKey: null,
    expandedRoleSections: {},
    expandedDistributionSections: {
        business: true,
        internal: true
    },
    teamMembersSorts: {}
};

const monthOnlyFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" });
const deepClone = value => JSON.parse(JSON.stringify(value));
let draggedTeamKey = null;

const elements = {
    fileInput: document.getElementById("fileInput"),
    uploadMeta: document.getElementById("uploadMeta"),
    heroStats: document.getElementById("heroStats"),
    departmentList: document.getElementById("departmentList"),
    employeeGroups: document.getElementById("employeeGroups"),
    yearList: document.getElementById("yearList"),
    monthList: document.getElementById("monthList"),
    workflowTeamList: document.getElementById("workflowTeamList"),
    workflowTeamPreview: document.getElementById("workflowTeamPreview"),
    workflowTeamWarning: document.getElementById("workflowTeamWarning"),
    bulkDepartmentsBtn: document.getElementById("bulkDepartmentsBtn"),
    bulkEmployeesBtn: document.getElementById("bulkEmployeesBtn"),
    bulkMonthsBtn: document.getElementById("bulkMonthsBtn"),
    analysisPanel: document.getElementById("analysisPanel"),
    statusText: document.getElementById("statusText"),
    stepper: document.getElementById("stepper"),
    analyzeBtn: document.getElementById("analyzeBtn"),
    exportBtn: document.getElementById("exportBtn"),
    resetBtn: document.getElementById("resetBtn"),
    openSettingsBtn: document.getElementById("openSettingsBtn"),
    testSettingsBtn: document.getElementById("testSettingsBtn"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    closeSettingsTop: document.getElementById("closeSettingsTop"),
    saveSettingsBtn: document.getElementById("saveSettingsBtn"),
    drawerBackdrop: document.getElementById("drawerBackdrop"),
    settingsDrawer: document.getElementById("settingsDrawer"),
    teamTabsBar: document.getElementById("teamTabsBar"),
    roleCards: document.getElementById("roleCards"),
    copyTopTeamBtn: document.getElementById("copyTopTeamBtn"),
    addTeamBtn: document.getElementById("addTeamBtn"),
    distributionForm: document.getElementById("distributionForm"),
    roleSummaryTable: document.getElementById("roleSummaryTable"),
    calendarForm: document.getElementById("calendarForm"),
    miscForm: document.getElementById("miscForm"),
    infoDialogBackdrop: document.getElementById("infoDialogBackdrop"),
    infoDialog: document.getElementById("infoDialog"),
    infoDialogTitle: document.getElementById("infoDialogTitle"),
    infoDialogMessage: document.getElementById("infoDialogMessage"),
    closeInfoDialogTop: document.getElementById("closeInfoDialogTop"),
    closeInfoDialogBtn: document.getElementById("closeInfoDialogBtn")
};

function setStatus(message, isError = false) {
    elements.statusText.textContent = message || "";
    elements.statusText.classList.toggle("error-text", isError);
}

function scrollExpandedStepIntoView() {
    const scrollContainer = document.querySelector(".steps-scroll");
    const expandedCard = document.querySelector(`.wizard-card[data-step="${state.expandedStep}"]`);
    const header = expandedCard?.querySelector(".accordion-header");

    if (!scrollContainer || !expandedCard || !header) {
        return;
    }

    requestAnimationFrame(() => {
        const containerRect = scrollContainer.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const targetTop = scrollContainer.scrollTop + (headerRect.top - containerRect.top) - 10;

        scrollContainer.scrollTo({
            top: Math.max(0, targetTop),
            behavior: "smooth"
        });
    });
}

function cleanTooltipText(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function estimateWrappedLineCount(value, charactersPerLine = 26) {
    const text = String(value ?? "").trim();
    if (!text) {
        return 1;
    }

    return text
        .split(/\r?\n/)
        .reduce((maxLines, line) => Math.max(maxLines, Math.max(1, Math.ceil(line.length / charactersPerLine))), 1);
}

function ensureTeamMembersSort(teamKey = state.expandedTeamKey || "") {
    const key = String(teamKey || "");
    if (!state.teamMembersSorts[key]) {
        state.teamMembersSorts[key] = {
            key: "department",
            direction: "asc"
        };
    }

    return state.teamMembersSorts[key];
}

function compareTextValues(left, right) {
    return String(left || "").localeCompare(String(right || ""), "ru", {
        sensitivity: "base",
        numeric: true
    });
}

function sortTeamMembersRows(rows, teamKey = state.expandedTeamKey || "") {
    const sortState = ensureTeamMembersSort(teamKey);
    const directionFactor = sortState.direction === "desc" ? -1 : 1;

    return [...rows].sort((left, right) => {
        const leftMember = left.member;
        const rightMember = right.member;
        let result = 0;

        if (sortState.key === "participationPercent") {
            result = (Number(leftMember.participationPercent) || 0) - (Number(rightMember.participationPercent) || 0);
        } else if (sortState.key === "role") {
            result = compareTextValues(leftMember.role || leftMember.position || "", rightMember.role || rightMember.position || "");
        } else {
            result = compareTextValues(leftMember[sortState.key], rightMember[sortState.key]);
        }

        if (result === 0) {
            return left.index - right.index;
        }

        return result * directionFactor;
    });
}

function getFieldLabelText(element) {
    const label = element.closest("label");
    if (!label) {
        return "";
    }

    const smallText = cleanTooltipText(label.querySelector("small")?.textContent);
    if (smallText) {
        return smallText;
    }

    const spanText = cleanTooltipText(label.querySelector("span")?.textContent);
    if (spanText) {
        return spanText;
    }

    return cleanTooltipText(label.textContent);
}

function getTooltipText(element) {
    const explicitText = cleanTooltipText(element.dataset.tooltip || "");
    if (explicitText) {
        return explicitText;
    }

    const ariaLabel = cleanTooltipText(element.getAttribute("aria-label"));
    if (ariaLabel) {
        return ariaLabel;
    }

    if (element.matches(".drawer-tab")) {
        const text = cleanTooltipText(element.textContent);
        return text ? `Открыть вкладку "${text}"` : "";
    }

    if (element.matches(".team-tab-button")) {
        const text = cleanTooltipText(element.querySelector(".team-tab-label")?.textContent || element.textContent);
        return text ? `Открыть команду "${text}"` : "Открыть команду";
    }

    if (element.matches(".team-panel-tab")) {
        const text = cleanTooltipText(element.textContent);
        return text ? `Открыть раздел "${text}" внутри команды` : "Открыть раздел команды";
    }

    if (element.matches(".sort-direction-button")) {
        const label = cleanTooltipText(element.dataset.label || "");
        const direction = element.dataset.direction === "desc" ? "по убыванию" : "по возрастанию";
        return label ? `Сортировать колонку "${label}" ${direction}` : `Сортировать ${direction}`;
    }

    if (element.matches(".accordion-header")) {
        const text = cleanTooltipText(element.querySelector("h3")?.textContent);
        return text ? `Развернуть или свернуть этап "${text}"` : "Развернуть или свернуть этап";
    }

    if (element.matches(".team-header")) {
        const text = cleanTooltipText(element.querySelector("strong")?.textContent);
        return text ? `Развернуть или свернуть команду "${text}"` : "Развернуть или свернуть команду";
    }

    if (element.matches(".role-card-header")) {
        const text = cleanTooltipText(element.querySelector("strong")?.textContent);
        return text ? `Развернуть или свернуть роль "${text}"` : "Развернуть или свернуть роль";
    }

    if (element.matches(".role-detail-header")) {
        const text = cleanTooltipText(element.querySelector("strong")?.textContent);
        return text ? `Развернуть или свернуть категорию "${text}"` : "Развернуть или свернуть категорию";
    }

    if (element.matches(".distribution-header")) {
        const text = cleanTooltipText(element.querySelector("strong")?.textContent);
        return text ? `Развернуть или свернуть блок "${text}"` : "Развернуть или свернуть блок";
    }

    if (element.matches(".upload-zone")) {
        return "Выбрать и загрузить файл графика отпусков в формате Excel";
    }

    if (element.matches("#departmentList label")) {
        const text = cleanTooltipText(element.querySelector(".tile-label")?.textContent);
        return text ? `Выбрать подразделение "${text}"` : "Выбрать подразделение";
    }

    if (element.matches("#workflowTeamList label")) {
        const text = cleanTooltipText(element.querySelector(".tile-label")?.textContent);
        return text ? `Выбрать команду "${text}"` : "Выбрать команду";
    }

    if (element.matches(".employee-tile")) {
        const name = cleanTooltipText(element.querySelector("strong")?.textContent);
        const role = cleanTooltipText(element.querySelector("span")?.textContent);
        return name ? `Выбрать сотрудника "${name}"${role ? `, должность: ${role}` : ""}` : "Выбрать сотрудника";
    }

    if (element.matches(".month-tile")) {
        const month = cleanTooltipText(element.querySelector("strong")?.textContent);
        if (!element.querySelector("input")?.disabled) {
            return month ? `Выбрать месяц "${month}"` : "Выбрать месяц";
        }
        return month ? `Месяц "${month}" недоступен: выбирать можно только подряд идущие месяцы` : "Выбор доступен только для подряд идущих месяцев";
    }

    if (element.matches(".calendar-toggle-field")) {
        const text = cleanTooltipText(element.querySelector("span")?.textContent);
        return text ? `Включить или выключить параметр "${text}"` : "Изменить параметр";
    }

    if (element.matches(".misc-radio-option")) {
        const text = cleanTooltipText(element.querySelector("span")?.textContent);
        return text ? `Выбрать вариант "${text}"` : "Выбрать вариант";
    }

    if (element.matches("button")) {
        const title = cleanTooltipText(element.textContent);
        return title || "";
    }

    if (element.matches("input, select, textarea")) {
        const fieldLabel = getFieldLabelText(element);
        return fieldLabel ? `Поле "${fieldLabel}"` : "";
    }

    return "";
}

function applyTooltips(root = document) {
    const selector = [
        "button",
        "input",
        "select",
        "textarea",
        ".drawer-tab",
        ".team-tab-button",
        ".team-panel-tab",
        ".accordion-header",
        ".team-header",
        ".role-card-header",
        ".role-detail-header",
        ".distribution-header",
        ".upload-zone",
        "#workflowTeamList label",
        "#departmentList label",
        ".employee-tile",
        ".month-tile",
        ".calendar-toggle-field",
        ".misc-radio-option"
    ].join(", ");

    root.querySelectorAll(selector).forEach(element => {
        const tooltip = getTooltipText(element);
        if (tooltip) {
            element.title = tooltip;
        }
    });
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload.error || "Ошибка запроса.");
    }

    return payload;
}

function getMonthName(key) {
    const [year, month] = key.split("-").map(Number);
    const raw = monthOnlyFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
    return raw[0].toUpperCase() + raw.slice(1);
}

function getVisibleMonthKeys(year = state.currentYear) {
    if (!year) {
        return [];
    }

    return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

function getNormalizedSelection() {
    const visibleMonths = getVisibleMonthKeys();

    return {
        teamKey: state.selection.teamKey,
        departments: [...state.selection.departments],
        employeeIds: [...state.selection.employeeIds],
        months: (visibleMonths.length
            ? state.selection.months.filter(item => visibleMonths.includes(item))
            : state.selection.months
        ).sort()
    };
}

function getAvailableYears() {
    if (!state.workflow.uploaded) {
        return [];
    }

    const items = state.vacations?.monthOptions || [];
    const years = new Set([2024, 2025, new Date().getFullYear()]);

    items.forEach(item => {
        if (Number.isInteger(Number(item.year))) {
            years.add(Number(item.year));
        }
    });

    return [...years]
        .sort((left, right) => left - right)
        .map(String);
}

function ensureCurrentYear() {
    const years = getAvailableYears();

    if (!years.length) {
        state.currentYear = null;
        return;
    }

    const selectedYear = state.selection.months[0]?.slice(0, 4);
    if (selectedYear && years.includes(selectedYear)) {
        state.currentYear = selectedYear;
        return;
    }

    if (!state.currentYear || !years.includes(String(state.currentYear))) {
        const currentBrowserYear = String(new Date().getFullYear());
        state.currentYear = years.includes(currentBrowserYear) ? currentBrowserYear : years[0];
    }
}

function getVisibleSelectedMonths(year = state.currentYear) {
    if (!year) {
        return [];
    }

    return state.selection.months
        .filter(item => item.startsWith(`${year}-`))
        .sort();
}

function getSettingsTeams(source = state.settings) {
    return Array.isArray(source?.teams) ? source.teams : [];
}

function getTeamMembers(teamKey, source = state.settings) {
    return getSettingsTeams(source)
        .find(team => team.key === teamKey)?.members || [];
}

function getParticipationPercentForEmployee(employee, teamKey = state.selection.teamKey, source = state.settings) {
    if (!employee || !teamKey) {
        return 100;
    }

    const normalize = value => normalizeComparable(value);
    const matchedMember = getTeamMembers(teamKey, source).find(member => (
        normalize(member.department) === normalize(employee.department)
        && normalize(member.position) === normalize(employee.position)
        && normalize(member.fullName) === normalize(employee.fullName)
    ));

    return Math.min(100, Math.max(0, Number.parseInt(matchedMember?.participationPercent, 10) || 100));
}

function findEmployeesByTeamMembers(teamMembers) {
    const employees = state.vacations?.employees || [];
    const normalize = value => normalizeComparable(value);

    return employees.filter(employee => teamMembers.some(member => (
        normalize(member.department) === normalize(employee.department)
        && normalize(member.position) === normalize(employee.position)
        && normalize(member.fullName) === normalize(employee.fullName)
    )));
}

function getMissingTeamMembers(teamMembers) {
    const employees = state.vacations?.employees || [];
    const normalize = value => normalizeComparable(value);

    return teamMembers.filter(member => !employees.some(employee => (
        normalize(member.department) === normalize(employee.department)
        && normalize(member.position) === normalize(employee.position)
        && normalize(member.fullName) === normalize(employee.fullName)
    )));
}

function applyWorkflowTeamSelection(teamKey) {
    state.selection.teamKey = teamKey;
    const teamMembers = getTeamMembers(teamKey);
    const matchedEmployees = findEmployeesByTeamMembers(teamMembers);
    const missingMembers = getMissingTeamMembers(teamMembers);
    const matchedDepartments = [...new Set(matchedEmployees.map(employee => employee.department))];
    state.selection.departments = matchedDepartments;
    state.selection.employeeIds = matchedEmployees.map(employee => employee.id);
    state.workflowTeamWarning = missingMembers.length
        ? {
            teamKey,
            teamName: getSettingsTeams(state.settings).find(team => team.key === teamKey)?.name || "",
            missingMembers
        }
        : null;
    if (missingMembers.length) {
        setStatus(`Для части сохранённого состава команды не найдены данные в текущем файле отпусков.`, true);
    }
    invalidateAnalysis();
}

function renderTeamMembersTable(target, members, emptyText) {
    if (!target) {
        return;
    }

    const teamKey = state.expandedTeamKey || "";
    const sortState = ensureTeamMembersSort(teamKey);
    const sortableColumns = [
        { key: "department", label: "Подразделение" },
        { key: "fullName", label: "ФИО" },
        { key: "position", label: "Должность" },
        { key: "role", label: "Роль" },
        { key: "participationPercent", label: "% участия" }
    ];
    const sortedMembers = sortTeamMembersRows(
        members.map((member, index) => ({ member, index })),
        teamKey
    );

    target.innerHTML = members.length ? `
        <div class="role-summary-table team-members-table">
            <table>
                <thead>
                    <tr>
                        ${sortableColumns.map(column => `
                            <th>
                                <div class="sortable-header">
                                    <span>${column.label}</span>
                                    <span class="sortable-header-actions">
                                        <button
                                            class="sort-direction-button ${sortState.key === column.key && sortState.direction === "asc" ? "active" : ""}"
                                            type="button"
                                            data-action="sort-team-members"
                                            data-key="${column.key}"
                                            data-direction="asc"
                                            data-label="${column.label}"
                                            aria-label="Сортировать ${column.label} по возрастанию"
                                        >↑</button>
                                        <button
                                            class="sort-direction-button ${sortState.key === column.key && sortState.direction === "desc" ? "active" : ""}"
                                            type="button"
                                            data-action="sort-team-members"
                                            data-key="${column.key}"
                                            data-direction="desc"
                                            data-label="${column.label}"
                                            aria-label="Сортировать ${column.label} по убыванию"
                                        >↓</button>
                                    </span>
                                </div>
                            </th>
                        `).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${sortedMembers.map(({ member, index }) => `
                        ${(() => {
                            const roleValue = member.role || member.position || "";
                            const rowCount = Math.max(
                                estimateWrappedLineCount(member.position || ""),
                                estimateWrappedLineCount(roleValue)
                            );

                            return `
                        <tr>
                            <td>${member.department}</td>
                            <td>${member.fullName}</td>
                            <td>${member.position}</td>
                            <td>
                                <textarea
                                    class="team-member-role-input"
                                    data-field="team-member-role"
                                    data-team="${state.expandedTeamKey || ""}"
                                    data-member-index="${index}"
                                    rows="${rowCount}"
                                >${escapeHtml(roleValue)}</textarea>
                            </td>
                            <td>
                                <input
                                    type="text"
                                    inputmode="numeric"
                                    maxlength="3"
                                    class="team-member-percent-input"
                                    data-field="team-member-participation"
                                    data-team="${state.expandedTeamKey || ""}"
                                    data-member-index="${index}"
                                    value="${Math.min(100, Math.max(0, Number.parseInt(member.participationPercent, 10) || 100))}"
                                >
                            </td>
                        </tr>
                            `;
                        })()}
                    `).join("")}
                </tbody>
            </table>
        </div>
    ` : `<p class="analysis-empty">${emptyText}</p>`;
}

function isMonthSelectable(monthKey) {
    const selected = getVisibleSelectedMonths();

    if (!selected.length || selected.includes(monthKey)) {
        return true;
    }

    const firstMonth = Number(selected[0].slice(5, 7));
    const lastMonth = Number(selected[selected.length - 1].slice(5, 7));
    const month = Number(monthKey.slice(5, 7));

    return month === firstMonth - 1 || month === lastMonth + 1;
}

function buildMonthRange(startKey, endKey) {
    const startMonth = Number(startKey.slice(5, 7));
    const endMonth = Number(endKey.slice(5, 7));
    const year = startKey.slice(0, 4);
    const result = [];

    for (let month = startMonth; month <= endMonth; month += 1) {
        result.push(`${year}-${String(month).padStart(2, "0")}`);
    }

    return result;
}

function getNextMonthSelection(clickedKey) {
    const selected = getVisibleSelectedMonths();

    if (!selected.length) {
        return [clickedKey];
    }

    const first = selected[0];
    const last = selected[selected.length - 1];

    if (selected.includes(clickedKey)) {
        if (selected.length === 1) {
            return [];
        }

        if (clickedKey === first) {
            return selected.slice(1);
        }

        if (clickedKey === last) {
            return selected.slice(0, -1);
        }

        return [clickedKey];
    }

    if (clickedKey < first) {
        return buildMonthRange(clickedKey, last);
    }

    if (clickedKey > last) {
        return buildMonthRange(first, clickedKey);
    }

    return buildMonthRange(first, clickedKey);
}

async function loadMonthWorkdays(year) {
    if (!year || state.monthWorkdaysByYear[year] || state.monthWorkdaysLoadingYear === year) {
        return;
    }

    state.monthWorkdaysLoadingYear = year;
    renderMonths();

    try {
        const payload = await fetchJson(`/api/calendar/month-workdays?year=${year}`);
        state.monthWorkdaysByYear[String(year)] = Object.fromEntries(
            (payload.months || []).map(item => [item.key, item.workingDays])
        );
    } catch (error) {
        setStatus(error.message, true);
    } finally {
        state.monthWorkdaysLoadingYear = null;
        renderMonths();
        renderBulkButtons();
    }
}

function invalidateAnalysis() {
    state.analysis = null;
}

function syncExpandedStep() {
    const maxUnlockedStep = getCurrentStepIndex() + 1;

    if (!state.expandedStep || state.expandedStep < 1) {
        state.expandedStep = 1;
        return;
    }

    if (state.expandedStep > maxUnlockedStep) {
        state.expandedStep = maxUnlockedStep;
    }
}

function getStepStates() {
    const hasData = Boolean(state.workflow.uploaded);
    const hasTeam = Boolean(state.selection.teamKey);
    const hasDepartments = state.selection.departments.length > 0;
    const hasEmployees = state.selection.employeeIds.length > 0;
    const hasMonths = state.selection.months.length > 0;
    const hasAnalysis = Boolean(state.analysis);

    return [
        hasData,
        hasTeam,
        hasDepartments,
        hasEmployees,
        hasMonths,
        hasAnalysis,
        hasAnalysis
    ];
}

function getCurrentStepIndex() {
    const completed = getStepStates();
    const firstPending = completed.findIndex(item => !item);
    return firstPending === -1 ? completed.length - 1 : firstPending;
}

function renderHero() {
    const hasUploadedFile = Boolean(state.workflow.uploaded);
    const cards = [
        {
            label: "Сотрудники",
            value: hasUploadedFile ? (state.vacations?.employees?.length || 0) : "—"
        },
        {
            label: "Подразделения",
            value: hasUploadedFile ? (state.vacations?.departments?.length || 0) : "—"
        }
    ];

    elements.heroStats.innerHTML = cards.map(card => `
        <article class="summary-card">
            <small>${card.label}</small>
            <strong>${card.value}</strong>
        </article>
    `).join("");
}

function renderStepper() {
    const titles = [
        "Файл",
        "Сохранение",
        "Подразделения",
        "Сотрудники",
        "Период",
        "Анализ",
        "Экспорт"
    ];
    const notes = [
        "Импорт Excel",
        "Выбор команды",
        "Отбор команд",
        "Отметка людей",
        "Выбрать месяцы",
        "Проверка часов",
        "Скачивание плана"
    ];
    const completed = getStepStates();
    const current = getCurrentStepIndex();

    elements.stepper.innerHTML = titles.map((title, index) => {
        const stateClass = completed[index] ? "complete" : index === current ? "current" : "pending";
        return `
            <div class="progress-item ${stateClass}">
                <div class="progress-badge">${index + 1}</div>
                <div class="step-summary">
                    <strong>${title}</strong>
                    <small>${notes[index]}</small>
                </div>
            </div>
        `;
    }).join("");

    document.querySelectorAll(".wizard-card").forEach((card, index) => {
        const stepNumber = index + 1;
        const disabled = index > current;
        const isExpanded = state.expandedStep === stepNumber;
        const statusClass = completed[index] ? "status-complete" : index === current ? "status-current" : "status-pending";
        card.classList.toggle("disabled", disabled);
        card.classList.toggle("is-expanded", isExpanded);
        card.classList.toggle("is-collapsed", !isExpanded);
        card.classList.remove("status-complete", "status-current", "status-pending");
        card.classList.add(statusClass);
        const pill = document.getElementById(`pill-step-${index + 1}`);
        pill.className = `state-pill ${completed[index] ? "complete" : index === current ? "current" : "pending"}`;
        pill.textContent = completed[index] ? "Готово" : index === current ? "В работе" : "Ожидание";
    });
}

function renderDepartments() {
    const items = state.vacations?.departments || [];
    elements.departmentList.innerHTML = items.length ? items.map(department => `
        <label class="chip department-tile ${state.selection.departments.includes(department) ? "active" : ""}">
            <input class="tile-check-input" type="checkbox" data-action="toggle-department" data-value="${department}" ${state.selection.departments.includes(department) ? "checked" : ""}>
            <span class="tile-checkbox ${state.selection.departments.includes(department) ? "checked" : ""}" aria-hidden="true"></span>
            <span class="tile-label">${department}</span>
        </label>
    `).join("") : '<p class="analysis-empty">После загрузки файла здесь появятся подразделения.</p>';
}

function renderWorkflowTeams() {
    const teams = getSettingsTeams(state.settings);
    elements.workflowTeamList.innerHTML = teams.length ? teams.map(team => `
        <label class="employee-tile team-choice-tile ${state.selection.teamKey === team.key ? "active" : ""}">
            <input class="tile-check-input" type="radio" name="workflow-team" data-action="select-workflow-team" value="${team.key}" ${state.selection.teamKey === team.key ? "checked" : ""}>
            <span class="tile-checkbox tile-radio ${state.selection.teamKey === team.key ? "checked" : ""}" aria-hidden="true"></span>
            <div class="employee-meta">
                <strong>${team.name}</strong>
                <span>Состав будет загружен из сохранённых данных команды</span>
            </div>
        </label>
    `).join("") : '<p class="analysis-empty">Сначала создайте хотя бы одну команду в настройках.</p>';
    if (elements.workflowTeamPreview) {
        elements.workflowTeamPreview.dataset.tooltip = "Состав команды сохраняется при переходе на этап «Период».";
        elements.workflowTeamPreview.innerHTML = "";
    }

    if (elements.workflowTeamWarning) {
        const warning = state.workflowTeamWarning;
        elements.workflowTeamWarning.innerHTML = warning && warning.teamKey === state.selection.teamKey ? `
            <div class="workflow-warning-block">
                <strong>В текущем файле отпусков не найдены нужные данные.</strong>
                <p>Не найдены записи для команды «${warning.teamName}»:</p>
                <ul class="workflow-warning-list">
                    ${warning.missingMembers.map(member => `
                        <li>${member.department} / ${member.position} / ${member.fullName}</li>
                    `).join("")}
                </ul>
                <div class="workflow-warning-actions">
                    <button class="ghost-button" data-action="refresh-team-members" data-value="${warning.teamKey}" type="button">Обновить</button>
                    <button class="ghost-button" data-action="clear-team-members" data-value="${warning.teamKey}" type="button">Сбросить</button>
                </div>
            </div>
        ` : "";
    }
}

function roleNameForEmployee(employeeId) {
    const employee = state.vacations?.employees?.find(item => item.id === employeeId);
    if (employee?.position) {
        return employee.position;
    }

    const key = state.settings?.userAssignments?.[employeeId];
    return state.settings?.roles?.find(role => role.key === key)?.name || "Не указана";
}

function createRoleKey() {
    return `role_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createCategoryKey() {
    return `category_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createTeamKey() {
    return `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createRoleGroupKey() {
    return `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureActiveTeamPanel(teamKey) {
    if (!state.activeTeamPanels[teamKey]) {
        state.activeTeamPanels[teamKey] = "time";
    }

    return state.activeTeamPanels[teamKey];
}

function getCurrentDateLabel() {
    return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(new Date());
}

function normalizeComparable(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function createEmptyCategory() {
    return {
        key: createCategoryKey(),
        label: "",
        hours: "",
        description: ""
    };
}

function createEmptyRole() {
    const firstCategory = createEmptyCategory();
    return {
        key: createRoleKey(),
        name: "",
        summaryLabel: "",
        detailTotalLabel: "",
        sprintHours: 0,
        primaryCategoryKey: firstCategory.key,
        categories: [firstCategory],
        primaryLabel: "",
        primaryHours: "",
        primaryDescription: "",
        secondaryLabel: "",
        secondaryHours: "",
        secondaryDescription: "",
        extraLabel: "",
        extraHours: "",
        extraDescription: ""
    };
}

function createEmptyRoleGroup(name = "Роли") {
    return {
        key: createRoleGroupKey(),
        name,
        summaryLabel: name,
        detailTotalLabel: `Итого ${name}`,
        roleKeys: []
    };
}

function createEmptyTeam(index = 1) {
    return {
        key: createTeamKey(),
        name: `Команда ${index}`,
        groupKeys: [],
        members: [],
        distribution: createDefaultDistribution()
    };
}

function getDefaultRoleGroupDefinitions() {
    return [
        {
            key: "analysts",
            name: "Аналитики",
            summaryLabel: "Аналитики",
            detailTotalLabel: "Итого Аналитики"
        },
        {
            key: "development",
            name: "Разработка",
            summaryLabel: "Разработка",
            detailTotalLabel: "Итого Разработчики"
        },
        {
            key: "testing",
            name: "Тестирование",
            summaryLabel: "Тестирование",
            detailTotalLabel: "Итого Тестировщики"
        }
    ];
}

function getDefaultTeamDefinitions(roleGroups = []) {
    return [
        {
            key: "team_primary",
            name: "Команда 1",
            groupKeys: roleGroups.map(group => group.key)
        }
    ];
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

function ensureRoleGroups(draft) {
    if (!draft) {
        return [];
    }

    const defaults = getDefaultRoleGroupDefinitions();
    const validRoleKeys = new Set((draft.roles || []).map(role => role.key));
    const assignedRoleKeys = new Set();
    const sourceGroups = Array.isArray(draft.roleGroups) && draft.roleGroups.length
        ? draft.roleGroups
        : defaults;

    draft.roleGroups = sourceGroups.map((group, index) => {
        const fallback = defaults.find(item => item.key === group.key) || defaults[index] || defaults[0];
        const roleKeys = [];

        (group.roleKeys || []).forEach(roleKey => {
            if (!validRoleKeys.has(roleKey) || assignedRoleKeys.has(roleKey)) {
                return;
            }

            assignedRoleKeys.add(roleKey);
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

    (draft.roles || []).forEach(role => {
        if (assignedRoleKeys.has(role.key)) {
            return;
        }

        const targetKey = inferRoleGroupKey(role);
        const targetGroup = draft.roleGroups.find(group => group.key === targetKey) || draft.roleGroups[0];
        if (targetGroup) {
            targetGroup.roleKeys.push(role.key);
            assignedRoleKeys.add(role.key);
        }
    });

    return draft.roleGroups;
}

function addEmptyRoleToTeam(teamKey) {
    const teams = ensureTeams(state.settingsDraft);
    const roleGroups = ensureRoleGroups(state.settingsDraft);
    const targetTeam = teams.find(team => team.key === teamKey);

    if (!targetTeam) {
        return null;
    }

    let targetGroup = targetTeam.groupKeys
        .map(groupKey => roleGroups.find(group => group.key === groupKey))
        .find(Boolean);

    if (!targetGroup) {
        targetGroup = createEmptyRoleGroup("Роли");
        roleGroups.push(targetGroup);
        targetTeam.groupKeys.push(targetGroup.key);
    }

    const nextRole = createEmptyRole();
    state.settingsDraft.roles.push(nextRole);
    targetGroup.roleKeys.push(nextRole.key);
    state.expandedRoleKey = nextRole.key;
    ensureRoleSectionState(nextRole.key)[nextRole.categories[0].key] = true;
    state.activeTeamPanels[targetTeam.key] = "roles";
    return nextRole;
}

function validationIdForTeam(teamKey, field) {
    return `team:${teamKey}:${field}`;
}

function ensureTeams(draft) {
    if (!draft) {
        return [];
    }

    const roleGroups = ensureRoleGroups(draft);
    const defaults = getDefaultTeamDefinitions(roleGroups);
    const validGroupKeys = new Set(roleGroups.map(group => group.key));
    const assignedGroupKeys = new Set();
    const sourceTeams = Array.isArray(draft.teams) && draft.teams.length
        ? draft.teams
        : defaults;

    draft.teams = sourceTeams.map((team, index) => {
        const fallback = defaults[index] || defaults[0] || createEmptyTeam(index + 1);
        const groupKeys = [];

        (team.groupKeys || []).forEach(groupKey => {
            if (!validGroupKeys.has(groupKey) || assignedGroupKeys.has(groupKey)) {
                return;
            }

            assignedGroupKeys.add(groupKey);
            groupKeys.push(groupKey);
        });

        return {
            key: team.key || fallback.key || createTeamKey(),
            name: team.name || fallback.name || `Команда ${index + 1}`,
            groupKeys,
            members: Array.isArray(team.members) ? deepClone(team.members) : [],
            distribution: createDefaultDistribution(team.distribution || fallback.distribution || draft.distribution || state.settings?.distribution || {})
        };
    });

    roleGroups.forEach(group => {
        if (assignedGroupKeys.has(group.key)) {
            return;
        }

        const targetTeam = draft.teams[0] || createEmptyTeam(1);
        if (!draft.teams.length) {
            draft.teams.push(targetTeam);
        }
        ensureTeamDistribution(targetTeam, draft);
        targetTeam.groupKeys.push(group.key);
        assignedGroupKeys.add(group.key);
    });

    return draft.teams;
}

function findRoleGroupByRoleKey(draft, roleKey) {
    ensureRoleGroups(draft);
    return draft.roleGroups.find(group => group.roleKeys.includes(roleKey)) || null;
}

function cloneTeamWithContents(draft, sourceTeam) {
    const roleGroups = ensureRoleGroups(draft);
    const roleMap = new Map((draft.roles || []).map(role => [role.key, role]));
    const groupMap = new Map(roleGroups.map(group => [group.key, group]));
    const clonedRoleKeysBySource = new Map();
    const clonedGroups = [];

    sourceTeam.groupKeys.forEach(groupKey => {
        const sourceGroup = groupMap.get(groupKey);
        if (!sourceGroup) {
            return;
        }

        const clonedRoleKeys = sourceGroup.roleKeys.map(roleKey => {
            if (clonedRoleKeysBySource.has(roleKey)) {
                return clonedRoleKeysBySource.get(roleKey);
            }

            const sourceRole = roleMap.get(roleKey);
            if (!sourceRole) {
                return null;
            }

            const clonedCategories = ensureRoleCategories(deepClone(sourceRole)).map(category => ({
                ...category,
                key: createCategoryKey()
            }));
            const categoryKeyMap = new Map(
                ensureRoleCategories(sourceRole).map((category, index) => [category.key, clonedCategories[index]?.key || clonedCategories[0]?.key])
            );
            const clonedRole = deepClone(sourceRole);
            clonedRole.key = createRoleKey();
            clonedRole.categories = clonedCategories;
            clonedRole.primaryCategoryKey = categoryKeyMap.get(sourceRole.primaryCategoryKey) || clonedCategories[0]?.key || "";
            syncComputedRoleFields(clonedRole);
            draft.roles.push(clonedRole);
            clonedRoleKeysBySource.set(roleKey, clonedRole.key);
            return clonedRole.key;
        }).filter(Boolean);

        const clonedGroup = {
            ...deepClone(sourceGroup),
            key: `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            roleKeys: clonedRoleKeys
        };
        draft.roleGroups.push(clonedGroup);
        clonedGroups.push(clonedGroup);
    });

    const nextTeam = {
        key: createTeamKey(),
        name: `${sourceTeam.name} ${getCurrentDateLabel()}`,
        groupKeys: clonedGroups.map(group => group.key),
        members: deepClone(sourceTeam.members || []),
        distribution: createDefaultDistribution(ensureTeamDistribution(sourceTeam, draft))
    };

    return {
        team: nextTeam,
        firstRoleKey: clonedGroups[0]?.roleKeys?.[0] || null
    };
}

function validationIdForRole(roleKey, field) {
    return `role:${roleKey}:${field}`;
}

function validationIdForDistribution(teamKey, key) {
    if (key === undefined) {
        return `distribution:${teamKey}`;
    }

    return `distribution:${teamKey}:${key}`;
}

function validationIdForCalendar(key) {
    return `calendar:${key}`;
}

function validationIdForMisc(key) {
    return `misc:${key}`;
}

function ensureDistributionState() {
    if (!state.expandedDistributionSections) {
        state.expandedDistributionSections = {
            business: true,
            internal: true
        };
    }

    return state.expandedDistributionSections;
}

function roundDistributionValue(value) {
    return Math.round((Number(value) || 0) * 10000) / 10000;
}

function createDefaultDistribution(base = {}) {
    const distribution = {
        total: Number(base?.total) || 0,
        business: Number(base?.business) || 0,
        keyTasks: Number(base?.keyTasks) || 0,
        support: Number(base?.support) || 0,
        internal: Number(base?.internal) || 0,
        architecture: Number(base?.architecture) || 0,
        other: Number(base?.other) || 0
    };

    syncComputedDistributionFields(distribution);
    return distribution;
}

function ensureTeamDistribution(team, draft = state.settingsDraft) {
    if (!team) {
        return createDefaultDistribution(draft?.distribution || state.settings?.distribution || {});
    }

    team.distribution = createDefaultDistribution(team.distribution || draft?.distribution || state.settings?.distribution || {});
    return team.distribution;
}

function syncComputedDistributionFields(distribution) {
    distribution.keyTasks = roundDistributionValue(distribution.keyTasks);
    distribution.support = roundDistributionValue(distribution.support);
    distribution.architecture = roundDistributionValue(distribution.architecture);
    distribution.other = roundDistributionValue(distribution.other);
    distribution.business = roundDistributionValue(distribution.keyTasks + distribution.support);
    distribution.internal = roundDistributionValue(distribution.architecture + distribution.other);
    distribution.total = roundDistributionValue(distribution.business + distribution.internal);
}

function formatPercentValue(value) {
    const percent = (Number(value) || 0) * 100;
    if (Number.isInteger(percent)) {
        return String(percent);
    }

    return percent.toFixed(2).replace(/\.?0+$/, "");
}

function parsePercentValue(value) {
    const normalized = String(value || "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");

    if (!normalized) {
        return "";
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
        return "";
    }

    return roundDistributionValue(Math.max(0, parsed) / 100);
}

function normalizeRoleHoursInput(value) {
    const normalized = String(value || "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");

    if (!normalized) {
        return "";
    }

    const [integerPartRaw, decimalPartRaw = ""] = normalized.split(".");
    const integerPart = integerPartRaw.replace(/^0+(?=\d)/, "") || "0";
    const decimalPart = decimalPartRaw.replace(/[^\d]/g, "").slice(0, 1);

    return decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
}

function formatRoleHoursValue(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return "";
    }

    return parsed % 1 === 0 ? String(parsed) : parsed.toFixed(1);
}

function getComparableSettingsSnapshot(settings) {
    const snapshot = deepClone(settings || {});
    delete snapshot.updatedAt;
    return JSON.stringify(snapshot);
}

function buildCalendarFieldDefinitions(calendarApi) {
    const authType = calendarApi?.authType || "none";

    return [
        { key: "enabled", label: "Использовать API", type: "checkbox" },
        { key: "resourceName", label: "Системное имя ресурса", type: "text", required: true },
        { key: "displayName", label: "Отображаемое название", type: "text", required: true },
        { key: "baseUrl", label: "Базовый URL", type: "text", required: true },
        { key: "endpointPath", label: "Путь endpoint", type: "text", required: true },
        { key: "method", label: "HTTP-метод", type: "select", options: ["GET", "POST"], required: true },
        { key: "queryFromParam", label: "Параметр даты начала", type: "text", required: true },
        { key: "queryToParam", label: "Параметр даты окончания", type: "text", required: true },
        { key: "queryDelimiterParam", label: "Параметр разделителя", type: "text", required: true },
        { key: "queryDelimiterValue", label: "Значение разделителя", type: "text", required: true },
        { key: "successWorkdayValue", label: "Значение рабочего дня", type: "text", required: true },
        { key: "authType", label: "Тип авторизации", type: "select", options: ["none", "header", "query"], required: true },
        { key: "apiKeyParamName", label: authType === "header" ? "Имя заголовка API-ключа" : "Имя параметра API-ключа", type: "text", required: authType !== "none" },
        { key: "apiKey", label: "API-ключ", type: "password", required: authType !== "none" },
        { key: "country", label: "Код страны", type: "text" },
        { key: "timeoutMs", label: "Таймаут, мс", type: "number", required: true },
        { key: "fallbackMode", label: "Режим fallback", type: "select", options: ["weekends"], required: true },
        { key: "notes", label: "Описание / комментарий", type: "textarea" }
    ];
}

function buildMiscFieldDefinitions() {
    return [
        {
            key: "reportGroupingMode",
            label: "Формирование отчёта",
            type: "radio",
            required: true,
            options: [
                { value: "grouped", label: "По ролям" },
                { value: "ungrouped", label: "По должностям" }
            ]
        }
    ];
}

function formatCalendarSettingValue(key, value) {
    if (key === "queryDelimiterValue") {
        if (value === "\n") {
            return "\\n";
        }

        if (value === "\t") {
            return "\\t";
        }
    }

    return value ?? "";
}

function parseCalendarSettingValue(key, value) {
    if (key === "queryDelimiterValue") {
        if (value === "\\n") {
            return "\n";
        }

        if (value === "\\t") {
            return "\t";
        }
    }

    return value;
}

function isCalendarSettingFilled(key, value) {
    if (key === "queryDelimiterValue") {
        return String(value ?? "").length > 0;
    }

    return String(value ?? "").trim().length > 0;
}

function activateSettingsTab(tabName) {
    document.querySelectorAll(".drawer-tab").forEach(item => {
        item.classList.toggle("active", item.dataset.tab === tabName);
    });
    document.querySelectorAll(".drawer-panel").forEach(panel => {
        panel.classList.toggle("active", panel.dataset.panel === tabName);
    });
}

function validationIdForCategory(roleKey, categoryKey, field) {
    return `category:${roleKey}:${categoryKey}:${field}`;
}

function ensureRoleCategories(role) {
    if (Array.isArray(role.categories) && role.categories.length) {
        role.categories = role.categories.map(category => ({
            key: category.key || createCategoryKey(),
            label: category.label || "",
            hours: category.hours === 0 ? 0 : (category.hours || ""),
            description: category.description || ""
        }));
        if (!role.primaryCategoryKey || !role.categories.some(category => category.key === role.primaryCategoryKey)) {
            role.primaryCategoryKey = role.categories[0].key;
        }
        return role.categories;
    }

    const legacyCategories = [
        {
            key: createCategoryKey(),
            label: role.primaryLabel || "",
            hours: role.primaryHours === 0 ? 0 : (role.primaryHours || ""),
            description: role.primaryDescription || ""
        },
        {
            key: createCategoryKey(),
            label: role.secondaryLabel || "",
            hours: role.secondaryHours === 0 ? 0 : (role.secondaryHours || ""),
            description: role.secondaryDescription || ""
        },
        {
            key: createCategoryKey(),
            label: role.extraLabel || "",
            hours: role.extraHours === 0 ? 0 : (role.extraHours || ""),
            description: role.extraDescription || ""
        }
    ];

    role.categories = legacyCategories;
    role.primaryCategoryKey = legacyCategories[0].key;
    return role.categories;
}

function syncLegacyRoleFields(role) {
    const categories = ensureRoleCategories(role);
    const primary = categories.find(category => category.key === role.primaryCategoryKey) || categories[0];
    const secondaryCategories = categories.filter(category => category.key !== primary?.key);
    const [secondary, extra] = secondaryCategories;

    role.primaryLabel = primary?.label || "";
    role.primaryHours = Number(primary?.hours) || 0;
    role.primaryDescription = primary?.description || "";
    role.secondaryLabel = secondary?.label || "";
    role.secondaryHours = Number(secondary?.hours) || 0;
    role.secondaryDescription = secondary?.description || "";
    role.extraLabel = extra?.label || "";
    role.extraHours = Number(extra?.hours) || 0;
    role.extraDescription = extra?.description || "";
}

function getRoleSprintHours(role) {
    return ensureRoleCategories(role)
        .reduce((total, category) => total + (Number(category.hours) || 0), 0);
}

function ensureRoleSectionState(roleKey) {
    if (!state.expandedRoleSections[roleKey]) {
        state.expandedRoleSections[roleKey] = {};
    }

    return state.expandedRoleSections[roleKey];
}

function syncComputedRoleFields(role) {
    role.sprintHours = getRoleSprintHours(role);
    role.summaryLabel = role.name || "";
    role.detailTotalLabel = role.name ? `Итого ${role.name}` : "";
    syncLegacyRoleFields(role);
}

function renderTeamRoleGroupsMarkup(team, teamGroups, teams, roleGroups, roleMap) {
    return `
        <div class="team-groups">
            ${teamGroups.map((group, groupIndex) => {
                const groupRoles = group.roleKeys
                    .map(roleKey => roleMap.get(roleKey))
                    .filter(Boolean);

                return `
                    <section class="role-group-panel">
                        <div class="role-group-header">
                            <div class="role-group-title">
                                <span class="section-index">${groupIndex + 1}</span>
                                <div>
                                    <strong>${`Роль: ${group.name || "Новая роль"}`}</strong>
                                    <small>${groupRoles.length ? `Ролей в группе: ${groupRoles.length}` : "Пока без ролей"}</small>
                                </div>
                            </div>
                            <div class="role-card-actions">
                                <button class="settings-icon-button" data-action="remove-group" data-team="${team.key}" data-value="${group.key}" type="button" aria-label="Удалить группу" ${roleGroups.length === 1 ? "disabled" : ""}>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v7h-2v-7zm4 0h2v7h-2v-7zM7 10h2v7H7v-7zm1 10h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2z" fill="currentColor"/></svg>
                                </button>
                                <button class="settings-icon-button" data-action="move-group-up" data-team="${team.key}" data-value="${group.key}" type="button" aria-label="Поднять группу вверх" ${groupIndex === 0 ? "disabled" : ""}>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 6 6 6h-4v6h-4v-6H6l6-6z" fill="currentColor"/></svg>
                                </button>
                                <button class="settings-icon-button" data-action="move-group-down" data-team="${team.key}" data-value="${group.key}" type="button" aria-label="Опустить группу вниз" ${groupIndex === teamGroups.length - 1 ? "disabled" : ""}>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h4v6h4l-6 6-6-6h4V6z" fill="currentColor"/></svg>
                                </button>
                                <button class="settings-icon-button" data-action="move-group-prev-team" data-team="${team.key}" data-value="${group.key}" type="button" aria-label="Перенести группу в предыдущую команду" ${teams.findIndex(item => item.key === team.key) === 0 ? "disabled" : ""}>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6 1.5-1.5L11 12l4.5-4.5z" fill="currentColor"/></svg>
                                </button>
                                <button class="settings-icon-button" data-action="move-group-next-team" data-team="${team.key}" data-value="${group.key}" type="button" aria-label="Перенести группу в следующую команду" ${teams.findIndex(item => item.key === team.key) === teams.length - 1 ? "disabled" : ""}>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6-1.5 1.5L13 12l-4.5 4.5L10 18l6-6z" fill="currentColor"/></svg>
                                </button>
                                <button class="settings-icon-button" data-action="add-role" data-group="${group.key}" type="button" aria-label="Создать роль в группе">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor"/></svg>
                                </button>
                            </div>
                        </div>
                        <div class="role-group-body">
                            ${groupRoles.map((role, index) => {
                                const isExpanded = state.expandedRoleKey === role.key;
                                const sectionState = ensureRoleSectionState(role.key);
                                const invalid = field => state.invalidSettingsFields.has(validationIdForRole(role.key, field)) ? "invalid-field" : "";
                                syncComputedRoleFields(role);
                                const categories = ensureRoleCategories(role);

                                return `
                                    <article class="role-card-panel ${isExpanded ? "is-expanded" : "is-collapsed"}">
                                        <div class="role-card-header" data-action="toggle-role-card" data-value="${role.key}">
                                            <div class="role-card-title">
                                                <span class="section-index">${index + 1}</span>
                                                <strong>${`Должность: ${role.name || "Новая должность"}`}</strong>
                                            </div>
                                            <div class="role-card-actions">
                                                <button class="settings-icon-button" data-action="move-role-prev-group" data-group="${group.key}" data-value="${role.key}" type="button" aria-label="Перенести роль в предыдущую группу" ${teamGroups.findIndex(item => item.key === group.key) === 0 ? "disabled" : ""}>
                                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6 1.5-1.5L11 12l4.5-4.5z" fill="currentColor"/></svg>
                                                </button>
                                                <button class="settings-icon-button" data-action="move-role-next-group" data-group="${group.key}" data-value="${role.key}" type="button" aria-label="Перенести роль в следующую группу" ${teamGroups.findIndex(item => item.key === group.key) === teamGroups.length - 1 ? "disabled" : ""}>
                                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6-1.5 1.5L13 12l-4.5 4.5L10 18l6-6z" fill="currentColor"/></svg>
                                                </button>
                                                <button class="settings-icon-button" data-action="remove-role" data-group="${group.key}" data-value="${role.key}" type="button" aria-label="Удалить роль">
                                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v7h-2v-7zm4 0h2v7h-2v-7zM7 10h2v7H7v-7zm1 10h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2z" fill="currentColor"/></svg>
                                                </button>
                                                <button class="settings-icon-button" data-action="move-role-up" data-group="${group.key}" data-value="${role.key}" type="button" aria-label="Поднять роль вверх" ${index === 0 ? "disabled" : ""}>
                                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 6 6 6h-4v6h-4v-6H6l6-6z" fill="currentColor"/></svg>
                                                </button>
                                                <button class="settings-icon-button" data-action="move-role-down" data-group="${group.key}" data-value="${role.key}" type="button" aria-label="Опустить роль вниз" ${index === groupRoles.length - 1 ? "disabled" : ""}>
                                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h4v6h4l-6 6-6-6h4V6z" fill="currentColor"/></svg>
                                                </button>
                                                <button class="accordion-toggle" data-action="toggle-role-card" data-value="${role.key}" type="button" aria-label="Свернуть или развернуть роль"></button>
                                            </div>
                                        </div>
                                        <div class="role-card-body">
                                            <div class="role-common-grid">
                                                <label class="role-common-main-field">
                                                    <small>Название роли</small>
                                                    <input class="${invalid("name")}" data-field="role-name" data-role="${role.key}" data-validate-id="${validationIdForRole(role.key, "name")}" data-required-settings="true" value="${role.name}">
                                                </label>
                                                <label class="role-hours-field">
                                                    <small>Часов в спринте</small>
                                                    <input type="text" value="${formatRoleHoursValue(role.sprintHours)}" maxlength="5" inputmode="decimal" readonly>
                                                </label>
                                            </div>
                                            <div class="role-section-stack">
                                                ${categories.map((category, sectionIndex) => `
                                                    <section class="role-detail-card ${sectionState[category.key] !== false ? "is-expanded" : "is-collapsed"}">
                                                        <div class="role-detail-header" data-action="toggle-role-section" data-role="${role.key}" data-value="${category.key}">
                                                            <div class="role-detail-title">
                                                                <span class="section-index">${sectionIndex + 1}</span>
                                                                <strong>${`Вид работы: ${category.label || `Категория ${sectionIndex + 1}`}`}</strong>
                                                            </div>
                                                            <div class="role-card-actions role-detail-actions">
                                                                <button class="settings-icon-button" data-action="add-category" data-role="${role.key}" data-value="${category.key}" type="button" aria-label="Создать категорию">
                                                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor"/></svg>
                                                                </button>
                                                                <button class="settings-icon-button" data-action="remove-category" data-role="${role.key}" data-value="${category.key}" type="button" aria-label="Удалить категорию">
                                                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v7h-2v-7zm4 0h2v7h-2v-7zM7 10h2v7H7v-7zm1 10h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2z" fill="currentColor"/></svg>
                                                                </button>
                                                                <button class="settings-icon-button" data-action="move-category-up" data-role="${role.key}" data-value="${category.key}" type="button" aria-label="Поднять категорию вверх" ${sectionIndex === 0 ? "disabled" : ""}>
                                                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 6 6 6h-4v6h-4v-6H6l6-6z" fill="currentColor"/></svg>
                                                                </button>
                                                                <button class="settings-icon-button" data-action="move-category-down" data-role="${role.key}" data-value="${category.key}" type="button" aria-label="Опустить категорию вниз" ${sectionIndex === categories.length - 1 ? "disabled" : ""}>
                                                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h4v6h4l-6 6-6-6h4V6z" fill="currentColor"/></svg>
                                                                </button>
                                                                <button class="accordion-toggle" data-action="toggle-role-section" data-role="${role.key}" data-value="${category.key}" type="button" aria-label="Свернуть или развернуть блок"></button>
                                                            </div>
                                                        </div>
                                                        <div class="role-detail-body">
                                                            <label class="role-common-main-field">
                                                                <small>Название категории</small>
                                                                <input class="${state.invalidSettingsFields.has(validationIdForCategory(role.key, category.key, "label")) ? "invalid-field" : ""}" data-field="role-category-label" data-role="${role.key}" data-category="${category.key}" data-section="${category.key}" data-validate-id="${validationIdForCategory(role.key, category.key, "label")}" data-required-settings="true" value="${category.label}">
                                                            </label>
                                                            <label class="role-hours-field">
                                                                <small>Время, час</small>
                                                                <input type="text" maxlength="5" inputmode="decimal" class="${state.invalidSettingsFields.has(validationIdForCategory(role.key, category.key, "hours")) ? "invalid-field" : ""}" data-field="role-category-hours" data-role="${role.key}" data-category="${category.key}" data-section="${category.key}" data-validate-id="${validationIdForCategory(role.key, category.key, "hours")}" data-required-settings="true" value="${formatRoleHoursValue(category.hours)}">
                                                            </label>
                                                            <label class="role-category-radio">
                                                                <input type="radio" name="role-primary-${role.key}" data-field="role-category-primary" data-role="${role.key}" data-category="${category.key}" ${role.primaryCategoryKey === category.key ? "checked" : ""}>
                                                                <span>Основная деятельность</span>
                                                            </label>
                                                            <label class="role-detail-description">
                                                                <small>Описание категории</small>
                                                                <textarea class="${state.invalidSettingsFields.has(validationIdForCategory(role.key, category.key, "description")) ? "invalid-field" : ""}" data-field="role-category-description" data-role="${role.key}" data-category="${category.key}" data-section="${category.key}" data-validate-id="${validationIdForCategory(role.key, category.key, "description")}" data-required-settings="true">${category.description}</textarea>
                                                            </label>
                                                        </div>
                                                    </section>
                                                `).join("")}
                                            </div>
                                        </div>
                                    </article>
                                `;
                            }).join("") || '<div class="role-group-empty">Перенесите сюда роли верхнего уровня или создайте новую роль.</div>'}
                        </div>
                    </section>
                `;
            }).join("")}
        </div>
    `;
}

function renderEmployees() {
    const selectedDepartments = state.selection.departments;

    if (!selectedDepartments.length) {
        elements.employeeGroups.innerHTML = '<p class="analysis-empty">Сначала выберите подразделения.</p>';
        return;
    }

    const groups = selectedDepartments.map(department => {
        const employees = state.vacations.employees.filter(item => item.department === department);
        const activeCount = employees.filter(item => state.selection.employeeIds.includes(item.id)).length;
        const allSelected = employees.length > 0 && activeCount === employees.length;
        return `
            <section class="employee-group">
                <div class="section-head">
                    <div>
                        <h4>${department}</h4>
                    </div>
                    <button class="chip" data-action="select-department-employees" data-value="${department}">${allSelected ? "Снять выделение" : "Отметить всех"}</button>
                </div>
                <div class="employee-list">
                    ${employees.map(employee => `
                        <label class="employee-tile ${state.selection.employeeIds.includes(employee.id) ? "active" : ""}">
                            <input class="tile-check-input" type="checkbox" data-action="toggle-employee" data-value="${employee.id}" ${state.selection.employeeIds.includes(employee.id) ? "checked" : ""}>
                            <span class="tile-checkbox ${state.selection.employeeIds.includes(employee.id) ? "checked" : ""}" aria-hidden="true"></span>
                            <div class="employee-meta">
                                <strong>${employee.fullName}</strong>
                                <span>${roleNameForEmployee(employee.id)}</span>
                                <span>${getParticipationPercentForEmployee(employee)}%</span>
                            </div>
                        </label>
                    `).join("")}
                </div>
            </section>
        `;
    });

    elements.employeeGroups.innerHTML = groups.join("");
}

function renderMonths() {
    ensureCurrentYear();

    if (!state.currentYear) {
        elements.yearList.innerHTML = "";
        elements.monthList.innerHTML = '<p class="analysis-empty">Месяцы появятся после импорта графика отпусков.</p>';
        return;
    }

    const years = getAvailableYears();
    const workdaysMap = state.monthWorkdaysByYear[String(state.currentYear)] || {};
    const quarterLabels = ["I квартал", "II квартал", "III квартал", "IV квартал"];
    const selectedMonths = new Set(getVisibleSelectedMonths());
    const months = Array.from({ length: 12 }, (_, index) => {
        const monthNumber = String(index + 1).padStart(2, "0");
        const key = `${state.currentYear}-${monthNumber}`;
        return {
            key,
            workingDays: workdaysMap[key],
            selected: selectedMonths.has(key),
            selectable: isMonthSelectable(key)
        };
    });

    elements.yearList.innerHTML = years.map(year => `
        <button class="chip ${String(state.currentYear) === year ? "active" : ""}" data-action="toggle-year" data-value="${year}">
            ${year}
        </button>
    `).join("");

    elements.monthList.innerHTML = quarterLabels.map((quarterLabel, quarterIndex) => {
        const quarterMonths = months.slice(quarterIndex * 3, quarterIndex * 3 + 3);

        return `
            <div class="quarter-inline-label">${quarterLabel}</div>
            ${quarterMonths.map(item => `
                <label class="chip month-tile employee-tile ${item.selected ? "active" : ""} ${item.selectable ? "" : "disabled"}">
                    <input class="tile-check-input" type="checkbox" data-action="toggle-month" data-value="${item.key}" ${item.selected ? "checked" : ""} ${item.selectable ? "" : "disabled"}>
                    <span class="tile-checkbox ${item.selected ? "checked" : ""}" aria-hidden="true"></span>
                    <div class="month-meta">
                        <strong>${getMonthName(item.key)}</strong>
                        <span>${item.workingDays !== undefined ? `Рабочих дней: ${item.workingDays}` : state.monthWorkdaysLoadingYear === String(state.currentYear) ? "Загрузка..." : "Рабочих дней: —"}</span>
                    </div>
                </label>
            `).join("")}
        `;
    }).join("");

    void loadMonthWorkdays(String(state.currentYear));
}

function renderBulkButtons() {
    const departments = state.vacations?.departments || [];
    if (elements.bulkDepartmentsBtn) {
        const allDepartmentsSelected = departments.length > 0 && state.selection.departments.length === departments.length;
        elements.bulkDepartmentsBtn.textContent = allDepartmentsSelected ? "Снять выделение" : "Выделить все";
        elements.bulkDepartmentsBtn.disabled = departments.length === 0;
    }

    const visibleEmployees = (state.vacations?.employees || []).filter(item => state.selection.departments.includes(item.department));
    const allVisibleEmployeesSelected = visibleEmployees.length > 0
        && visibleEmployees.every(item => state.selection.employeeIds.includes(item.id));
    elements.bulkEmployeesBtn.textContent = allVisibleEmployeesSelected ? "Снять выделение" : "Выделить все";
    elements.bulkEmployeesBtn.disabled = visibleEmployees.length === 0;

    const visibleMonths = state.currentYear
        ? Array.from({ length: 12 }, (_, index) => `${state.currentYear}-${String(index + 1).padStart(2, "0")}`)
        : [];
    const allVisibleMonthsSelected = visibleMonths.length > 0
        && visibleMonths.every(item => state.selection.months.includes(item));
    elements.bulkMonthsBtn.textContent = allVisibleMonthsSelected ? "Снять выделение" : "Выделить все";
    elements.bulkMonthsBtn.disabled = visibleMonths.length === 0;
}

function renderAnalysis() {
    if (!state.analysis) {
        elements.analysisPanel.innerHTML = '<p class="analysis-empty">Нажмите «Анализ», чтобы увидеть итог по ролям, сотрудникам и неделям.</p>';
        return;
    }

    const visibleRoles = (state.analysis.roles || []).filter(role => (role.employeeCount || 0) > 0 || (role.periodTotal || 0) > 0);

    const summary = `
        <div class="analysis-grid">
            <article class="summary-card">
                <small>Период</small>
                <strong>${state.analysis.periodLabel}</strong>
            </article>
            <article class="summary-card">
                <small>Сотрудники</small>
                <strong>${state.analysis.stats.employees}</strong>
            </article>
            <article class="summary-card">
                <small>Недель</small>
                <strong>${state.analysis.stats.weeks}</strong>
            </article>
        </div>
    `;

    const rolesTable = `
        <table class="analysis-list">
            <thead>
                <tr><th>Роль</th><th>Сотрудников</th><th>Часов за период</th></tr>
            </thead>
            <tbody>
                ${visibleRoles.map(role => `
                    <tr>
                        <td>${role.name}</td>
                        <td>${role.employeeCount}</td>
                        <td>${role.periodTotal}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;

    const weeksTable = `
        <table class="mini-table">
            <thead>
                <tr><th>Спринт</th><th>Диапазон</th><th>Раб. дней</th></tr>
            </thead>
            <tbody>
                ${state.analysis.weeks.map(week => `
                    <tr>
                        <td>${week.sprintNumber ?? week.isoWeek}</td>
                        <td>${week.label}</td>
                        <td>${week.workingDays}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;

    elements.analysisPanel.innerHTML = `${summary}<div class="analysis-grid">${rolesTable}${weeksTable}</div>`;
}

function renderSettings() {
    const draft = state.settingsDraft;
    if (!draft) {
        return;
    }

    draft.misc = {
        reportGroupingMode: "grouped",
        sprintDurationDays: 7,
        sprintStartDay: "monday",
        ...(draft.misc || {})
    };

    if (!draft.roles.length) {
        state.expandedRoleKey = null;
    } else if (!state.expandedRoleKey || !draft.roles.some(role => role.key === state.expandedRoleKey)) {
        state.expandedRoleKey = draft.roles[0].key;
    }
    const teams = ensureTeams(draft);
    elements.copyTopTeamBtn.disabled = teams.length === 0;
    if (!teams.length) {
        state.expandedTeamKey = null;
    } else if (!state.expandedTeamKey || !teams.some(team => team.key === state.expandedTeamKey)) {
        state.expandedTeamKey = teams[0].key;
    }
    const roleGroups = ensureRoleGroups(draft);
    const roleMap = new Map(draft.roles.map(role => [role.key, role]));
    teams.forEach(team => ensureActiveTeamPanel(team.key));
    elements.teamTabsBar.innerHTML = teams.map((team, index) => `
        <div class="team-tab-item ${state.expandedTeamKey === team.key ? "active" : ""}" data-team-tab-item="${team.key}" draggable="true">
            <button class="drawer-tab team-tab-button" data-action="select-team-tab" data-value="${team.key}" type="button">
                <span class="team-tab-label">${team.name || `Команда ${index + 1}`}</span>
            </button>
        </div>
    `).join("");

    const activeTeam = teams.find(team => team.key === state.expandedTeamKey) || teams[0] || null;
    const activeTeamGroups = activeTeam
        ? activeTeam.groupKeys.map(groupKey => roleGroups.find(group => group.key === groupKey)).filter(Boolean)
        : [];
    const activeTeamDistribution = activeTeam ? ensureTeamDistribution(activeTeam, draft) : createDefaultDistribution(draft.distribution);
    const activeTeamRoleKeys = new Set(activeTeamGroups.flatMap(group => group.roleKeys || []));
    const activeTeamRoles = draft.roles.filter(role => activeTeamRoleKeys.has(role.key));
    const activePanel = activeTeam ? ensureActiveTeamPanel(activeTeam.key) : "time";

    elements.roleCards.innerHTML = activeTeam ? `
        <section class="team-workspace panel-block">
            <div class="team-workspace-head">
                <div class="team-form">
                    <label class="role-common-main-field">
                        <small>Название команды</small>
                        <input class="${state.invalidSettingsFields.has(validationIdForTeam(activeTeam.key, "name")) ? "invalid-field" : ""}" data-field="team-name" data-team="${activeTeam.key}" data-validate-id="${validationIdForTeam(activeTeam.key, "name")}" data-required-settings="true" value="${activeTeam.name}">
                    </label>
                </div>
                <div class="team-content-actions">
                    <button class="settings-icon-button" data-action="remove-team" data-value="${activeTeam.key}" type="button" aria-label="Удалить команду" ${teams.length === 1 ? "disabled" : ""}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v7h-2v-7zm4 0h2v7h-2v-7zM7 10h2v7H7v-7zm1 10h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2z" fill="currentColor"/></svg>
                    </button>
                </div>
            </div>
            <div class="team-panel-tabs">
                <button class="drawer-tab team-panel-tab ${activePanel === "roles" ? "active" : ""}" data-action="select-team-panel" data-value="roles" type="button">Роли</button>
                <button class="drawer-tab team-panel-tab ${activePanel === "time" ? "active" : ""}" data-action="select-team-panel" data-value="time" type="button">Время</button>
                <button class="drawer-tab team-panel-tab ${activePanel === "members" ? "active" : ""}" data-action="select-team-panel" data-value="members" type="button">Состав</button>
            </div>
            <div class="team-panel-content">
                ${activePanel === "time" ? `
                    <div class="distribution-grid team-distribution-grid">
                        <div class="panel-block">
                            <div class="panel-head">
                                <h3>Распределение времени</h3>
                                <span class="distribution-total ${state.invalidSettingsFields.has(validationIdForDistribution(activeTeam?.key || "team", "total")) ? "is-invalid" : ""}">${formatPercentValue(activeTeamDistribution.total)}%</span>
                            </div>
                            <div id="distributionForm"></div>
                        </div>
                        <div class="panel-block">
                            <div class="panel-head">
                                <h3>Часы по ролям</h3>
                            </div>
                            <div id="roleSummaryTable"></div>
                        </div>
                    </div>
                ` : activePanel === "roles" ? `
                    <div class="team-roles-panel">
                        <div class="panel-toolbar panel-toolbar-between">
                            <p class="section-note panel-toolbar-note">Добавляйте роли кнопкой «+», задавайте им названия и при необходимости удаляйте через корзинку.</p>
                            <button class="settings-add-role" data-action="add-role-to-team" data-team="${activeTeam.key}" type="button" aria-label="Добавить роль">+</button>
                        </div>
                        ${activeTeamGroups.length
                            ? renderTeamRoleGroupsMarkup(activeTeam, activeTeamGroups, teams, roleGroups, roleMap)
                            : `
                                <div class="role-group-empty role-group-empty-standalone">
                                    Пока нет ролей. Нажмите «+», чтобы создать первую роль для команды.
                                </div>
                            `
                        }
                    </div>
                ` : `
                    <div class="readonly-team-table-block">
                        <div class="panel-toolbar panel-toolbar-between">
                            <p class="section-note panel-toolbar-note">Таблица заполняется при переходе на этап «Период» на главной странице и обновляется целиком при каждой новой пересборке состава команды.</p>
                            <button class="ghost-button" data-action="clear-team-members" data-value="${activeTeam.key}" type="button">Сброс</button>
                        </div>
                        <div id="settingsTeamMembersTable"></div>
                    </div>
                `}
            </div>
        </section>
    ` : '<div class="panel-block"><p class="analysis-empty">Добавьте команду, чтобы настроить роли и распределение времени.</p></div>';

    elements.teamTabsBar.querySelectorAll("[data-team-tab-item]").forEach(item => {
        item.addEventListener("dragstart", event => {
            draggedTeamKey = item.dataset.teamTabItem;
            item.classList.add("is-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", draggedTeamKey);
        });

        item.addEventListener("dragover", event => {
            if (!draggedTeamKey || draggedTeamKey === item.dataset.teamTabItem) {
                return;
            }

            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
        });

        item.addEventListener("drop", event => {
            event.preventDefault();
            const targetTeamKey = item.dataset.teamTabItem;
            if (!draggedTeamKey || draggedTeamKey === targetTeamKey) {
                return;
            }

            const teamsList = ensureTeams(state.settingsDraft);
            const fromIndex = teamsList.findIndex(team => team.key === draggedTeamKey);
            const toIndex = teamsList.findIndex(team => team.key === targetTeamKey);

            if (fromIndex === -1 || toIndex === -1) {
                return;
            }

            const [movedTeam] = teamsList.splice(fromIndex, 1);
            teamsList.splice(toIndex, 0, movedTeam);
            state.expandedTeamKey = movedTeam.key;
            renderSettings();
        });

        item.addEventListener("dragend", () => {
            draggedTeamKey = null;
            elements.teamTabsBar.querySelectorAll("[data-team-tab-item]").forEach(node => node.classList.remove("is-dragging"));
        });
    });

    const distributionState = ensureDistributionState();
    const distributionSections = [
        {
            key: "business",
            index: 1,
            title: "Задачи бизнеса",
            value: activeTeamDistribution.business,
            description: "Состоит из ключевых задач и поддержки.",
            fields: [
                { key: "keyTasks", label: "Ключевые задачи" },
                { key: "support", label: "Поддержка" }
            ]
        },
        {
            key: "internal",
            index: 2,
            title: "Внутренние задачи",
            value: activeTeamDistribution.internal,
            description: "Состоит из архитектуры и прочих задач.",
            fields: [
                { key: "architecture", label: "Архитектура" },
                { key: "other", label: "Прочие задачи" }
            ]
        }
    ];

    const distributionForm = document.getElementById("distributionForm");
    const roleSummaryTable = document.getElementById("roleSummaryTable");
    const settingsTeamMembersTable = document.getElementById("settingsTeamMembersTable");

    if (distributionForm) {
        distributionForm.innerHTML = `
        <div class="distribution-stack">
            ${distributionSections.map(section => `
                <section class="distribution-card ${distributionState[section.key] !== false ? "is-expanded" : "is-collapsed"}">
                    <div class="distribution-header" data-action="toggle-distribution-section" data-value="${section.key}">
                        <div class="distribution-title">
                            <span class="section-index">${section.index}</span>
                            <div>
                                <strong>${section.title}</strong>
                                <small>${section.description}</small>
                            </div>
                        </div>
                        <div class="distribution-actions">
                            <span class="distribution-total">${formatPercentValue(section.value)}%</span>
                            <button class="accordion-toggle" data-action="toggle-distribution-section" data-value="${section.key}" type="button" aria-label="Свернуть или развернуть блок"></button>
                        </div>
                    </div>
                    <div class="distribution-body">
                        <div class="distribution-fields-grid">
                            ${section.fields.map(field => `
                                <label class="distribution-field">
                                    <small>${field.label}</small>
                                    <div class="distribution-input-wrap">
                                        <input
                                            type="text"
                                            inputmode="decimal"
                                            class="${state.invalidSettingsFields.has(validationIdForDistribution(activeTeam?.key || "team", field.key)) ? "invalid-field" : ""}"
                                            data-field="distribution"
                                            data-team="${activeTeam?.key || ""}"
                                            data-key="${field.key}"
                                            data-validate-id="${validationIdForDistribution(activeTeam?.key || "team", field.key)}"
                                            data-required-settings="true"
                                            value="${formatPercentValue(activeTeamDistribution[field.key])}"
                                        >
                                        <span>%</span>
                                    </div>
                                </label>
                            `).join("")}
                        </div>
                    </div>
                </section>
            `).join("")}
        </div>
    `;
    }

    if (roleSummaryTable) {
        roleSummaryTable.innerHTML = `
        <div class="role-summary-table">
            <table>
                <thead>
                    <tr><th>Роль</th><th>Основные часы</th><th>Сопровождение</th></tr>
                </thead>
                <tbody>
                    ${activeTeamRoles.map(role => `
                        <tr>
                            <td>${role.name}</td>
                            <td>${role.primaryHours}</td>
                            <td>${role.secondaryHours}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
    }

    if (settingsTeamMembersTable) {
        renderTeamMembersTable(
            settingsTeamMembersTable,
            activeTeam?.members || [],
            "После анализа здесь появится сохранённый состав команды."
        );
    }

    const calendarApi = draft.calendarApi || {};
    const calendarFields = buildCalendarFieldDefinitions(calendarApi);
    const calendarEnabled = Boolean(calendarApi.enabled);
    const misc = draft.misc || {};
    const miscFields = buildMiscFieldDefinitions();

    elements.calendarForm.innerHTML = `
        <div class="calendar-config-grid">
            ${calendarFields.map(field => {
                const invalidClass = state.invalidSettingsFields.has(validationIdForCalendar(field.key)) ? "invalid-field" : "";

                if (field.type === "checkbox") {
                    return `
                        <label class="calendar-toggle-field">
                            <input type="checkbox" data-field="calendar-setting" data-key="${field.key}" ${calendarApi[field.key] ? "checked" : ""}>
                            <span>${field.label}</span>
                        </label>
                    `;
                }

                if (field.type === "textarea") {
                    return `
                        <label class="calendar-field calendar-field-full">
                            <small>${field.label}</small>
                            <textarea class="${invalidClass}" data-field="calendar-setting" data-key="${field.key}" ${calendarEnabled && field.required ? `data-required-settings="true" data-validate-id="${validationIdForCalendar(field.key)}"` : ""}>${calendarApi[field.key] || ""}</textarea>
                        </label>
                    `;
                }

                if (field.type === "select") {
                    return `
                        <label class="calendar-field">
                            <small>${field.label}</small>
                            <select class="${invalidClass}" data-field="calendar-setting" data-key="${field.key}" ${calendarEnabled && field.required ? `data-required-settings="true" data-validate-id="${validationIdForCalendar(field.key)}"` : ""}>
                                ${field.options.map(option => `
                                    <option value="${option}" ${String(calendarApi[field.key] || "") === option ? "selected" : ""}>${option}</option>
                                `).join("")}
                            </select>
                        </label>
                    `;
                }

                return `
                    <label class="calendar-field">
                        <small>${field.label}</small>
                        <input
                            class="${invalidClass}"
                            type="${field.type}"
                            data-field="calendar-setting"
                            data-key="${field.key}"
                            ${calendarEnabled && field.required ? `data-required-settings="true" data-validate-id="${validationIdForCalendar(field.key)}"` : ""}
                            value="${formatCalendarSettingValue(field.key, calendarApi[field.key])}"
                        >
                    </label>
                `;
            }).join("")}
        </div>
    `;

    elements.miscForm.innerHTML = `
        <div class="calendar-config-grid">
            ${miscFields.map(field => {
                const invalidClass = state.invalidSettingsFields.has(validationIdForMisc(field.key)) ? "invalid-field" : "";

                if (field.type === "radio") {
                    return `
                        <div class="misc-radio-group">
                            <small>${field.label}</small>
                            <div class="misc-radio-options">
                                ${field.options.map(option => `
                                    <label class="misc-radio-option">
                                        <input
                                            type="radio"
                                            class="${invalidClass}"
                                            data-field="misc-setting"
                                            data-key="${field.key}"
                                            ${field.required ? `data-required-settings="true" data-validate-id="${validationIdForMisc(field.key)}"` : ""}
                                            value="${option.value}"
                                            ${String(misc[field.key] || "") === option.value ? "checked" : ""}
                                        >
                                        <span>${option.label}</span>
                                    </label>
                                `).join("")}
                            </div>
                        </div>
                    `;
                }

                if (field.type === "select") {
                    return `
                        <label class="calendar-field">
                            <small>${field.label}</small>
                            <select class="${invalidClass}" data-field="misc-setting" data-key="${field.key}" ${field.required ? `data-required-settings="true" data-validate-id="${validationIdForMisc(field.key)}"` : ""}>
                                ${field.options.map(option => `
                                    <option value="${option.value}" ${String(misc[field.key] || "") === option.value ? "selected" : ""}>${option.label}</option>
                                `).join("")}
                            </select>
                        </label>
                    `;
                }

                return `
                    <label class="calendar-field">
                        <small>${field.label}</small>
                        <input
                            class="${invalidClass}"
                            type="${field.type}"
                            inputmode="${field.inputMode || ""}"
                            maxlength="${field.maxLength || ""}"
                            data-field="misc-setting"
                            data-key="${field.key}"
                            ${field.required ? `data-required-settings="true" data-validate-id="${validationIdForMisc(field.key)}"` : ""}
                            value="${misc[field.key] ?? ""}"
                        >
                    </label>
                `;
            }).join("")}
        </div>
    `;

}

function render() {
    syncExpandedStep();
    renderHero();
    renderWorkflowTeams();
    renderDepartments();
    renderEmployees();
    renderMonths();
    renderBulkButtons();
    renderAnalysis();
    renderStepper();
    renderSettings();
    elements.uploadMeta.textContent = state.vacations?.sourceFileName
        ? `Текущий файл: ${state.vacations.sourceFileName}`
        : "Будет сохранён в JSON и использован для анализа.";
    applyTooltips();
}

function toggleSelection(list, value) {
    return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

async function loadBootstrap() {
    const payload = await fetchJson("/api/bootstrap");
    state.settings = payload.settings;
    state.settingsDraft = deepClone(payload.settings);
    state.vacations = payload.vacations;
    state.workflow.uploaded = Boolean(payload.vacations?.employees?.length);
    state.invalidSettingsFields = new Set();
    state.activeTeamPanels = {};
    state.expandedRoleSections = {};
    state.expandedDistributionSections = { business: true, internal: true };
    state.workflowTeamWarning = null;
    state.monthWorkdaysByYear = {};
    state.monthWorkdaysLoadingYear = null;
    state.teamMembersSorts = {};
    state.selection = { teamKey: "", departments: [], employeeIds: [], months: [] };
    ensureCurrentYear();
    render();
    if (state.currentYear) {
        void loadMonthWorkdays(String(state.currentYear));
    }
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append("file", file);
    setStatus("Загружаю файл и обновляю JSON...");

    const payload = await fetchJson("/api/upload-vacations", {
        method: "POST",
        body: formData
    });

    state.vacations = payload.vacations;
    state.settings = payload.settings;
    state.settingsDraft = deepClone(payload.settings);
    state.workflow.uploaded = true;
    state.invalidSettingsFields = new Set();
    state.activeTeamPanels = {};
    state.expandedRoleSections = {};
    state.expandedDistributionSections = { business: true, internal: true };
    state.workflowTeamWarning = null;
    state.monthWorkdaysByYear = {};
    state.monthWorkdaysLoadingYear = null;
    state.selection = { teamKey: "", departments: [], employeeIds: [], months: [] };
    state.currentYear = null;
    ensureCurrentYear();
    invalidateAnalysis();
    state.expandedStep = 2;
    render();
    scrollExpandedStepIntoView();
    if (state.currentYear) {
        void loadMonthWorkdays(String(state.currentYear));
    }
    setStatus("Файл загружен. Выберите команду для сохранения состава.");
}

async function runAnalysis() {
    setStatus("Выполняю анализ...");
    const selection = getNormalizedSelection();
    state.selection.teamKey = selection.teamKey;
    state.selection.months = [...selection.months];
    const payload = await fetchJson("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection)
    });
    state.analysis = payload;
    if (payload.settings) {
        state.settings = payload.settings;
        state.settingsDraft = deepClone(payload.settings);
    }
    render();
    setStatus("Анализ готов. Можно формировать файл.");
}

async function saveWorkflowTeamMembers() {
    const teamKey = String(state.selection.teamKey || "").trim();
    if (!teamKey || !state.selection.employeeIds.length) {
        return;
    }

    const existingMembers = getTeamMembers(teamKey, state.settings);
    const normalize = value => normalizeComparable(value);
    const members = (state.vacations?.employees || [])
        .filter(employee => state.selection.employeeIds.includes(employee.id))
        .map(employee => ({
            department: employee.department,
            position: employee.position,
            role: (() => {
                const matchedMember = existingMembers.find(member => (
                    normalize(member.department) === normalize(employee.department)
                    && normalize(member.position) === normalize(employee.position)
                    && normalize(member.fullName) === normalize(employee.fullName)
                ));
                return String(matchedMember?.role || employee.position || "").trim();
            })(),
            fullName: employee.fullName,
            participationPercent: (() => {
                const matchedMember = existingMembers.find(member => (
                    normalize(member.department) === normalize(employee.department)
                    && normalize(member.position) === normalize(employee.position)
                    && normalize(member.fullName) === normalize(employee.fullName)
                ));
                return Math.min(100, Math.max(0, Number.parseInt(matchedMember?.participationPercent, 10) || 100));
            })()
        }));

    const payload = await fetchJson("/api/team-members/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            teamKey,
            employeeIds: state.selection.employeeIds,
            members
        })
    });

    state.settings = payload.settings;
    state.settingsDraft = deepClone(payload.settings);
    state.workflowTeamWarning = null;
    setStatus("Состав выбранной команды сохранён.");
}

async function clearWorkflowTeamMembers(teamKey) {
    const payload = await fetchJson("/api/team-members/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamKey })
    });

    state.settings = payload.settings;
    state.settingsDraft = deepClone(payload.settings);
    state.workflowTeamWarning = null;
    render();
    const teamName = payload.team?.name || getSettingsTeams(state.settings).find(team => team.key === teamKey)?.name || "Без названия";
    const message = `Информация по составу команды ${teamName} в настройках во вкладке "Состав" удалена.`;
    setStatus(message);
    openInfoDialog("Состав команды", message);
}

async function refreshWorkflowTeamMembers(teamKey) {
    const payload = await fetchJson("/api/team-members/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamKey })
    });

    state.settings = payload.settings;
    state.settingsDraft = deepClone(payload.settings);
    applyWorkflowTeamSelection(teamKey);
    render();
    const teamName = payload.team?.name || getSettingsTeams(state.settings).find(team => team.key === teamKey)?.name || "Без названия";
    const message = `Данные по команде ${teamName} обновлены.`;
    setStatus(message);
    openInfoDialog("Состав команды", message);
}

async function exportPlan() {
    setStatus("Формирую Excel...");
    const selection = getNormalizedSelection();
    state.selection.months = [...selection.months];
    const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection)
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Не удалось выгрузить файл.");
    }

    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const fileName = decodeURIComponent((disposition.split("filename*=UTF-8''")[1] || "resource_plan.xlsx").replace(/"/g, ""));
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("Файл сформирован и скачан.");
    openInfoDialog("Скачивание завершено", `Файл ${fileName} успешно скачан.`);
}

function openDrawer() {
    elements.settingsDrawer.classList.add("open");
    elements.drawerBackdrop.classList.remove("hidden");
}

function closeDrawer() {
    elements.settingsDrawer.classList.remove("open");
    elements.drawerBackdrop.classList.add("hidden");
}

function openInfoDialog(title, message) {
    elements.infoDialogTitle.textContent = title;
    elements.infoDialogMessage.textContent = message;
    elements.infoDialogBackdrop.classList.remove("hidden");
    elements.infoDialog.classList.remove("hidden");
}

function closeInfoDialog() {
    elements.infoDialogBackdrop.classList.add("hidden");
    elements.infoDialog.classList.add("hidden");
}

function syncDraftFromField(target) {
    if (!state.settingsDraft) {
        return;
    }

    const { field } = target.dataset;
    if (!field) {
        return;
    }

    if (field === "distribution") {
        const teams = ensureTeams(state.settingsDraft);
        const targetTeam = teams.find(item => item.key === target.dataset.team)
            || teams.find(item => item.key === state.expandedTeamKey)
            || teams[0];
        const distribution = ensureTeamDistribution(targetTeam, state.settingsDraft);

        distribution[target.dataset.key] = parsePercentValue(target.value);
        syncComputedDistributionFields(distribution);
        if (target.dataset.validateId) {
            state.invalidSettingsFields.delete(target.dataset.validateId);
        }
        renderSettings();
        return;
    }

    if (field === "calendar-setting") {
        const key = target.dataset.key;
        const nextValue = target.type === "checkbox"
            ? target.checked
            : target.type === "number"
                ? Number(target.value) || 0
                : parseCalendarSettingValue(key, target.value);

        state.settingsDraft.calendarApi[key] = nextValue;
        if (target.dataset.validateId) {
            state.invalidSettingsFields.delete(target.dataset.validateId);
        }
        renderSettings();
        return;
    }

    if (field === "misc-setting") {
        const key = target.dataset.key;
        state.settingsDraft.misc = {
            reportGroupingMode: "grouped",
            sprintDurationDays: 7,
            sprintStartDay: "monday",
            ...(state.settingsDraft.misc || {})
        };
        const nextValue = key === "sprintDurationDays"
            ? String(target.value || "").replace(/[^\d]/g, "").slice(0, 1)
            : target.value;

        state.settingsDraft.misc[key] = nextValue;
        if (target.dataset.validateId) {
            state.invalidSettingsFields.delete(target.dataset.validateId);
        }
        renderSettings();
        return;
    }

    if (field === "team-name") {
        const team = ensureTeams(state.settingsDraft).find(item => item.key === target.dataset.team);
        if (!team) {
            renderSettings();
            return;
        }

        team.name = target.value;
        if (target.dataset.validateId) {
            state.invalidSettingsFields.delete(target.dataset.validateId);
        }
        renderSettings();
        return;
    }

    if (field === "team-member-participation") {
        const team = ensureTeams(state.settingsDraft).find(item => item.key === target.dataset.team);
        const memberIndex = Number.parseInt(target.dataset.memberIndex, 10);
        if (!team || !Number.isInteger(memberIndex) || !team.members?.[memberIndex]) {
            renderSettings();
            return;
        }

        const normalizedValue = String(target.value || "").replace(/[^\d]/g, "").slice(0, 3);
        const parsedValue = Math.min(100, Math.max(0, Number.parseInt(normalizedValue, 10) || 100));
        team.members[memberIndex].participationPercent = parsedValue;
        renderSettings();
        return;
    }

    if (field === "team-member-role") {
        const team = ensureTeams(state.settingsDraft).find(item => item.key === target.dataset.team);
        const memberIndex = Number.parseInt(target.dataset.memberIndex, 10);
        if (!team || !Number.isInteger(memberIndex) || !team.members?.[memberIndex]) {
            renderSettings();
            return;
        }

        team.members[memberIndex].role = target.value;
        renderSettings();
        return;
    }

    const role = state.settingsDraft.roles.find(item => item.key === target.dataset.role);
    if (!role) {
        renderSettings();
        return;
    }

    const category = ensureRoleCategories(role).find(item => item.key === target.dataset.category);
    const isCategoryHoursField = field === "role-category-hours";
    const value = isCategoryHoursField
        ? normalizeRoleHoursInput(target.value).slice(0, 5)
        : target.type === "number"
            ? Number(target.value) || 0
            : target.value;

    if (field === "role-name") role.name = value;
    if (category && field === "role-category-label") category.label = value;
    if (category && field === "role-category-hours") category.hours = value;
    if (category && field === "role-category-description") category.description = value;
    if (category && field === "role-category-primary") role.primaryCategoryKey = category.key;

    if (target.dataset.validateId) {
        state.invalidSettingsFields.delete(target.dataset.validateId);
    }

    syncComputedRoleFields(role);
    renderSettings();
}

function validateSettingsForm() {
    const fields = Array.from(document.querySelectorAll("[data-required-settings='true']"));
    const invalidIds = new Set();
    let firstInvalidTeam = null;
    let firstInvalidRole = null;
    let firstInvalidSection = null;

    fields.forEach(field => {
        const rawValue = typeof field.value === "string" ? field.value.trim() : String(field.value || "").trim();
        if (!rawValue) {
            invalidIds.add(field.dataset.validateId);
            if (!firstInvalidTeam && field.dataset.team) {
                firstInvalidTeam = field.dataset.team;
            }
            if (!firstInvalidRole && field.dataset.role) {
                firstInvalidRole = field.dataset.role;
                firstInvalidSection = field.dataset.section || null;
            }
        }
    });

    ensureTeams(state.settingsDraft).forEach(team => {
        const distribution = ensureTeamDistribution(team, state.settingsDraft);
        const distributionTotal = roundDistributionValue(distribution.total);

        if (Math.abs(distributionTotal - 1) > 0.0001) {
            invalidIds.add(validationIdForDistribution(team.key, "total"));
            if (!firstInvalidTeam) {
                firstInvalidTeam = team.key;
            }
        }
    });

    const calendarApi = state.settingsDraft?.calendarApi || {};
    if (calendarApi.enabled) {
        const calendarFields = buildCalendarFieldDefinitions(calendarApi).filter(field => field.required);
        calendarFields.forEach(field => {
            const value = calendarApi[field.key];
            if (!isCalendarSettingFilled(field.key, value)) {
                invalidIds.add(validationIdForCalendar(field.key));
            }
        });
    }

    const misc = state.settingsDraft?.misc || {};
    buildMiscFieldDefinitions().filter(field => field.required).forEach(field => {
        const value = misc[field.key];
        const rawValue = typeof value === "string" ? value.trim() : String(value ?? "").trim();

        if (!rawValue) {
            invalidIds.add(validationIdForMisc(field.key));
        }
    });

    state.invalidSettingsFields = invalidIds;
    if (firstInvalidTeam) {
        state.expandedTeamKey = firstInvalidTeam;
    }
    if (firstInvalidRole) {
        state.expandedRoleKey = firstInvalidRole;
        if (firstInvalidSection) {
            ensureRoleSectionState(firstInvalidRole)[firstInvalidSection] = true;
        }
    }
    if ([...invalidIds].some(id => id.startsWith("distribution:"))) {
        activateSettingsTab("users");
        if (state.expandedTeamKey) {
            state.activeTeamPanels[state.expandedTeamKey] = "time";
        }
    }
    if ([...invalidIds].some(id => id.startsWith("calendar:"))) {
        activateSettingsTab("calendar");
    }
    if ([...invalidIds].some(id => id.startsWith("misc:"))) {
        activateSettingsTab("misc");
    }
    renderSettings();

    return invalidIds.size === 0;
}

document.addEventListener("click", async event => {
    const actionNode = event.target.closest("[data-action]");
    const tabNode = event.target.closest(".drawer-tab");

    if (tabNode) {
        activateSettingsTab(tabNode.dataset.tab);
    }

    if (!actionNode) {
        return;
    }

    const { action, value } = actionNode.dataset;

    if (action === "select-department-employees") {
        const employees = state.vacations.employees.filter(item => item.department === value).map(item => item.id);
        const allSelected = employees.length > 0 && employees.every(id => state.selection.employeeIds.includes(id));
        state.selection.employeeIds = allSelected
            ? state.selection.employeeIds.filter(id => !employees.includes(id))
            : [...new Set([...state.selection.employeeIds, ...employees])];
        invalidateAnalysis();
        render();
    }

    if (action === "toggle-year") {
        state.currentYear = value;
        state.selection.months = state.selection.months.filter(item => item.startsWith(`${value}-`));
        invalidateAnalysis();
        render();
        void loadMonthWorkdays(String(value));
    }

    if (action === "toggle-workflow-team") {
        applyWorkflowTeamSelection(value);
        render();
    }

    if (action === "bulk-departments") {
        const departments = state.vacations?.departments || [];
        const allSelected = departments.length > 0 && state.selection.departments.length === departments.length;
        state.selection.departments = allSelected ? [] : [...departments];
        state.selection.employeeIds = state.selection.employeeIds.filter(id => {
            const employee = state.vacations.employees.find(item => item.id === id);
            return employee && state.selection.departments.includes(employee.department);
        });
        invalidateAnalysis();
        render();
    }

    if (action === "bulk-employees") {
        const visibleEmployees = (state.vacations?.employees || []).filter(item => state.selection.departments.includes(item.department));
        const visibleEmployeeIds = visibleEmployees.map(item => item.id);
        const allSelected = visibleEmployeeIds.length > 0 && visibleEmployeeIds.every(id => state.selection.employeeIds.includes(id));
        state.selection.employeeIds = allSelected
            ? state.selection.employeeIds.filter(id => !visibleEmployeeIds.includes(id))
            : [...new Set([...state.selection.employeeIds, ...visibleEmployeeIds])];
        invalidateAnalysis();
        render();
    }

    if (action === "bulk-months") {
        const visibleMonths = getVisibleMonthKeys();
        const allSelected = visibleMonths.length > 0 && visibleMonths.every(item => state.selection.months.includes(item));
        state.selection.months = allSelected
            ? state.selection.months.filter(item => !visibleMonths.includes(item))
            : [...new Set([...state.selection.months, ...visibleMonths])].sort();
        invalidateAnalysis();
        render();
    }

    if (action === "select-team-tab") {
        state.expandedTeamKey = value;
        renderSettings();
    }

    if (action === "select-team-panel") {
        if (state.expandedTeamKey) {
            state.activeTeamPanels[state.expandedTeamKey] = value;
        }
        renderSettings();
    }

    if (action === "sort-team-members") {
        const teamKey = state.expandedTeamKey || "";
        state.teamMembersSorts[teamKey] = {
            key: actionNode.dataset.key || "department",
            direction: actionNode.dataset.direction === "desc" ? "desc" : "asc"
        };
        renderSettings();
    }

    if (action === "add-role") {
        const nextRole = createEmptyRole();
        const roleGroups = ensureRoleGroups(state.settingsDraft);
        const targetGroup = roleGroups.find(group => group.key === actionNode.dataset.group) || roleGroups[0];
        state.settingsDraft.roles.push(nextRole);
        if (targetGroup) {
            targetGroup.roleKeys.push(nextRole.key);
        }
        state.expandedRoleKey = nextRole.key;
        ensureRoleSectionState(nextRole.key)[nextRole.categories[0].key] = true;
        renderSettings();
    }

    if (action === "add-team") {
        const teams = ensureTeams(state.settingsDraft);
        const nextTeam = createEmptyTeam(teams.length + 1);
        state.settingsDraft.teams.push(nextTeam);
        state.expandedTeamKey = nextTeam.key;
        state.activeTeamPanels[nextTeam.key] = "roles";
        renderSettings();
    }

    if (action === "add-role-to-team") {
        const nextRole = addEmptyRoleToTeam(actionNode.dataset.team || state.expandedTeamKey);
        if (nextRole) {
            renderSettings();
        }
    }

    if (action === "remove-team") {
        const teams = ensureTeams(state.settingsDraft);
        const index = teams.findIndex(team => team.key === value);
        if (index !== -1 && teams.length > 1) {
            const targetTeam = teams[index + 1] || teams[index - 1];
            const [removedTeam] = teams.splice(index, 1);
            delete state.activeTeamPanels[removedTeam.key];
            if (targetTeam) {
                targetTeam.groupKeys.push(...removedTeam.groupKeys);
                state.expandedTeamKey = targetTeam.key;
            }
            state.invalidSettingsFields = new Set(
                [...state.invalidSettingsFields].filter(item => !item.startsWith(`team:${value}:`))
            );
            renderSettings();
        }
    }

    if (action === "move-team-up" || action === "move-team-down") {
        const teams = ensureTeams(state.settingsDraft);
        const index = teams.findIndex(team => team.key === value);
        if (index !== -1) {
            const targetIndex = action === "move-team-up" ? index - 1 : index + 1;
            if (teams[targetIndex]) {
                const [team] = teams.splice(index, 1);
                teams.splice(targetIndex, 0, team);
                state.expandedTeamKey = team.key;
                renderSettings();
            }
        }
    }

    if (action === "remove-group") {
        const teams = ensureTeams(state.settingsDraft);
        const roleGroups = ensureRoleGroups(state.settingsDraft);
        const targetTeam = teams.find(team => team.key === actionNode.dataset.team);
        const groupIndex = roleGroups.findIndex(group => group.key === value);

        if (targetTeam && groupIndex !== -1 && roleGroups.length > 1) {
            const [removedGroup] = roleGroups.splice(groupIndex, 1);
            targetTeam.groupKeys = targetTeam.groupKeys.filter(groupKey => groupKey !== value);
            const removedRoleKeys = removedGroup.roleKeys || [];
            state.settingsDraft.roles = state.settingsDraft.roles.filter(role => !removedRoleKeys.includes(role.key));
            teams.forEach(team => {
                team.groupKeys = team.groupKeys.filter(groupKey => groupKey !== value);
            });
            removedRoleKeys.forEach(roleKey => {
                delete state.expandedRoleSections[roleKey];
            });
            if (removedRoleKeys.includes(state.expandedRoleKey)) {
                state.expandedRoleKey = null;
            }
            state.invalidSettingsFields = new Set(
                [...state.invalidSettingsFields].filter(item => {
                    if (item.startsWith(`role:${removedRoleKeys[0] || "__none__"}:`)) {
                        return false;
                    }

                    return !removedRoleKeys.some(roleKey => item.startsWith(`role:${roleKey}:`) || item.startsWith(`category:${roleKey}:`));
                })
            );
            renderSettings();
        }
    }

    if (action === "move-group-up" || action === "move-group-down") {
        const teams = ensureTeams(state.settingsDraft);
        const targetTeam = teams.find(team => team.key === actionNode.dataset.team);
        const groupKeys = targetTeam?.groupKeys || [];
        const index = groupKeys.findIndex(groupKey => groupKey === value);

        if (index !== -1) {
            const targetIndex = action === "move-group-up" ? index - 1 : index + 1;
            if (groupKeys[targetIndex]) {
                const [groupKey] = groupKeys.splice(index, 1);
                groupKeys.splice(targetIndex, 0, groupKey);
                renderSettings();
            }
        }
    }

    if (action === "move-group-prev-team" || action === "move-group-next-team") {
        const teams = ensureTeams(state.settingsDraft);
        const currentTeamIndex = teams.findIndex(team => team.key === actionNode.dataset.team);
        const targetTeamIndex = action === "move-group-prev-team" ? currentTeamIndex - 1 : currentTeamIndex + 1;
        const currentTeam = teams[currentTeamIndex];
        const targetTeam = teams[targetTeamIndex];

        if (currentTeam && targetTeam) {
            currentTeam.groupKeys = currentTeam.groupKeys.filter(groupKey => groupKey !== value);
            targetTeam.groupKeys.push(value);
            state.expandedTeamKey = targetTeam.key;
            renderSettings();
        }
    }

    if (action === "remove-role") {
        state.settingsDraft.roles = state.settingsDraft.roles.filter(role => role.key !== value);
        ensureRoleGroups(state.settingsDraft).forEach(group => {
            group.roleKeys = group.roleKeys.filter(roleKey => roleKey !== value);
        });
        Object.keys(state.settingsDraft.userAssignments).forEach(userId => {
            if (state.settingsDraft.userAssignments[userId] === value) {
                delete state.settingsDraft.userAssignments[userId];
            }
        });
        delete state.expandedRoleSections[value];
        state.invalidSettingsFields = new Set(
            [...state.invalidSettingsFields].filter(item =>
                !item.startsWith(`role:${value}:`) && !item.startsWith(`category:${value}:`)
            )
        );
        renderSettings();
    }

    if (action === "move-role-up" || action === "move-role-down") {
        const group = ensureRoleGroups(state.settingsDraft).find(item => item.key === actionNode.dataset.group);
        const index = group?.roleKeys.findIndex(roleKey => roleKey === value) ?? -1;
        if (group && index !== -1) {
            const targetIndex = action === "move-role-up" ? index - 1 : index + 1;
            if (group.roleKeys[targetIndex]) {
                const [roleKey] = group.roleKeys.splice(index, 1);
                group.roleKeys.splice(targetIndex, 0, roleKey);
                state.expandedRoleKey = roleKey;
                renderSettings();
            }
        }
    }

    if (action === "move-role-prev-group" || action === "move-role-next-group") {
        const roleGroups = ensureRoleGroups(state.settingsDraft);
        const currentGroupIndex = roleGroups.findIndex(group => group.key === actionNode.dataset.group);
        const targetGroupIndex = action === "move-role-prev-group" ? currentGroupIndex - 1 : currentGroupIndex + 1;
        const currentGroup = roleGroups[currentGroupIndex];
        const targetGroup = roleGroups[targetGroupIndex];

        if (currentGroup && targetGroup) {
            currentGroup.roleKeys = currentGroup.roleKeys.filter(roleKey => roleKey !== value);
            targetGroup.roleKeys.push(value);
            state.expandedRoleKey = value;
            renderSettings();
        }
    }

    if (action === "add-category") {
        const role = state.settingsDraft.roles.find(item => item.key === actionNode.dataset.role);
        if (role) {
            const categories = ensureRoleCategories(role);
            const insertAfterIndex = categories.findIndex(item => item.key === value);
            const nextCategory = createEmptyCategory();
            categories.splice(insertAfterIndex + 1, 0, nextCategory);
            ensureRoleSectionState(role.key)[nextCategory.key] = true;
            state.expandedRoleKey = role.key;
            if (!role.primaryCategoryKey) {
                role.primaryCategoryKey = nextCategory.key;
            }
            syncComputedRoleFields(role);
            renderSettings();
        }
    }

    if (action === "remove-category") {
        const role = state.settingsDraft.roles.find(item => item.key === actionNode.dataset.role);
        if (role) {
            const categories = ensureRoleCategories(role);
            if (categories.length > 1) {
                role.categories = categories.filter(item => item.key !== value);
                delete ensureRoleSectionState(role.key)[value];
                if (role.primaryCategoryKey === value) {
                    role.primaryCategoryKey = role.categories[0].key;
                }
                state.invalidSettingsFields = new Set(
                    [...state.invalidSettingsFields].filter(item => !item.startsWith(`category:${role.key}:${value}:`))
                );
            } else {
                const nextCategory = createEmptyCategory();
                role.categories = [nextCategory];
                role.primaryCategoryKey = nextCategory.key;
                state.expandedRoleSections[role.key] = {
                    [nextCategory.key]: true
                };
            }
            syncComputedRoleFields(role);
            renderSettings();
        }
    }

    if (action === "move-category-up" || action === "move-category-down") {
        const role = state.settingsDraft.roles.find(item => item.key === actionNode.dataset.role);
        if (role) {
            const categories = ensureRoleCategories(role);
            const index = categories.findIndex(item => item.key === value);
            if (index !== -1) {
                const targetIndex = action === "move-category-up" ? index - 1 : index + 1;
                if (categories[targetIndex]) {
                    const [category] = categories.splice(index, 1);
                    categories.splice(targetIndex, 0, category);
                    syncComputedRoleFields(role);
                    renderSettings();
                }
            }
        }
    }

    if (action === "toggle-role-card") {
        state.expandedRoleKey = value;
        renderSettings();
    }

    if (action === "toggle-team") {
        state.expandedTeamKey = state.expandedTeamKey === value ? null : value;
        renderSettings();
    }

    if (action === "toggle-role-section") {
        const roleKey = actionNode.dataset.role;
        const sectionState = ensureRoleSectionState(roleKey);
        sectionState[value] = !sectionState[value];
        renderSettings();
    }

    if (action === "toggle-distribution-section") {
        const distributionState = ensureDistributionState();
        distributionState[value] = !distributionState[value];
        renderSettings();
    }

    if (action === "toggle-accordion") {
        const step = Number(value);
        if (step === 5 && state.selection.teamKey && state.selection.departments.length && state.selection.employeeIds.length) {
            try {
                await saveWorkflowTeamMembers();
            } catch (error) {
                setStatus(error.message, true);
                return;
            }
        }
        state.expandedStep = step;
        render();
        scrollExpandedStepIntoView();
    }

    if (action === "clear-team-members") {
        try {
            await clearWorkflowTeamMembers(value);
        } catch (error) {
            setStatus(error.message, true);
        }
    }

    if (action === "refresh-team-members") {
        try {
            await refreshWorkflowTeamMembers(value);
        } catch (error) {
            setStatus(error.message, true);
        }
    }
});

document.addEventListener("change", event => {
    const target = event.target;

    if (target.dataset.action === "select-workflow-team") {
        applyWorkflowTeamSelection(target.value);
        render();
        return;
    }

    if (target.dataset.action === "toggle-department") {
        state.selection.departments = toggleSelection(state.selection.departments, target.dataset.value);
        state.selection.employeeIds = state.selection.employeeIds.filter(id => {
            const employee = state.vacations.employees.find(item => item.id === id);
            return employee && state.selection.departments.includes(employee.department);
        });
        invalidateAnalysis();
        render();
        return;
    }

    if (target.dataset.action === "toggle-employee") {
        state.selection.employeeIds = toggleSelection(state.selection.employeeIds, target.dataset.value);
        invalidateAnalysis();
        render();
        return;
    }

    if (target.dataset.action === "toggle-month") {
        state.selection.months = getNextMonthSelection(target.dataset.value);
        invalidateAnalysis();
        render();
        return;
    }

    syncDraftFromField(target);
});

elements.fileInput.addEventListener("change", async event => {
    const [file] = event.target.files;
    if (!file) {
        return;
    }

    try {
        await uploadFile(file);
    } catch (error) {
        setStatus(error.message, true);
    } finally {
        event.target.value = "";
    }
});

elements.analyzeBtn.addEventListener("click", async () => {
    try {
        await runAnalysis();
    } catch (error) {
        setStatus(error.message, true);
    }
});

elements.exportBtn.addEventListener("click", async () => {
    try {
        await exportPlan();
    } catch (error) {
        setStatus(error.message, true);
    }
});

elements.resetBtn.addEventListener("click", async () => {
    try {
        setStatus("Сбрасываю загруженный файл и очищаю рабочие данные...");
        const payload = await fetchJson("/api/reset-workflow", {
            method: "POST"
        });

        state.settings = payload.settings;
        state.settingsDraft = deepClone(payload.settings);
        state.vacations = payload.vacations;
        state.workflow.uploaded = false;
        state.invalidSettingsFields = new Set();
        state.expandedTeamKey = null;
        state.activeTeamPanels = {};
        state.expandedRoleKey = null;
        state.expandedRoleSections = {};
        state.expandedDistributionSections = { business: true, internal: true };
        state.workflowTeamWarning = null;
        state.monthWorkdaysByYear = {};
        state.monthWorkdaysLoadingYear = null;
        state.selection = { teamKey: "", departments: [], employeeIds: [], months: [] };
        state.currentYear = null;
        invalidateAnalysis();
        state.expandedStep = 1;
        closeDrawer();
        render();
        scrollExpandedStepIntoView();
        setStatus("Форма и рабочий JSON очищены. Открыт этап загрузки файла.");
    } catch (error) {
        setStatus(error.message, true);
    }
});

elements.openSettingsBtn.addEventListener("click", openDrawer);
elements.testSettingsBtn.addEventListener("click", () => {
    if (!validateSettingsForm()) {
        openInfoDialog("Проверка не пройдена", "Не все обязательные поля заполнены. Исправьте выделенные поля и повторите проверку.");
        return;
    }

    openInfoDialog("Проверка пройдена", "Все обязательные поля настроек заполнены корректно.");
});
elements.closeSettingsBtn.addEventListener("click", closeDrawer);
elements.closeSettingsTop.addEventListener("click", closeDrawer);
elements.drawerBackdrop.addEventListener("click", closeDrawer);
elements.infoDialogBackdrop.addEventListener("click", closeInfoDialog);
elements.closeInfoDialogTop.addEventListener("click", closeInfoDialog);
elements.closeInfoDialogBtn.addEventListener("click", closeInfoDialog);
elements.addTeamBtn.addEventListener("click", () => {
    const teams = ensureTeams(state.settingsDraft);
    const nextTeam = createEmptyTeam(teams.length + 1);
    state.settingsDraft.teams.push(nextTeam);
    state.expandedTeamKey = nextTeam.key;
    state.activeTeamPanels[nextTeam.key] = "roles";
    renderSettings();
});

elements.copyTopTeamBtn.addEventListener("click", () => {
    const teams = ensureTeams(state.settingsDraft);
    const sourceTeam = teams.find(team => team.key === state.expandedTeamKey) || teams[0];

    if (!sourceTeam) {
        return;
    }

    const { team, firstRoleKey } = cloneTeamWithContents(state.settingsDraft, sourceTeam);
    const sourceIndex = teams.findIndex(item => item.key === sourceTeam.key);
    state.settingsDraft.teams.splice(sourceIndex + 1, 0, team);
    state.expandedTeamKey = team.key;
    state.activeTeamPanels[team.key] = ensureActiveTeamPanel(sourceTeam.key);
    state.expandedRoleKey = firstRoleKey;
    if (firstRoleKey) {
        const firstRole = state.settingsDraft.roles.find(role => role.key === firstRoleKey);
        const firstCategory = ensureRoleCategories(firstRole)[0];
        if (firstCategory) {
            ensureRoleSectionState(firstRoleKey)[firstCategory.key] = true;
        }
    }
    renderSettings();
    openInfoDialog("Команда скопирована", `Команда с группами скопирована с названием ${team.name}.`);
});

elements.saveSettingsBtn.addEventListener("click", async () => {
    try {
        if (!validateSettingsForm()) {
            setStatus("Заполните все обязательные поля в настройках.", true);
            openInfoDialog("Сохранение", "Не все обязательные поля заполнены. Исправьте выделенные поля.");
            return;
        }

        state.settingsDraft.roles.forEach(syncComputedRoleFields);
        ensureTeams(state.settingsDraft).forEach(team => {
            syncComputedDistributionFields(ensureTeamDistribution(team, state.settingsDraft));
        });
        ensureRoleGroups(state.settingsDraft);

        const currentSnapshot = getComparableSettingsSnapshot(state.settings);
        const nextSnapshot = getComparableSettingsSnapshot(state.settingsDraft);

        if (currentSnapshot === nextSnapshot) {
            setStatus("Изменения не вносились.");
            openInfoDialog("Сохранение", "Изменения не вносились.");
            return;
        }

        const payload = await fetchJson("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(state.settingsDraft)
        });

        state.settings = payload;
        state.settingsDraft = deepClone(payload);
        state.invalidSettingsFields = new Set();
        invalidateAnalysis();
        render();
        setStatus("Настройки сохранены.");
        openInfoDialog("Сохранение", "Данные сохранены.");
    } catch (error) {
        setStatus(error.message, true);
        openInfoDialog("Сохранение", error.message || "Не удалось сохранить изменения.");
    }
});

loadBootstrap().catch(error => {
    setStatus(error.message, true);
});
