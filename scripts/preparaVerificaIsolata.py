#!/usr/bin/env python3
"""Prepara copie del progetto e configurazioni private; non avvia Docker."""

import argparse
import errno
import json
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend-port', type=int, default=5175)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    ports = [3327, 3027, args.frontend_port, 3328, 3028, 5275]
    if len(set(ports)) != len(ports) or any(not 1024 <= p <= 65535 for p in ports):
        raise SystemExit('Porte non valide o duplicate.')
    for port in ports:
        with socket.socket() as sock:
            try:
                sock.bind(('127.0.0.1', port))
            except OSError as error:
                if error.errno == errno.EADDRINUSE:
                    raise SystemExit(f'Porta {port} occupata: non è stato avviato alcun servizio.')
                raise SystemExit(f'Controllo porta {port} non consentito: {error.strerror}.')

    files = subprocess.run(
        ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        cwd=root, capture_output=True, check=True,
    ).stdout.decode().split('\0')
    # Copia soltanto i sorgenti versionabili, mai .env o artefatti ignorati.
    files = sorted({f for f in files if f and (root / f).is_file()})
    original = (root / '.env').read_text() if (root / '.env').exists() else ''
    allowed = {'TICKETMASTER_API_KEY', 'VITE_GOOGLE_MAPS_API_KEY',
               'VITE_GOOGLE_MAPS_MAP_ID', 'OLLAMA_MODEL'}
    external = {}
    for line in original.splitlines():
        key, sep, _ = line.partition('=')
        if sep and key.strip() in allowed:
            external[key.strip()] = line.strip()

    destination = Path(tempfile.mkdtemp(prefix='waveset-verifica-'))
    destination.chmod(0o700)
    identifier = secrets.token_hex(4)
    environments = {
        'app': {'mysql': 3327, 'backend': 3027, 'frontend': args.frontend_port,
                'db': 'waveset', 'user': 'waveset'},
        'suite': {'mysql': 3328, 'backend': 3028, 'frontend': 5275,
                  'db': 'waveset_test', 'user': 'waveset_test'},
    }
    metadata = {}
    for name, values in environments.items():
        folder = destination / name
        folder.mkdir()
        for filename in files:
            target = folder / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / filename, target)
        project = f'waveset-verifica-{identifier}-{name}'
        compose_name = 'docker-compose.yml' if name == 'app' else 'docker-compose.test.yml'
        compose = folder / compose_name
        text = compose.read_text()
        previous_project = 'waveset-fullstack' if name == 'app' else 'waveset-test'
        previous_volume = 'waveset_fullstack_mysql_data' if name == 'app' else 'waveset_test_mysql_data'
        assert f'name: {previous_project}\n' in text
        assert f'name: {previous_volume}' in text
        text = text.replace(f'name: {previous_project}\n', f'name: {project}\n', 1)
        text = text.replace(f'name: {previous_volume}', f'name: {project}_mysql_data')
        compose.write_text(text)
        config = {
            'COMPOSE_PROJECT_NAME': project,
            'DB_NAME': values['db'], 'DB_USER': values['user'],
            'DB_PASSWORD': secrets.token_hex(16),
            'MYSQL_ROOT_PASSWORD': secrets.token_hex(16),
            'MYSQL_HOST_PORT': str(values['mysql']),
            'BACKEND_HOST_PORT': str(values['backend']),
            'FRONTEND_HOST_PORT': str(values['frontend']),
            'FRONTEND_ORIGINS': f"http://localhost:{values['frontend']}",
            'COOKIE_SECURE': 'false', 'ARTISTI_PROVIDER': 'deezer',
            'DEEZER_TIMEOUT_MS': '8000',
            'OLLAMA_URL': 'http://ollama:11434' if name == 'app' else 'http://host.docker.internal:11434',
            'OLLAMA_MODEL': 'qwen3:4b',
        }
        if name == 'app':
            config.update(ADMIN_EMAIL='admin@verifica.waveset.test',
                          ADMIN_PASSWORD=secrets.token_hex(16), ADMIN_NOME='Admin verifica',
                          TICKETMASTER_SYNC_MAX_ARTISTS='1')
        lines = [f'{key}={value}' for key, value in config.items() if key not in external]
        if name == 'app':
            lines.extend(external.values())
        else:
            # La suite usa fonti simulate e non necessita di chiavi reali.
            lines.extend(f'{key}={value}' for key, value in config.items() if key in external)
        env = folder / ('.env' if name == 'app' else '.env.test')
        env.write_text('\n'.join(lines) + '\n')
        env.chmod(0o600)
        metadata[name] = {'project': project, 'volume': f'{project}_mysql_data', **values}
        if name == 'app':
            metadata[name]['model_volume'] = f'{project}_ollama_data'
    (destination / 'ambienti.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(destination)


if __name__ == '__main__':
    main()
