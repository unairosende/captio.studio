'use client'

import { create } from 'zustand'
// Relative, with extensions, so `node --test` can load this the same way it
// loads lib/. The store holds the undo history now, which makes it worth
// testing outside React — and the alias only resolves under tsc and Next.
import type {
  Subtitle, TranslationStore, BackTranslationStore,
  OutputMode, ViewMode,
} from '../types/subtitle.ts'
import { finalSubs, qcForMode } from '../lib/subtitles/index.ts'

/**
 * Deep enough to cover a session's worth of second thoughts, shallow enough
 * that a feature-length track does not sit in memory fifty times over.
 */
const UNDO_DEPTH = 50

/**
 * What undo restores.
 *
 * Only the work — not which tab is open, not the scroll position, not whether
 * a translation is running. Undo is for taking back a change to the subtitles,
 * and an undo that also moved the view would be answering a question nobody
 * asked.
 */
interface Snapshot {
  subtitles: Subtitle[]
  translations: TranslationStore
}

const snapshot = (s: { subtitles: Subtitle[]; translations: TranslationStore }): Snapshot => ({
  subtitles: s.subtitles,
  translations: s.translations,
})

/**
 * Put a snapshot back, keeping the open tab pointing at something real.
 *
 * Undoing past the moment a language was added leaves the active tab naming a
 * translation that no longer exists — the editor then renders an empty language
 * with no way back to the source.
 */
function restore(state: { activeTab: string }, snap: Snapshot) {
  const stillThere = snap.translations[state.activeTab] !== undefined
  return {
    subtitles: snap.subtitles,
    translations: snap.translations,
    activeTab: state.activeTab === 'source' || stillThere ? state.activeTab : 'source',
  }
}

interface TranslationJob {
  running: boolean
  progress: number  // 0-100
  message: string
  error: string | null
}

interface AppState {
  // Core data
  subtitles: Subtitle[]
  translations: TranslationStore
  backTranslations: BackTranslationStore

  // UI state
  activeTab: 'source' | string
  outputMode: OutputMode
  viewMode: ViewMode
  srcLang: string
  tgtLang: string
  allowRephrase: boolean

  // Jobs
  translateJob: TranslationJob
  backTranslateJob: TranslationJob
  transcribeJob: TranslationJob

  // History
  past: Snapshot[]
  future: Snapshot[]

  // Actions
  /**
   * Mark the start of one undoable action, before it changes anything.
   *
   * Called by whoever is about to act, rather than automatically on every
   * mutation, because "one action" is a human idea the store cannot infer: a
   * drag fires a retime on every pointer move, and undoing one frame of a drag
   * is not undoing anything anybody did.
   */
  pushUndo: () => void
  undo: () => void
  redo: () => void

  loadSubtitles: (subs: Subtitle[]) => void
  clearAll: () => void
  setTranslation: (lang: string, subs: Subtitle[]) => void
  updateSubtitle: (lang: string, index: number, text: string) => void
  /** Timings belong to the cue, not to any one language. */
  retimeSubtitle: (index: number, start: string, end: string) => void
  setBackTranslation: (lang: string, subs: Subtitle[]) => void
  clearBackTranslation: (lang: string) => void
  closeTab: (lang: string) => void
  switchToTab: (tab: string) => void
  setOutputMode: (mode: OutputMode) => void
  setViewMode: (mode: ViewMode) => void
  setSrcLang: (l: string) => void
  setTgtLang: (l: string) => void
  setAllowRephrase: (v: boolean) => void
  setTranslateJob: (j: Partial<TranslationJob>) => void
  setBackTranslateJob: (j: Partial<TranslationJob>) => void
  setTranscribeJob: (j: Partial<TranslationJob>) => void

  // Derived helpers
  getFinalSubs: (lang: string) => Subtitle[]
}

const defaultJob: TranslationJob = { running: false, progress: 0, message: '', error: null }

