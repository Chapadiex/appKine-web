# Tokens del design system — appKine-web

**66 tokens** en `:root` de `src/design-system.css`: 33 de color/sombra, 15 de tipografía, 9 de espaciado, 4 de radio, 5 de borde/foco. Nombres por rol, no por valor. Modo oscuro por `prefers-color-scheme` redefiniendo **solo tokens**: ninguna regla de componente se repite.
Grep: **0 literales `#rrggbb` fuera de `:root`** en todo `src/` (61 ocurrencias, todas en la capa de tokens). Los 66 tokens se usan y ningún `var()` queda sin definición.
Suite: **650/650 en 75 archivos**; cobertura 87,48 st · 80,17 rama · 85,90 fn · 88,59 ln — los cuatro gates verdes, sin movimiento respecto del baseline.

## Contraste WCAG 2.1, calculado a mano — primera verificación del repositorio (axe da siempre `incomplete` bajo jsdom, que no calcula layout)

| Par de tokens (rol)                             | Claro | Oscuro | Mín |
| ----------------------------------------------- | ----- | ------ | --- |
| `texto` / `superficie`                          | 15,32 | 14,86  | 4,5 |
| `texto-suave` / `superficie`                    | 7,09  | 8,18   | 4,5 |
| `accion-texto` / `accion-fondo` (botón)         | 15,32 | 6,33   | 4,5 |
| `accion-texto` / `deshabilitado`                | 4,63  | 5,00   | 4,5 |
| `enlace` / `superficie`                         | 15,32 | 8,18   | 4,5 |
| `marca-texto-suave` / `marca-fondo` (cabecera)  | 10,55 | 9,68   | 4,5 |
| `peligro` / `superficie` (`.estado--error`)     | 7,54  | 6,43   | 4,5 |
| `exito-texto` / `exito-fondo` (marca activa)    | 8,57  | 9,70   | 4,5 |
| `aviso-texto` / `aviso-fondo` (suspendida)      | 7,75  | 10,03  | 4,5 |
| `peligro-texto` / `peligro-fondo` (revocada)    | 9,22  | 10,17  | 4,5 |
| `borde-control` / `superficie` (borde de input) | 3,54  | 5,64   | 3   |
| `foco` / `superficie` (anillo de foco)          | 11,63 | 8,18   | 3   |

## Colores ajustados

- **Un solo ajuste por contraste:** `--color-deshabilitado` en **oscuro** es `#778593`, no el `#6a7684` del claro, que daba **2,84:1** contra la superficie y **3,06:1** contra el texto del botón; ahora 4,65 y 5,00. En modo claro no se ajustó ningún color: los 37 pares medidos ya pasaban.
- **25 consolidaciones** de valores casi idénticos que existían por deriva entre hojas, cada una re-verificada y sobre el mínimo: bordes `#d5dde5`/`#d8dee5`/`#d6dee6`→`#d5dee7` y `#e6ebf0`→`#e3e9ef`; deshabilitado `#6b7a8a`→`#6a7684`; éxito `#1c6b3a`/`#1f6f43`→`#1d6b3f`, fondo `#eef7f1`→`#eaf6ee`, texto `#14532b`→`#135029`; aviso `#8a5a00`/`#8a5300`→`#7a4b00`, fondos `#fdf3e2`/`#fdf8f0`→`#fdf5e6`, texto `#6b4000`→`#6b4600`; peligro `#9b2226`→`#a32020`, fondo `#fdf3f3`→`#fdeded`; texto suave `#4a5568`→`#4a5a6a`; atenuada `#fafbfc`→`#f7f8fa`; y las dos pilas monoespaciadas en un solo `--fuente-mono`.
- `color-scheme: light` pasó a `light dark` en `styles.css`: sin eso los controles nativos siguen blancos sobre la página oscura.
- **El resto del modo claro es idéntico y está probado**, no afirmado: se resolvió cada `var()` contra los valores de `:root` y se comparó declaración por declaración contra `HEAD`; las 26 diferencias son exactamente las de los dos puntos anteriores.
- Ningún `.ts` ni `.html` tocado, y ninguno hizo falta —el modo oscuro es automático; un conmutador manual sí exigiría template—. Sin verificación en navegador: esto mide la paleta, no píxeles renderizados.
