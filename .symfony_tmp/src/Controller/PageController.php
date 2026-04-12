<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class PageController extends AbstractController
{
    #[Route('/', name: 'app_home', methods: ['GET'])]
    public function index(): Response
    {
        return $this->render('app/index.html.twig');
    }

    #[Route('/download/vacations-sample-template', name: 'download_vacations_sample_template', methods: ['GET'])]
    public function downloadVacationsSampleTemplate(): Response
    {
        $filePath = $this->getParameter('kernel.project_dir').'/public/files/vacations-sample-template.xlsx';
        if (!is_file($filePath)) {
            return new Response('Файл образца не найден.', Response::HTTP_NOT_FOUND);
        }

        $response = new BinaryFileResponse($filePath);
        $response->headers->set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        $response->setContentDisposition(
            ResponseHeaderBag::DISPOSITION_ATTACHMENT,
            'vacations-sample-template.xlsx'
        );

        return $response;
    }
}