export const useSubtitleStore = create<AppState>((set, get) => ({
  subtitles: [],
  translations: {},
  backTranslations: {},
  activeTab: 'source',
  outputMode: 'horizontal',
  viewMode: 'list',
  srcLang: 'Auto-detect',
  tgtLang: 'Spanish',
  allowRephrase: false,
  translateJob: defaultJob,
  backTranslateJob: defaultJob,
  transcribeJob: defaultJob,
  past: [],
  future: [],

  // Opening a different file starts a different piece of work. Carrying the
  // history across would let undo paste the previous job's cues into this one.
  loadSubtitles: subs => set({
    subtitles: subs,
    translations: {},
    backTranslations: {},
    activeTab: 'source',
    translateJob: defaultJob,
    past: [],
    future: [],
  }),

  clearAll: () => set({
    subtitles: [],
    translations: {},
    backTranslations: {},
    activeTab: 'source',
    translateJob: defaultJob,
    backTranslateJob: defaultJob,
    transcribeJob: defaultJob,
    past: [],
    future: [],
  }),

  setTranslation: (lang, subs) => set(s => ({
    translations: { ...s.translations, [lang]: subs },
    activeTab: lang,
  })),

  updateSubtitle: (lang, index, text) => set(s => {
    const subs = s.translations[lang]?.map(sub => sub.index === index ? { ...sub, text } : sub) ?? []
    return { translations: { ...s.translations, [lang]: subs } }
  }),

  /**
   * Move a cue in time, in every language at once.
   *
   * A cue is one moment of the recording that happens to have been written
   * several times over. Retiming only the tab somebody is looking at would let
   * the Spanish and the English drift apart until an export silently disagreed
   * with itself — and nothing in the editor would show it, because each tab
   * looks right on its own.
   */
  pushUndo: () => set(s => ({
    past: [...s.past, snapshot(s)].slice(-UNDO_DEPTH),
    // Any new action abandons the branch that redo would have replayed. Keeping
    // it would let redo paste work from a timeline that no longer happened.
    future: [],
  })),

  undo: () => set(s => {
    const previous = s.past.at(-1)
    if (!previous) return {}
    return { ...restore(s, previous), past: s.past.slice(0, -1), future: [...s.future, snapshot(s)] }
  }),

  redo: () => set(s => {
    const next = s.future.at(-1)
    if (!next) return {}
    return { ...restore(s, next), future: s.future.slice(0, -1), past: [...s.past, snapshot(s)] }
  }),

  retimeSubtitle: (index, start, end) => set(s => {
    const move = (subs: Subtitle[]) =>
      subs.map(sub => (sub.index === index ? { ...sub, start, end } : sub))

    return {
      subtitles: move(s.subtitles),
      translations: Object.fromEntries(
        Object.entries(s.translations).map(([lang, subs]) => [lang, move(subs)]),
      ),
    }
  }),

  setBackTranslation: (lang, subs) => set(s => ({
    backTranslations: { ...s.backTranslations, [lang]: subs },
  })),

  clearBackTranslation: lang => set(s => {
    const bt = { ...s.backTranslations }
    delete bt[lang]
    return { backTranslations: bt }
  }),

  closeTab: lang => set(s => {
    const translations   = { ...s.translations };    delete translations[lang]
    const backTranslations = { ...s.backTranslations }; delete backTranslations[lang]
    return {
      translations,
      backTranslations,
      activeTab: s.activeTab === lang ? 'source' : s.activeTab,
    }
  }),

  switchToTab: tab => set({ activeTab: tab }),
  setOutputMode:    mode => set({ outputMode: mode }),
  setViewMode:      mode => set({ viewMode: mode }),
  setSrcLang:       l    => set({ srcLang: l }),
  setTgtLang:       l    => set({ tgtLang: l }),
  setAllowRephrase: v    => set({ allowRephrase: v }),

  setTranslateJob:    j => set(s => ({ translateJob:    { ...s.translateJob,    ...j } })),
  setBackTranslateJob:j => set(s => ({ backTranslateJob:{ ...s.backTranslateJob,...j } })),
  setTranscribeJob:   j => set(s => ({ transcribeJob:   { ...s.transcribeJob,   ...j } })),

  getFinalSubs: lang => {
    const { translations, outputMode } = get()
    const subs = translations[lang] ?? []
    // The thresholds follow the output mode, so the narrow vertical layout
    // splits where the wide one does not.
    return finalSubs(subs, outputMode, qcForMode(outputMode))
  },
}))
