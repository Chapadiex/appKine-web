# UX-12 · Un solo sistema de feedback (28/10/2026)

> Pedido del usuario del 28/10/2026. Mensajes de éxito, validación y error aparecían dentro del
> contenido de formularios y paneles, y quedaban fuera de la vista o tapados por la barra de
> acciones fija (ej.: "Ese documento ya está en el padrón" al pie del alta de persona). Una sola
> regla para toda AKINE, para que el usuario aprenda un único patrón.

## 1. Qué usar para cada cosa

| Situación                                                                | Patrón                   | Dónde                                                                          |
| ------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------ |
| Resultado de una operación (guardó, creó, anuló, envió, falló sin campo) | **Aviso global (toast)** | Arriba a la derecha, debajo de la barra superior, sobre todo lo demás          |
| Un dato a corregir                                                       | **Validación en línea**  | Debajo del campo (`.campo__error`), con `aria-invalid` y `aria-describedby`    |
| Coincidencia con algo que ya existe (documento, persona, nombre en uso)  | **Alerta en el lugar**   | Pegada a los campos que la produjeron, con la salida ("Ver persona")           |
| Problema general que bloquea el formulario o la pantalla                 | **Alerta en el lugar**   | Arriba del formulario o de la pantalla; queda a la vista                       |
| Pedir confirmación de algo destructivo o irreversible                    | **Diálogo modal**        | `app-panel-lateral` (es un `dialog` modal) con `akine-confirmacion-con-motivo` |

Nunca: un toast que pregunta, un toast para un dato de un campo, un mensaje de éxito dentro del
formulario, un error al pie de un formulario largo.

## 2. Aviso global — `AvisosStore` (`core/services/avisos.store.ts`)

```ts
private readonly avisos = inject(AvisosStore);

this.avisos.exito('Persona registrada correctamente', { descripcion: 'Perez, Ana' });
this.avisos.info('Agenda actualizada');
this.avisos.advertencia('Hay horarios sin profesionales asignados', { duracion: null });
this.avisos.error('No pudimos guardar los cambios', {
  accion: { etiqueta: 'Reintentar', ejecutar: () => this.guardar() },
});
```

- **Título**: qué pasó, concreto, en pasado o en estado ("Cambios guardados", "Turno cancelado",
  "Caja abierta con $ 5.000"). Nunca "Operación exitosa" ni "OK".
- **Descripción**: solo si agrega algo (a quién, qué sigue, una consecuencia).
- **Acción**: opcional; al usarla el aviso se cierra.
- **Duración**: éxito 4,5 s · info 5 s · advertencia 8 s (`duracion: null` = hasta cerrarla) ·
  error 10 s, o **hasta que lo cierren si trae acción**. Puntero o foco encima pausan.
- Máximo 3 a la vez: el más viejo se va.
- Icono + texto de severidad para el lector ("Listo:", "Atención:", "Error:"); errores y
  advertencias con `role="alert"`. Lo dibuja `layout/avisos`, que monta el shell.

## 3. Alerta en el lugar — `app-alerta` (`shared/components/alerta`)

```html
<app-alerta tipo="error" titulo="No pudimos guardar la persona">
  <p>{{ errorAccion() }}</p>
  <p class="alerta__acciones"><button class="boton boton--secundario">Recargar</button></p>
</app-alerta>

<app-alerta class="campo--ancho" tipo="advertencia" titulo="Este documento ya está registrado">
  <p><b>Perez, Ana</b> · DNI 30.111.222</p>
  <p class="alerta__acciones">
    <a class="boton boton--secundario" [routerLink]="...">Ver persona</a>
  </p>
</app-alerta>
```

- `tipo`: `error` · `advertencia` · `info` · `exito` (el último casi nunca: el éxito es un aviso).
- Dentro de un `form` en grilla ocupa la fila entera. Para quedar junto a un campo, va
  inmediatamente después de ese campo (con `class="campo--ancho"`), y el campo apunta a ella con
  `aria-describedby` y lleva `aria-invalid="true"`.
- Error o advertencia = `role="alert"`; info/éxito = `role="status"`.

## 4. Flujo después de guardar bien

1. Guardar. 2. Cerrar el panel o el diálogo si corresponde. 3. Releer lo que se ve.
2. Aviso global de éxito. **No** se deja el formulario abierto para mostrar el mensaje.

Una pantalla propia de alta (no un panel) navega a donde corresponda y publica el aviso: el
aviso sobrevive a la navegación porque vive en el shell.

## 5. Errores de una operación

- **Dentro de un formulario o de un panel abierto**: `app-alerta` arriba del formulario, porque
  el usuario tiene que corregir o decidir ahí (y un aviso global queda inerte detrás del panel
  modal). La validación de un campo puntual, en el campo.
- **Acción de una fila o de un botón sin formulario** (anular, reenviar, cambiar estado): aviso
  global de error, con "Reintentar" cuando reintentar tiene sentido.
- **Carga de la pantalla que falla**: `app-alerta` en el lugar del contenido, con "Reintentar".
- Los mensajes del backend se muestran tal cual llegan (AGENT.md §8): van en la descripción.

## 6. Tests

En un spec de página el aviso global no se dibuja (lo dibuja el shell): se afirma sobre el store,
`TestBed.inject(AvisosStore).avisos()`. En un E2E el aviso está en la página real:
`page.getByRole('region', { name: 'Notificaciones' }).getByText('…')`.
