/**
 * The keyboard, written down once.
 *
 * The dialog in the editor prints this, and the design guide prints the same
 * list: a shortcut that is not written here does not exist, the same way a
 * piece that is not in the style guide does not. ⌘ stands for Ctrl on
 * Windows and Linux, and the dialog says so.
 */

export interface Shortcut {
  keys: string
  does: string
}

export interface ShortcutGroup {
  title: string
  items: Shortcut[]
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'En todas partes',
    items: [
      { keys: '⌘K', does: 'Buscar o ejecutar cualquier acción' },
      { keys: '⌘/', does: 'Ver estos atajos' },
      { keys: 'Esc', does: 'Cerrar el diálogo, el menú o la corrección' },
    ],
  },
  {
    title: 'La secuencia',
    items: [
      { keys: '⌘S', does: 'Guardar' },
      { keys: '⌘E', does: 'Exportar la pestaña en pantalla' },
      { keys: '⌘Z', does: 'Deshacer' },
      { keys: '⇧⌘Z', does: 'Rehacer' },
      { keys: '⌘F', does: 'Buscar en los cues' },
      { keys: '⏎ · ⇧⏎', does: 'Siguiente y anterior resultado de la búsqueda' },
    ],
  },
  {
    title: 'La tabla',
    items: [
      { keys: '↑ ↓', does: 'Cue anterior y siguiente' },
      { keys: '← →', does: 'Idioma anterior y siguiente' },
      { keys: '⏎', does: 'Corregir el cue seleccionado' },
      { keys: 'Tab · ⇧Tab', does: 'Corrigiendo: la celda siguiente y la anterior, idioma a idioma y luego cue a cue' },
      { keys: '⌘⏎', does: 'Confirmar la corrección' },
      { keys: 'Esc', does: 'Descartar la corrección' },
      { keys: '⇧F10', does: 'Menú del cue: comentar, partir, borrar' },
    ],
  },
  {
    title: 'El vídeo',
    items: [
      { keys: 'J', does: 'Atrás; otra vez, más rápido' },
      { keys: 'K', does: 'Parar' },
      { keys: 'L', does: 'Adelante; otra vez, más rápido' },
    ],
  },
]
