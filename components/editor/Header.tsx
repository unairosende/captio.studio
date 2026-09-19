'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import Dialog from '@/components/Dialog'
import { signOut as endSession } from '@/lib/auth/client'
import { useSubtitleStore } from '@/store/useSubtitleStore'

import s from './editor.module.css'
import { useSave } from './useSave'

interface Props {
  user: { id: string; email: string; name: string; role: string }
  project: { id: string; name: string }
  onPalette: () => void
  onTeam: () => void
  onShortcuts: () => void
}

/**
 * The bar across the top: where you are, the way out, and the account.
 *
 * Identity, place, the save beside the name it saves, and the account — in
 * that order, and nothing else. The palette has no field up here any more:
 * ⌘K opens it from anywhere, and the account menu names it for whoever has
 * not learnt that yet.
 */
export default function Header({ user, project, onPalette, onTeam, onShortcuts }: Props) {
  const router = useRouter()
  const { sequenceName, setSequenceName } = useSubtitleStore()
  const save = useSave()

  const [seqMenu, setSeqMenu] = useState(false)
  const [meMenu, setMeMenu] = useState(false)
  // What the page was stamped with before paint (see app/layout.tsx).
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(() =>
    typeof document === 'undefined' ? 'system' : ((document.documentElement.getAttribute('data-theme') as 'light' | 'dark' | null) ?? 'system'),
  )
  function setTheme(t: 'light' | 'dark' | 'system') {
    const root = document.documentElement
    if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t)
    try { if (t === 'system') localStorage.removeItem('theme'); else localStorage.setItem('theme', t) } catch {}
    setThemeState(t)
  }
  const menusRef = useRef<HTMLDivElement>(null)

  // A menu closes when the pointer goes somewhere else.
  useEffect(() => {
    if (!seqMenu && !meMenu) return
    function onDown(e: PointerEvent) {
      if (!menusRef.current?.contains(e.target as Node)) { setSeqMenu(false); setMeMenu(false) }
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [seqMenu, meMenu])

  const { refresh } = save
  useEffect(() => {
    if (seqMenu) void refresh()
  }, [seqMenu, refresh])

  async function signOut() {
    await endSession()
    router.push('/login')
    // Server components cache the session; without this the next render
    // could still be the signed-in one.
    router.refresh()
  }

  // Two letters from the name — first and last word — or the start of the
  // address when the account was created without one.
  const words = user.name.trim().split(/\s+/).filter(Boolean)
  const initials = (words.length >= 2 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? user.email).slice(0, 2)).toUpperCase()
  const savedLabel = save.dirty
    ? 'sin guardar'
    : save.savedAt
      ? `guardado ${save.savedAt.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
      : 'guardado'

  return (
    <header className={`topbar ${s.head}`} ref={menusRef}>
      <Link href="/dashboard" className="brand">captio</Link>
      <span className="topbar-sep" />

      <nav className="crumbs" aria-label="Dónde estás">
        <Link href="/dashboard">Proyectos</Link>
        <span>/</span>
        <Link href={`/projects/${project.id}`} className={s.project} title={project.name}>{project.name}</Link>
        <span>/</span>
        <div className={s.anchor}>
          <input
            className={s.seqName}
            value={sequenceName}
            onChange={e => setSequenceName(e.target.value)}
            aria-label="Nombre de la secuencia"
            spellCheck={false}
          />
          <button className="btn btn-quiet" aria-label="Otras secuencias" aria-expanded={seqMenu} onClick={() => setSeqMenu(v => !v)}>▾</button>
          {seqMenu && (
            <div className={`menu ${s.pop} ${s.popLeft}`} role="menu">
              <span className="caps">Secuencias de {project.name}</span>
              {save.list.length === 0 && <span className={s.hint}>Nada guardado en este proyecto todavía</span>}
              {save.list.map(q => (
                <button key={q.id} className="menu-item" role="menuitemcheckbox" aria-checked={q.id === save.sequenceId}
                  onClick={() => { if (save.dirty && !confirm('¿Descartar los cambios sin guardar?')) return; setSeqMenu(false); void save.load(q.id) }}>
                  {q.name}
                  <span className="kbd">{new Date(q.updated_at).toLocaleDateString('es', { day: '2-digit', month: 'short' })}</span>
                </button>
              ))}
              <div className="menu-sep" />
              <button className="menu-item" role="menuitem" onClick={() => { setSeqMenu(false); save.startNew() }}>Nueva secuencia</button>
            </div>
          )}
        </div>
      </nav>

      <div className={s.saveGroup}>
        <button className="btn" data-cmd="Guardar la secuencia" onClick={() => void save.save()} aria-busy={save.busy || undefined}>
          Guardar <span className="kbd">⌘S</span>
        </button>
        <span className={s.saved} data-dirty={save.dirty}>{savedLabel}</span>
        {save.error && <span className="err">{save.error}</span>}
      </div>

      <div className={s.headEnd}>
        <div className={s.anchor}>
          <button className={s.avatar} onClick={() => setMeMenu(v => !v)} aria-label="Cuenta" aria-expanded={meMenu} title={user.email}>
            {initials}
          </button>
          {meMenu && (
            <div className={`menu ${s.pop}`} role="menu">
              <span className="caps">{user.name || user.email}</span>
              <button className="menu-item" role="menuitem" onClick={() => { setMeMenu(false); onPalette() }}>Buscar o ejecutar una acción <span className="kbd">⌘K</span></button>
              <button className="menu-item" role="menuitem" onClick={() => { setMeMenu(false); onShortcuts() }}>Atajos de teclado <span className="kbd">⌘/</span></button>
              <button className="menu-item" role="menuitem" onClick={() => { setMeMenu(false); onTeam() }}>Equipo</button>
              {save.sequenceId && (
                <button className="menu-item" role="menuitem" onClick={() => router.push(`/review/${save.sequenceId}`)}>Vista de revisión</button>
              )}
              <div className="menu-sep" />
              <span className="caps">Tema</span>
              {([['light', 'Claro'], ['system', 'Como el sistema'], ['dark', 'Oscuro']] as const).map(([id, label]) => (
                <button key={id} className="menu-item" role="menuitemradio" aria-checked={theme === id} onClick={() => setTheme(id)}>{label}</button>
              ))}
              <div className="menu-sep" />
              <button className="menu-item" role="menuitem" onClick={() => void signOut()}>Cerrar sesión</button>
            </div>
          )}
        </div>
      </div>

      {/* The palette reads every [data-cmd] on the page. What lives inside a
          closed menu is still a command, so it is also here, unseen. */}
      <span hidden>
        <button data-cmd="Nueva secuencia" onClick={save.startNew} />
        <button data-cmd="Abrir otra secuencia" onClick={() => setSeqMenu(true)} />
        <button data-cmd="Gestionar el equipo" onClick={onTeam} />
        <button data-cmd="Ver los atajos de teclado" data-cmd-hint="⌘/" onClick={onShortcuts} />

        <button data-cmd="Volver al proyecto" onClick={() => router.push(`/projects/${project.id}`)} />
        {save.sequenceId && <button data-cmd="Abrir la vista de revisión" onClick={() => router.push(`/review/${save.sequenceId}`)} />}
      </span>

      {save.conflict && save.sequenceId && (
        <Dialog label="Conflicto al guardar" onClose={() => save.setConflict(false)}>
            <div className="panel-head"><span className="panel-title">Alguien guardó antes que tú</span></div>
            <div className="panel-body">
              Otra persona guardó esta secuencia después de que la abrieras. Si guardas ahora, su trabajo se pierde.
            </div>
            <div className="panel-foot">
              <button className="btn btn-quiet" onClick={() => save.setConflict(false)}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => void save.save(true)}>Sobrescribir</button>
              <button className="btn btn-primary" onClick={() => void save.load(save.sequenceId!)}>Cargar la suya</button>
            </div>
        </Dialog>
      )}
    </header>
  )
}
