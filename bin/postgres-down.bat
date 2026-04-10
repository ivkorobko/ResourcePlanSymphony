@echo off
set "DOCKER_CONFIG=%~dp0..\.docker-config"
if not exist "%DOCKER_CONFIG%" mkdir "%DOCKER_CONFIG%"
docker stop resplan-postgres
