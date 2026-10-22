# Xiaomi Mi Body Composition Scale 2 (XMTZC05HM / MIBFS): protocolo BLE/GATT

Esta revisión cubre únicamente fuentes públicas. Las capturas posteriores de la unidad del usuario, incluida la característica propietaria de batería realmente leída, se documentan en [el informe de hardware](informe.md), que prevalece para los hechos observados en esa unidad.

Investigación de fuentes primarias de código. Consultada el 22-10-2026. El objetivo es describir lo que las implementaciones hacen y marcar por separado las interpretaciones. **No se capturó tráfico de una báscula real durante esta investigación**: las secuencias y formatos siguientes proceden del código y de sus comentarios, que en algunos casos se califican como empíricos por sus propios autores.

## Conclusiones rápidas

- **Confirmado por ESPHome:** el componente `xiaomi_miscale` escucha anuncios BLE pasivamente (sin emparejar ni abrir una conexión GATT). Reconoce el perfil de composición por Service Data UUID `0x181B` con 13 bytes. Decodifica peso e impedancia; no calcula el resto de la composición corporal. Fuente: [documentación ESPHome](https://esphome.io/components/sensor/xiaomi_miscale/) y [parser C++](https://github.com/esphome/esphome/blob/dev/esphome/components/xiaomi_miscale/xiaomi_miscale.cpp).
- **Confirmado por el código de openScale:** existe un camino de conexión GATT que usa el servicio estándar `0x181B` para v2 y una característica propietaria `2A2F-0000-3512-2118-0009af100700` para comandos/notificaciones de historial. También identifica un servicio/configuración Mi propietaria para cambiar unidades. El propio handler llama empíricas a algunas expectativas de ubicación y comportamiento; por tanto, esto documenta la implementación openScale, no garantiza idéntico comportamiento en todas las revisiones de firmware. Fuente: [MiScaleHandler.kt](https://github.com/oliexdev/openScale/blob/master/android_app/app/src/main/java/com/health/openscale/core/bluetooth/scales/MiScaleHandler.kt).
- **No encontré soporte en estas implementaciones para leer batería de la XMTZC05HM.** ESPHome no decodifica batería y el handler de openScale no declara una característica de batería para Mi. No inferir que la báscula carezca de batería: la conclusión es que las fuentes inspeccionadas no la exponen/leen.
- La báscula envía peso e impedancia. Grasa, agua, masa muscular/ósea, visceral, etc. son **estimaciones calculadas por software** a partir de esos datos y del perfil de usuario, no valores transmitidos como campos separados por esta trama.

## Nombres y variantes: MIBCS frente a MIBFS

| Nombre/modelo | Identificación en las fuentes | Lectura prudente |
|---|---|---|
| MIBCS / XMTZC02HM | [Issue de openScale](https://github.com/oliexdev/openScale/issues/85) identifica MIBCS como XMTZC02HM. | Body Composition Scale anterior. |
| MIBFS / XMTZC05HM | El handler openScale reconoce `MIBFS`; ESPHome lista XMTZC05HM entre las básculas con peso e impedancia. | Body Composition Scale 2 de esta investigación. |
| XMTZC01HM / XMTZC04HM | ESPHome los incluye entre sus modelos compatibles, pero en la clase de sólo peso. | No confundir XMTZC04HM (Mi Smart Scale 2 sólo peso) con la Body Composition Scale 2 XMTZC05HM. |

**Confirmado:** el parser ESPHome discrimina la variante de protocolo por el UUID de Service Data y la longitud, no por el texto publicitario: `0x181D` + 10 bytes = versión 1; `0x181B` + 13 bytes = versión 2. El mismo decoder v2 cubre los modelos v2 que presentan ese formato. La tabla de dispositivos de ESPHome agrupa XMTZC02HM y XMTZC05HM dentro de la familia con impedancia.

**No demostrado por las fuentes consultadas:** que MIBCS y MIBFS tengan idéntica tabla GATT, firmware, orden/semántica de cada comando de historial o comportamiento de batería. Que compartan la trama de anuncios v2 no demuestra que toda la sesión GATT sea idéntica. Tampoco basta el nombre `MI SCALE2` para identificar XMTZC05HM: openScale advierte que el XMTZC04HM sólo peso usa ese mismo nombre y recomienda decidir por la tabla GATT descubierta.

## Anuncios BLE: datos que realmente decodifica el código

ESPHome compara la MAC configurada con la dirección del anunciante, recorre Service Data y acepta:

- **V1, peso solamente:** UUID `0x181D`, longitud 10.
- **V2, composición:** UUID `0x181B`, longitud 13.

Layout v2 que documenta/decodifica el código ESPHome (índices desde cero):

| Bytes | Significado | Tratamiento en código |
|---|---|---|
| 0 | Cabecera/unidad | `0x02` kg; `0x03` lb. Otros valores no asignan peso en este parser. |
| 1 | Flags | bit 1: hay impedancia; bit 5: lectura estabilizada; bit 7: carga quitada. |
| 2–3 | Año | En la trama está presente; el parser ESPHome no lo usa para publicar. |
| 4–8 | Mes, día, hora, minuto, segundo | En la trama están presentes; ESPHome no publica fecha/hora. |
| 9–10 | Impedancia | Entero little-endian en ohmios si el bit 1 está activo. |
| 11–12 | Peso | Entero little-endian; kg = raw / 200; lb = raw × 0,01 × 0,453592. |

El parser descarta la v2 cuando aún no está estabilizada o ya se quitó la carga. Si hay impedancia, descarta la lectura si es 0 o `>= 3000 Ω`. ESPHome publica el valor bruto de impedancia válido, no la composición. La opción `clear_impedance` (por defecto `false`) permite borrar el último valor cuando llega un peso sin impedancia; la documentación explica que evita asociar una impedancia anterior si la persona se baja antes de completar la medición.

**Límites:** `3000 Ω` es un filtro de aceptación de esa implementación, no un límite físico/documentado del producto. El parser ESPHome trata el peso como entero de 16 bits y no aplica un intervalo de peso plausibilizado. El código de `lolouk44` añade reglas propias del cálculo y selección de usuarios (ver abajo); no son límites del protocolo.

## Sesión GATT e historial (openScale)

UUIDs que declara el handler actual:

| UUID | Función que le asigna el código |
|---|---|
| `0x181B` | Servicio estándar Body Composition (variante v2). |
| `0x181D` | Servicio estándar Weight Scale (variante v1). |
| `0x2A2B` | Current Time, se escribe para ajustar el reloj. |
| `0x2A9C` | Body Composition Measurement, usado como indicio/presencia del servicio, no como trama Mi principal. |
| `0x2A9D` | Weight Measurement estándar; openScale comenta que suele faltar en básculas Mi, así que es opcional. |
| `00002a2f-0000-3512-2118-0009af100700` | Característica Mi propietaria para control/notificaciones de historial. |
| `00001530-0000-3512-2118-0009af100700` / `00001542-0000-3512-2118-0009af100700` | Servicio y característica de configuración Mi; el handler la usa para unidad en v2. |

El handler selecciona v2 si descubre historial bajo `0x181B`, o si sólo está presente ese servicio; v1 si encuentra `0x181D`. Prefiere la tabla GATT real a los nombres de anuncio, que pueden ser ambiguos. V2 es el modo que el código asocia con composición/unidad configurable.

### Secuencia de lectura “sólo la última”

El orden exacto cambia entre variantes en el handler; se resume literalmente desde sus escrituras. Las operaciones se hacen sobre `CHAR_MI_HISTORY` del servicio primario elegido.

1. **Activar el protocolo:** escribe `01 96 8A BD 62` (constante nombrada `ENABLE_HISTORY_MAGIC`). En v1 lo hace antes de habilitar notificaciones; en v2, habilita notificaciones primero y luego escribe el magic.
2. **Suscribirse:** activa notificaciones en `2A2F` (y en v1 intenta también `2A9D`, de forma opcional).
3. **Solicitar sólo el registro más reciente:** escribe `01 FF FF <uniq_hi> <uniq_lo>`, donde `uniq` es un entero de 16 bits generado por el cliente.
4. **Iniciar transferencia:** escribe `02`.
5. **Recibir/interpretar:** la notificación `01 <count> ...` se interpreta como anuncio de cantidad/estado; `marker=FFFF` o `0000` acepta el anuncio. Tramas de 13 bytes son registros v2; 26 bytes se dividen en dos tramas v2; el resto se acumula como bloques de historial alineados a registros de 10 bytes.
6. **Fin:** una notificación de un byte `03` hace que openScale vacíe el buffer, escriba `03` como ACK y después `04 FF FF <uniq_hi> <uniq_lo>` como otro ACK/identificador. El handler termina el modo de historial.

| Escritura | Efecto que puede afirmarse |
|---|---|
| `01 96 8A BD 62` | openScale la usa para habilitar el flujo de historial. El significado exacto de los cinco bytes más allá de ese uso no está documentado por una especificación primaria del fabricante. |
| `01 FF FF xx xx` | El código lo construye y denomina petición “only last”; los dos últimos bytes son un nonce/identificador generado por cliente. |
| `02` | El código lo escribe como trigger de transferencia. |
| `03` recibido y escrito | El handler trata el recibido como fin/STOP; responde con `03`. |
| `04 FF FF xx xx` | El handler lo manda al finalizar como ACK, con nuevo identificador. No hay descripción pública del fabricante que confirme una semántica más específica. |

El código contiene además un fallback para firmwares que ignoran el marcador “only last” y gestiona una posible cuenta de historial. Por eso, la tabla describe la intención y las ramas del cliente openScale; **no es una especificación oficial** ni prueba que cada comando tenga ese efecto en cada báscula/firmware.

Los registros de historial de 10 bytes se parsean como `[status][weightLE(2)][yearLE(2)][month][day][hour][minute][second]`. El código exige estabilizada y no retirada; calcula peso con `/200` (o `/100` si los flags indican lb/catty) y filtra fechas no plausibles/ya importadas. Hay una advertencia explícita en el código de que la trama de historial de 10 bytes no lleva impedancia.

## Ajuste de reloj y unidades

- openScale escribe `0x2A2B` usando bytes `[año LE (2), mes, día, hora, minuto, segundo, 00, 00, 01]`, primero en el servicio primario y prueba el alternativo si falla. El propio código usa calendario local del teléfono; no describe zona horaria en la trama.
- Para v2, manda a `0x1542` del servicio `0x1530` el comando `[06, 04, 00, unit]`; `unit` se limita en el cliente a 0–2. La fuente confirma que openScale intenta configurar la unidad y tolera fallos en clones, pero no define con claridad en comentarios la tabla número→unidad. No la asigno aquí.

## Batería, identificación y configuración práctica

**Batería:** no se encontró en el parser ESPHome, en el handler Mi de openScale ni en el decoder actual del repositorio xiaomi_mi_scale una lectura de `0x180F` / `0x2A19` o campo de batería. No afirmar un porcentaje/carácter de batería ni que sea imposible obtenerlo sin otra fuente o un volcado GATT del dispositivo concreto.

**Identificación en las implementaciones:**

- ESPHome exige configurar la MAC (`mac_address`) y compara esa dirección antes de procesar Service Data. Su componente no necesita conectar ni emparejar.
- openScale usa nombre/UUID anunciados como filtro inicial, pero valida variante leyendo servicios/características GATT tras conectar. `MIBFS` y `MIBCS` son nombres aceptados; el modelo exacto no puede determinarse sólo por el nombre si hay variantes con nombres ambiguos.
- La librería de lolouk44 configura `MISCALE_MAC`; su README enumera XMTZC05HM y XMTZC02HM. Su código actual de escaneo importa `BleakScanner` (Bleak), no `bluepy`. Históricamente puede haberse usado bluepy, pero el estado actual de ese repositorio no es una implementación GATT bluepy: escucha anuncios BLE. La migración de bluepy a Bleak se menciona en el [changelog del add-on](https://newreleases.io/project/github/lolouk44/hassio-addons/release/0.3.0); el [código fuente actual](https://github.com/lolouk44/xiaomi_mi_scale/blob/master/src/Xiaomi_Scale.py) confirma Bleak.

Ejemplo mínimo del componente ESPHome, adaptado de la documentación (sustituir MAC):

```yaml
sensor:
  - platform: xiaomi_miscale
    mac_address: "AA:BB:CC:DD:EE:FF"
    weight:
      name: "Báscula peso"
    impedance:
      name: "Báscula impedancia"
    clear_impedance: true
```

## Métricas derivadas y límites de interpretación

En la trama v2 sólo están peso, impedancia cuando el flag indica que está presente, marcas de estado y fecha. Los siguientes valores no son campos BLE separados: son cálculos de aplicación. El conector Python de lolouk44 recibe peso, altura, edad, sexo e impedancia y publica BMI, BMR/metabolismo basal, grasa visceral, masa magra, porcentaje de grasa/agua, masa ósea/muscular, proteína, tipo corporal y edad metabólica. Su código exige configuración de usuario (nombre, sexo, altura, fecha de nacimiento y rangos de peso); asigna por rango al primer usuario coincidente, por lo que rangos solapados pueden asignar mal.

El código de métricas de ese repositorio documenta restricciones de su propio estimador: altura `<=220 cm`, peso entre `10–200 kg`, edad `<=99`, impedancia `<=3000 Ω`; recorta algunas salidas a rangos como grasa 5–75 %, agua 35–75 %, hueso 0,5–8 kg y músculo 10–120 kg. Estas comprobaciones/saturaciones no son rangos garantizados por el protocolo ni validación médica.

openScale expone dos caminos seleccionables por báscula: `MiScaleLib` (port inverso del algoritmo Mi Fit, opción por defecto en el código actual) y `BodyMiScaleLib` (estimador alternativo). Guarda impedancia bruta para poder recalcular y deriva composición usando sexo, edad y altura. Los resultados pueden diferir entre algoritmos; no deben presentarse como lecturas directas de sensores ni como valores clínicamente medidos.

## Fuentes primarias consultadas

1. [ESPHome: documentación `xiaomi_miscale`](https://esphome.io/components/sensor/xiaomi_miscale/) — pasivo/anuncios, modelos soportados, configuración MAC, peso/impedancia, `clear_impedance`.
2. [ESPHome: parser `xiaomi_miscale.cpp`](https://github.com/esphome/esphome/blob/dev/esphome/components/xiaomi_miscale/xiaomi_miscale.cpp) — UUID/longitudes, flags, escala de peso, filtro de impedancia y estabilización.
3. [openScale: `MiScaleHandler.kt`](https://github.com/oliexdev/openScale/blob/master/android_app/app/src/main/java/com/health/openscale/core/bluetooth/scales/MiScaleHandler.kt) — UUID GATT, detección de variante, comandos de historial, tiempo, unidad y parseo.
4. [openScale: issue #85, identificación MIBCS/XMTZC02HM](https://github.com/oliexdev/openScale/issues/85) — fuente primaria del proyecto para esa correspondencia de modelo/nombre.
5. [lolouk44/xiaomi_mi_scale: README](https://github.com/lolouk44/xiaomi_mi_scale) y [decoder actual](https://github.com/lolouk44/xiaomi_mi_scale/blob/master/src/Xiaomi_Scale.py) — modelos, configuración por MAC, escaneo y derivación/publicación.
6. [lolouk44: `Xiaomi_Scale_Body_Metrics.py`](https://github.com/lolouk44/xiaomi_mi_scale/blob/master/src/Xiaomi_Scale_Body_Metrics.py) — fórmulas, entradas y límites del estimador de ese proyecto.
7. [openScale issue #1489](https://github.com/oliexdev/openScale/issues/1489) — evidencia textual aportada en una incidencia sobre colisión de nombre `MI SCALE2` entre báscula sólo peso XMTZC04HM y modelo con composición; es un informe de usuario, no una captura recogida para esta investigación, y se usa sólo como advertencia de identificación.

## Grado de certeza

- **Confirmado por código:** parsing de anuncios en ESPHome; UUIDs/bytes que openScale declara y escribe; UUID `0x181B`/13 bytes frente a `0x181D`/10; datos que lolouk44 calcula y límites que su clase de métricas impone.
- **Documentado como empírico por openScale:** ubicación del historial/tiempo en el servicio según variante, magia de habilitación y respuestas toleradas. Los nombres de comandos describen la intención de ese código, no una especificación Xiaomi publicada.
- **No confirmado:** equivalencia GATT completa entre MIBCS y MIBFS; presencia/lectura de batería; semántica exacta de cada ACK en todos los firmwares; que métricas propietarias coincidan con las de Mi Fit; capturas reales de XMTZC05HM.
