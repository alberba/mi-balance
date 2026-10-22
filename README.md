<div align="center">

# Mi Balance

### Tu báscula. Tus datos. Tu evolución.

Una aplicación privada para registrar las mediciones de **Mi Body Composition Scale 2**, consultar tu evolución y conservar tu historial en tu propio servidor.

![Node.js 24](https://img.shields.io/badge/Node.js-24-43853d?logo=nodedotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-persistente-003b57?logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-listo-2496ed?logo=docker&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-instalable-6554c0)

[Aplicación](https://balance.alberba.es) · [Instalación](#instalación) · [Despliegue](docs/deployment.md)

</div>

---

## Qué incluye

- **Panel de evolución:** peso, composición estimada, tendencias e historial.
- **Bluetooth:** lectura desde navegadores compatibles con Web Bluetooth y lector nativo para macOS.
- **Acceso privado:** correo y contraseña, soporte de passkeys y registro cerrado por defecto.
- **Datos propios:** SQLite persistente, separación entre usuarios y exportación CSV.
- **PWA instalable:** interfaz adaptable a móvil y escritorio.
- **Despliegue sencillo:** Docker Compose y un proxy inverso con HTTPS.

El servidor no necesita estar cerca de la báscula: la conexión Bluetooth se realiza desde el dispositivo que la lee. Web Bluetooth requiere HTTPS, un navegador compatible y la selección explícita de la báscula; su disponibilidad depende del sistema y navegador.

## Instalación

Necesitas Docker y Docker Compose.

```sh
git clone https://github.com/alberba/mi-balance.git
cd mi-balance
cp server/.env.example server/.env
mkdir -p private
sudo chown 1001:1001 private
openssl rand -base64 32
```

Edita `server/.env`: configura `BETTER_AUTH_URL`, pega el secreto generado en `BETTER_AUTH_SECRET` y elige `ADMIN_EMAIL` y `ADMIN_PASSWORD` (mínimo 12 caracteres). Usa `http://localhost:4322` para una prueba local; configura HTTPS para passkeys y Bluetooth en producción.

```sh
docker compose up -d --build
docker compose ps
curl http://localhost:4322/api/health
```

La primera ejecución migra la base de datos y crea la cuenta inicial. Las siguientes conservan los datos y la contraseña existente. `ALLOW_SIGNUP=false` mantiene cerrado el registro.

El directorio `private/` contiene la base de datos y, opcionalmente, un `seed.json` para importar un historial privado. No se incluye en Git ni en la imagen Docker. Conserva también `server/.env` de forma privada.

## Desarrollo y comprobaciones

Con Node.js 24:

```sh
cd server
npm ci
cp .env.example .env.local
# Configura .env.local; para desarrollo usa DATABASE_PATH=./data/mi-balance.sqlite3.
npm run build:client
npm test
npm start
```

Comprobaciones adicionales desde la raíz:

```sh
node pwa/test-data.mjs
python3 -m unittest discover -s app -p 'test_*.py'
python3 -m unittest discover -s tools -p 'test_*.py'
```

## Dentro del proyecto

| Ruta | Contenido |
| --- | --- |
| `pwa/` | Interfaz, almacenamiento del navegador y Bluetooth |
| `server/` | API Express, Better Auth, SQLite y cálculo de métricas |
| `app/` | Aplicación local de macOS y servidor Python |
| `tools/` | Lector Swift, decodificador BLE y fórmulas Python |
| `docs/` | Documentación técnica y despliegue |
| `compose.yaml` | Servicio de producción con volumen persistente |

Para compilar el lector macOS: `swiftc tools/scan.swift -o tools/scale-scan`. Para construir la aplicación local: `bash app/build.sh`. Esta variante requiere Python y las carpetas del proyecto junto a la aplicación. Configura tu perfil antes de registrar mediciones. En macOS define `MI_BALANCE_DEVICE` con el identificador CoreBluetooth que muestra el lector para tu báscula.

## Mediciones y atribución

El peso y la impedancia proceden de la báscula. Grasa, agua, músculo y otras métricas son **estimaciones del algoritmo**, útiles para seguir tendencias y no equivalentes a mediciones clínicas.

Las fórmulas derivan de [lolouk44/xiaomi_mi_scale](https://github.com/lolouk44/xiaomi_mi_scale), fijadas al commit `e9db989d21b23602a462338a285478658cbaa137`. Su licencia MIT se conserva en [tools/vendor/LICENSE](tools/vendor/LICENSE). Consulta también la [investigación del protocolo GATT](docs/gatt-research.md).

Proyecto independiente, sin afiliación con Xiaomi. El repositorio público excluye historiales, capturas personales, credenciales y bases de datos.
