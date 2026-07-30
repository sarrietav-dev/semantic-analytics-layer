# Capa semántica de analítica

MVP de una API analítica multi-tenant construida como monorepo de Bun y respaldada por PostgreSQL. Los consumidores consultan métricas mediante nombres públicos estables; no conocen SQL, tablas, columnas ni joins internos.

La regla arquitectónica principal es que `analytics-core` tampoco conoce los esquemas de los módulos. Valida y orquesta consultas semánticas, pero delega la generación y ejecución de SQL a adaptadores privados mantenidos por los equipos de Performance, Asistencia y Empleados.

## Arquitectura

```text
Consumidor
    |  POST /api/v1/query (contrato semántico)
    v
analytics-core
    |  valida, separa por módulo, completa huecos y combina resultados
    +------------------+------------------+
    v                  v                  v
Performance        Asistencia         Empleados
SQL privado        SQL privado        SQL privado
    +------------------+------------------+
                       v
                 PostgreSQL compartido
```

Cada módulo registra metadatos públicos y una función opaca `execute`. Solo esa función conoce su esquema y sus reglas de negocio.

## Estructura

```text
apps/api/                    API HTTP y autenticación prototipo
packages/analytics-core/     Contratos, registro, validación y orquestación
packages/database/           Pool compartido de Bun SQL
modules/performance/         Definiciones y SQL privado de desempeño
modules/attendance/          Definiciones y SQL privado de asistencia
modules/employees/           Definiciones, SQL y dimensiones de empleados
database/migrations/         Esquema entregado e índices
database/fixtures/           Datos determinísticos de prueba
tests/unit/                  Pruebas sin base de datos
tests/integration/           Pruebas reales contra PostgreSQL
docs/technical-design.md     Documento de decisiones técnicas
```

## Inicio rápido

Requisitos: Bun 1.3 o superior y Docker con Compose.

```bash
bun install
docker compose up -d --wait
bun run start
```

La API queda disponible en `http://localhost:3000` y PostgreSQL en el puerto local `54329`.

Para detener la infraestructura:

```bash
docker compose down
```

## API

### Consultar definiciones

```bash
curl http://localhost:3000/api/v1/definitions
```

La respuesta contiene nombres, descripciones, tipos, granularidades, filtros y valores vacíos. Nunca contiene SQL ni nombres de tablas o columnas.

### Ejecutar una consulta

```bash
curl -X POST http://localhost:3000/api/v1/query \
  -H 'content-type: application/json' \
  -H 'x-company-id: 1' \
  -d '{
    "metrics": [
      "performance.avgScore",
      "performance.completedReviews"
    ],
    "dimensions": ["employees.department"],
    "time": {
      "granularity": "quarter",
      "from": "2025-01-01",
      "to": "2025-12-31"
    }
  }'
```

Respuesta resumida:

```json
{
  "columns": [
    { "name": "time", "role": "time", "type": "date" },
    {
      "name": "employees.department",
      "role": "dimension",
      "type": "string"
    },
    {
      "name": "performance.avgScore",
      "role": "metric",
      "type": "number"
    }
  ],
  "rows": [
    {
      "time": "2025-01-01",
      "employees.department": "Engineering",
      "performance.avgScore": 85,
      "performance.completedReviews": 2
    }
  ]
}
```

`time.to` es inclusivo. Si se solicita tiempo, `from`, `to` y `granularity` son obligatorios. `metrics` debe contener al menos un elemento y `dimensions` puede ser `[]`. Una consulta admite hasta 120 buckets temporales, 20 filtros, 100 valores por filtro `in`, 500 valores de filtro totales y 100.000 filas generadas. Solo se admite un filtro por dimensión.

### Filtrar una dimensión

```json
{
  "metrics": ["attendance.rate"],
  "dimensions": ["employees.department"],
  "time": {
    "granularity": "month",
    "from": "2025-04-01",
    "to": "2025-06-30"
  },
  "filters": [
    {
      "dimension": "employees.department",
      "operator": "in",
      "value": ["Engineering", "Sales"]
    }
  ]
}
```

## Definiciones disponibles

| Nombre                           | Dueño       | Semántica                                                       | `emptyValue` |
| -------------------------------- | ----------- | --------------------------------------------------------------- | ------------ |
| `performance.avgScore`           | Performance | Promedio de score de evaluaciones completadas                   | `null`       |
| `performance.completedReviews`   | Performance | Registros de evaluaciones completadas                           | `0`          |
| `performance.completedEmployees` | Performance | Empleados distintos con evaluación completada                   | `0`          |
| `attendance.rate`                | Asistencia  | Porcentaje de registros marcados presentes                      | `null`       |
| `employees.activeCount`          | Empleados   | Empleados actualmente activos contratados al cierre del período | `0`          |
| `employees.department`           | Empleados   | Dimensión pública de departamento                               | No aplica    |

## Aislamiento multi-tenant

`x-company-id` representa el contexto autenticado para este prototipo. La API lo valida y lo entrega por separado a cada ejecutor. El cuerpo no acepta `companyId`, ni siquiera anidado. Cada módulo aplica el tenant como parámetro de su SQL; los facts se unen siempre con un empleado del mismo tenant, y las pruebas de contrato incluyen filas deliberadamente inconsistentes para detectar filtraciones.

En producción se recomienda agregar PostgreSQL Row-Level Security como segunda barrera. El header no debe considerarse autenticación real.

## Huecos temporales

El core solicita los miembros de dimensiones a su módulo dueño y genera el producto período × dimensión sin consultar tablas. Cada miembro contiene una clave opaca estable para el merge y un nombre público para la respuesta; el core no conoce el origen de esa clave. Después combina los resultados y aplica el `emptyValue` registrado:

- Conteos sin observaciones: `0`.
- Promedios y tasas sin observaciones: `null`.

Así, un trimestre sin evaluaciones sigue apareciendo en la respuesta.

## Agregar una métrica

1. El equipo agrega su definición pública en su paquete de módulo.
2. Implementa la métrica dentro de su ejecutor privado.
3. Conserva el filtro obligatorio usando `context.companyId`.
4. Agrega casos a las pruebas de contrato del módulo.
5. Mantiene estable el nombre público aunque cambie tablas o columnas.

No se modifica `analytics-core` ni el lenguaje de consulta.

## Pruebas

```bash
# Unitarias, sin PostgreSQL
bun run test

# Integración; requiere docker compose up -d --wait
bun run test:integration

# Todas
bun run test:all

# Tipos
bun run typecheck
```

Las pruebas de integración cubren las cuatro preguntas del caso, la consulta exacta de 2025, huecos temporales, filtros, combinación entre fuentes y aislamiento de todas las estrategias por empresa.

## Alcance consciente

No se implementan fórmulas de métricas derivadas, traducción desde lenguaje natural, registro en runtime, autorización de producción, caché ni joins SQL directos entre módulos. La cantidad histórica de empleados activos es una aproximación porque el esquema solo conserva el booleano actual `active` y no una fecha de desvinculación.
