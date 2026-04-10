<?php

namespace App\Controller;

use App\Service\CalendarService;
use App\Service\DateHelper;
use App\Service\ExportWorkbookService;
use App\Service\PlanService;
use App\Service\SettingsService;
use App\Service\StateStore;
use App\Service\VacationWorkbookService;
use JsonException;
use RuntimeException;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api')]
final class ApiController
{
    public function __construct(
        private readonly StateStore $stateStore,
        private readonly VacationWorkbookService $vacationWorkbookService,
        private readonly SettingsService $settingsService,
        private readonly CalendarService $calendarService,
        private readonly PlanService $planService,
        private readonly ExportWorkbookService $exportWorkbookService,
    ) {
    }

    #[Route('/bootstrap', name: 'api_bootstrap', methods: ['GET'])]
    public function bootstrap(): JsonResponse
    {
        try {
            $state = $this->stateStore->loadState();
            $settings = $this->settingsService->syncSettingsWithVacations($state['settings'], $state['vacations']);
            $this->stateStore->saveSettings($settings);

            return new JsonResponse([
                'settings' => $settings,
                'vacations' => $state['vacations'],
            ]);
        } catch (\Throwable $exception) {
            return $this->jsonError($exception, 'Не удалось загрузить данные.', 500);
        }
    }

    #[Route('/upload-vacations', name: 'api_upload_vacations', methods: ['POST'])]
    public function uploadVacations(Request $request): JsonResponse
    {
        /** @var UploadedFile|null $uploadedFile */
        $uploadedFile = $request->files->get('file');
        if (!$uploadedFile instanceof UploadedFile) {
            return new JsonResponse(['error' => 'Файл не получен.'], 400);
        }

        try {
            $vacations = $this->vacationWorkbookService->parseWorkbook($uploadedFile->getPathname(), $uploadedFile->getClientOriginalName());
            $settings = $this->settingsService->syncSettingsWithVacations($this->stateStore->getSettings(), $vacations);
            $this->stateStore->saveVacations($vacations);
            $this->stateStore->saveSettings($settings);

            return new JsonResponse([
                'vacations' => $vacations,
                'settings' => $settings,
            ]);
        } catch (\Throwable $exception) {
            return $this->jsonError($exception, 'Не удалось обработать файл отпусков.');
        }
    }

    #[Route('/settings', name: 'api_settings_update', methods: ['PUT'])]
    public function updateSettings(Request $request): JsonResponse
    {
        try {
            $payload = $this->parseJsonBody($request);
            $payload['updatedAt'] = (new \DateTimeImmutable('now', DateHelper::utc()))->format(DATE_ATOM);

            return new JsonResponse($this->stateStore->saveSettings($payload));
        } catch (\Throwable $exception) {
            return $this->jsonError($exception, 'Не удалось сохранить настройки.');
        }
    }

    #[Route('/reset-workflow', name: 'api_reset_workflow', methods: ['POST'])]
    public function resetWorkflow(): JsonResponse
    {
        try {
            return new JsonResponse($this->stateStore->resetWorkflow());
        } catch (\Throwable $exception) {
            return $this->jsonError($exception, 'Не удалось очистить рабочие данные.', 500);
        }
    }

    #[Route('/calendar/month-workdays', name: 'api_month_workdays', methods: ['GET'])]
    public function monthWorkdays(Request $request): JsonResponse
    {
        $year = (int) $request->query->get('year', 0);
        if ($year < 1) {
            return new JsonResponse(['error' => 'Некорректный год.'], 400);
        }

        try {
            $settings = $this->stateStore->getSettings();
            $workdayMap = $this->calendarService->fetchYearWorkdayMap($year, is_array($settings['calendarApi'] ?? null) ? $settings['calendarApi'] : []);
            $months = [];

            for ($monthIndex = 1; $monthIndex <= 12; ++$monthIndex) {
                $monthStart = DateHelper::createUtc($year, $monthIndex, 1);
                $monthEnd = DateHelper::endOfMonth($monthStart);
                $workingDays = 0;

                foreach (DateHelper::enumerateDays($monthStart, $monthEnd) as $day) {
                    if ($workdayMap[DateHelper::toIsoDate($day)] ?? false) {
                        ++$workingDays;
                    }
                }

                $months[] = [
                    'key' => DateHelper::monthKey($monthStart),
                    'workingDays' => $workingDays,
                ];
            }

            return new JsonResponse([
                'year' => $year,
                'months' => $months,
            ]);
        } catch (\Throwable $exception) {
            return $this->jsonError($exception, 'Не удалось получить рабочие дни.');
        }
    }

