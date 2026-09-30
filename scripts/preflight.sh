#!/usr/bin/env bash
# SOLA LETTURA: non crea, ferma né elimina nulla.
# Uso: scripts/preflight.sh test|normale
set -euo pipefail

radice="$(cd "$(dirname "$0")/.." && pwd -P)"
case "${1:-}" in
    test)
        progetto=waveset-test
        volume=waveset_test_mysql_data
        porte=("${BACKEND_HOST_PORT:-3001}" "${MYSQL_HOST_PORT:-3308}")
        ;;
    normale)
        progetto=waveset-fullstack
        volume=waveset_fullstack_mysql_data
        porte=("${BACKEND_HOST_PORT:-3002}" "${MYSQL_HOST_PORT:-3307}")
        ;;
    *) echo "uso: $0 test|normale" >&2; exit 2 ;;
esac

stop() { echo "STOP: $1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || stop "docker non trovato"
command -v lsof >/dev/null 2>&1 || stop "lsof non trovato: non posso controllare le porte"
# Se Docker è spento o irraggiungibile ci si ferma qui: nessun errore dei
# comandi successivi viene scambiato per "volume inesistente".
docker info >/dev/null 2>&1 || stop "Docker non raggiungibile (avvia Docker Desktop)"

etichetta() {
    docker volume inspect "$volume" --format "{{index .Labels \"$1\"}}" \
        || stop "impossibile leggere le label del volume $volume"
}

trovato="$(docker volume ls -q --filter "name=^${volume}\$")" \
    || stop "impossibile elencare i volumi"

if [ "$trovato" = "$volume" ]; then
    [ "$(etichetta com.docker.compose.project)" = "$progetto" ] \
        || stop "il volume $volume non appartiene al progetto $progetto"
    [ "$(etichetta com.docker.compose.volume)" = "mysql_data" ] \
        || stop "il volume $volume non ha la label mysql_data"

    contenitori="$(docker ps -a --filter "volume=$volume" --format '{{.Names}}')" \
        || stop "impossibile elencare i container del volume $volume"
    for c in $contenitori; do
        p="$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project"}}')" \
            || stop "impossibile ispezionare $c"
        d="$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')" \
            || stop "impossibile ispezionare $c"
        [ "$p" = "$progetto" ] || stop "il container $c (progetto '$p') usa $volume"
        [ "$d" = "$radice" ] || stop "il container $c è stato creato da $d, non da $radice"
    done
    echo "OK: volume $volume verificato, riuso consentito"
elif [ -z "$trovato" ]; then
    echo "OK: volume $volume non esiste, verrà creato con init da zero"
else
    stop "risposta inattesa da docker volume ls: '$trovato'"
fi

pubblicate="$(docker ps --filter "label=com.docker.compose.project=$progetto" --format '{{.Ports}}')" \
    || stop "impossibile elencare i container del progetto $progetto"
for porta in "${porte[@]}"; do
    if lsof -nP -iTCP:"$porta" -sTCP:LISTEN >/dev/null 2>&1; then
        case "$pubblicate" in
            *":$porta->"*) ;;
            *) stop "porta $porta occupata da un processo estraneo" ;;
        esac
    fi
done
echo "OK: porte ${porte[*]} libere o del progetto $progetto"
