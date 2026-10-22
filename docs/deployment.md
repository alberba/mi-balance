# Despliegue con Oracle y Nginx Proxy Manager

La instalación usa esta ruta:

```text
Navegador → HTTPS → Nginx Proxy Manager (NAS) → Tailscale → Oracle:4322 → Mi Balance
```

## Oracle

Clona el repositorio y configura `server/.env` siguiendo el README. Crea un `.env` en la raíz con `BIND_IP` igual a la dirección Tailscale de Oracle. Compose publica el puerto únicamente en esa dirección; por defecto solo escucha en localhost.

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=50
```

## Proxy y dominio

Crea un registro DNS que dirija el subdominio al NAS. En Nginx Proxy Manager crea un Proxy Host hacia la IP Tailscale de Oracle, esquema `http`, puerto `4322`. Solicita un certificado válido y activa Force SSL. Configura `BETTER_AUTH_URL` con la URL HTTPS exacta y reinicia el servicio si cambia el dominio. Las passkeys están vinculadas al dominio donde se registran.

## Actualizar

```sh
git pull --ff-only
docker compose up -d --build
curl --fail https://TU_DOMINIO/api/health
```

## Copias de seguridad

Para una copia consistente, detén únicamente el servicio de Mi Balance, copia el directorio `private/` completo a almacenamiento privado y vuelve a iniciarlo. Conserva por separado `server/.env`. No publiques copias ni secretos en GitHub.