    #[Route('/analyze', name: 'api_analyze', methods: ['POST'])]
    public function analyze(Request $request): JsonResponse
    {
        try {
            $selection = $this->parseJsonBody($request);
            $state = $this->stateStore->loadState();
            $settings = $this->settingsService->syncSettingsWithVacations($state['settings'], $state['vacations']);
            $this->stateStore->saveSettings($settings);
            $plan = $this->planService->buildPlan($state['vacations'], $settings, $selection);

            return new JsonResponse([
                ...$plan,
                'settings' => $settings,
            ]);
        } catch (\Throwable $exception) {
            return $this->jsonError($exception, 'Не удалось выполнить анализ.');
        }
    }

    #[Route('/team-members/save', name: 'api_team_members_save', methods: ['POST'])]
    public function saveTeamMembers(Request $request): JsonResponse
    {
        try {
            $payload = $this->parseJsonBody($request);
            $state = $this->stateStore->loadState();
            $result = $this->settingsService->saveTeamMembers(
                $state['settings'],
                $state['vacations'],
                trim((string) ($payload['teamKey'] ?? '')),
                array_values(array_map('strval', is_array($payload['employeeIds'] ?? null) ? $payload['employeeIds'] : [])),
                array_values(array_filter(is_array($payload['members'] ?? null) ? $payload['members'] : [], 'is_array'))
            );
            $this->stateStore->saveSettings($result['settings']);

            return new JsonResponse($result);
        } catch (\Throwable $exception) {
            return $this->jsonError($exception, 'Не удалось сохранить состав команды.');
        }
    }

    #[Route('/team-members/clear', name: 'api_team_members_clear', methods: ['POST'])]
    public function clearTeamMembers(Request $request): JsonResponse
    {
        try {
            $payload = $this->parseJsonBody($request);
            $settings = $this->stateStore->getSettings();
            $result = $this->settingsService->clearTeamMembers($settings, trim((string) ($payload['teamKey'] ?? '')));
            $this->stateStore->saveSettings($result['settings']);

            return new JsonResponse($result);
        } catch (\Throwable $exception) {
            return $this->jsonError($exception, 'Не удалось очистить состав команды.');
        }
    }

    #[Route('/team-members/refresh', name: 'api_team_members_refresh', methods: ['POST'])]
    public function refreshTeamMembers(Request $request): JsonResponse
    {
        try {
            $payload = $this->parseJsonBody($request);
            $state = $this->stateStore->loadState();
            $result = $this->settingsService->refreshTeamMembers($state['settings'], $state['vacations'], trim((string) ($payload['teamKey'] ?? '')));
            $this->stateStore->saveSettings($result['settings']);

            return new JsonResponse($result);
        } catch (\Throwable $exception) {
            return $this->jsonError($exception, 'Не удалось обновить состав команды.');
        }
    }

    #[Route('/export', name: 'api_export', methods: ['POST'])]
    public function export(Request $request): Response
    {
        try {
            $selection = $this->parseJsonBody($request);
            $state = $this->stateStore->loadState();
            $settings = $this->settingsService->syncSettingsWithVacations($state['settings'], $state['vacations']);
            $this->stateStore->saveSettings($settings);
            $plan = $this->planService->buildPlan($state['vacations'], $settings, $selection);
            $content = $this->exportWorkbookService->exportWorkbook($settings, $plan);
            $safeLabel = preg_replace('/\s+/u', '_', mb_strtolower((string) ($plan['periodLabel'] ?? 'period'))) ?: 'period';
            $filename = "resource_plan_{$safeLabel}.xlsx";
            $asciiFallback = 'resource_plan.xlsx';

            $response = new Response($content);
            $response->headers->set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            $response->headers->set('Content-Disposition', HeaderUtils::makeDisposition(HeaderUtils::DISPOSITION_ATTACHMENT, $filename, $asciiFallback));

            return $response;
        } catch (\Throwable $exception) {
            return $this->jsonError($exception, 'Не удалось сформировать файл.');
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function parseJsonBody(Request $request): array
    {
        try {
            /** @var mixed $payload */
            $payload = json_decode($request->getContent(), true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new RuntimeException('Некорректный JSON.');
        }

        if (!is_array($payload)) {
            throw new RuntimeException('Некорректные данные запроса.');
        }

        return $payload;
    }

    private function jsonError(\Throwable $exception, string $fallback, int $status = 400): JsonResponse
    {
        $message = trim((string) $exception->getMessage());
        if ('' === $message) {
            $message = $fallback;
        }

        return new JsonResponse(['error' => $message], $status);
    }
}
