'use client'

import { create } from 'zustand'
// Relative, with extensions, so `node --test` can load this the same way it
// loads lib/. The store holds the undo history now, which makes it worth
// testing outside React — and the alias only resolves under tsc and Next.
import type {
  Subtitle, TranslationStore, BackTranslationStore,
  OutputMode, ViewMode,
} from '../types/subtitle.ts'
import type { GlossaryEntry } from '../lib/ai/prompt.ts'
import type { AnchorEdit, AnchorOp, ProjectComment } from '../types/comment.ts'
import { deleteAnchors, splitAnchors } from '../types/comment.ts'
import { deleteCue, finalSubs, qcForMode, splitCue } from '../lib/subtitles/index.ts'

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
  /**
   * The renumbering this step performed, if any.
   *
   * Carried on the snapshot rather than in a stack of its own because undo has
   * to move the comment anchors back, and only the step that moved them knows
   * by how much.
   */
  edit?: AnchorEdit
}

const snapshot = (s: { subtitles: Subtitle[]; translations: TranslationStore }): Snapshot => ({
  subtitles: s.subtitles,
  translations: s.translations,
})

/**
 * Move the comments on screen the same way the save will move them in the database.
 *
 * Without this the badge counts stay on the old cue numbers until somebody
 * reloads — the comment is on the right line in Postgres and the wrong one in
 * front of the person who just split the cue.
 */
function reanchor(comments: ProjectComment[], op: AnchorOp): ProjectComment[] {
  return comments
    .filter(c => op.dropIndex === undefined || c.cue_index !== op.dropIndex)
    .map(c => (c.cue_index >= op.fromIndex ? { ...c, cue_index: c.cue_index + op.delta } : c))
}

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

/**
 * Apply a change of shape to the source and to every translation at once.
 *
 * Back-translations are dropped rather than carried through. They are a
 * separate set of lines matched to cues by number, so a split or a delete
 * leaves them describing the wrong ones — and a difference shown against the
 * wrong cue is worse than no difference at all. One button rebuilds them.
 */
function structural(
  s: { subtitles: Subtitle[]; translations: TranslationStore },
  apply: (subs: Subtitle[]) => Subtitle[],
) {
  return {
    subtitles: apply(s.subtitles),
    translations: Object.fromEntries(
      Object.entries(s.translations).map(([lang, subs]) => [lang, apply(subs)]),
    ),
    backTranslations: {},
    dirty: true,
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
  /**
   * Terms the translator must respect, for this whole project.
   *
   * One list for every target language, which covers what glossaries are
   * actually used for — character names, brands, the client's own vocabulary.
   * It belongs to the project rather than to the organisation because the same
   * word is a brand in one job and an ordinary noun in the next; and to the
   * project rather than the sequence because a character's name has to survive
   * from reel one to reel six.
   *
   * Which means editing it here changes it for every sequence in the project.
   */
  glossary: GlossaryEntry[]
  /**
   * Whether the glossary has been touched since the last save.
   *
   * Tracked separately because it is stored on a different row from the cues,
   * and because it is shared: writing the local copy back on every save would
   * let somebody who never opened the panel overwrite a term a colleague added
   * while they had the editor open.
   */
  glossaryDirty: boolean

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

  /**
   * The project this editor is working inside.
   *
   * Always set once the editor has been reached properly, because every sequence
   * belongs to one and a new sequence has to know where to be created. Null only
   * in the moment before a project has been chosen.
   */
  projectId: string | null
  projectName: string

  // The saved sequence this editor is a view of, if any
  sequenceId: string | null
  sequenceName: string
  /**
   * The version that was opened.
   *
   * Sent back on save so the server can refuse if somebody else saved in the
   * meantime. Without it the second person to save silently erases the first.
   */
  sequenceVersion: number | null
  /** Whether there is work here that is not in the database. */
  dirty: boolean

  /**
   * The notes on the open sequence, as last read from the server.
   *
   * Empty for a sequence that has never been saved: a comment needs a sequence
   * id to hang from, and there is nobody to read it yet anyway.
   */
  comments: ProjectComment[]
  /**
   * Renumberings made since the last save, in the order they happened.
   *
   * Sent with the save and applied to the anchors in the same transaction as
   * the cues. Held rather than sent as they happen because these edits are not
   * committed until somebody saves, and moving the anchors for a split that is
   * later undone would be worse than not moving them at all.
   */
  anchorOps: AnchorOp[]

  openSequence: (sequence: {
    id: string
    name: string
    version: number
    subtitles: Subtitle[]
    translations: TranslationStore
    /** The project it lives in, whose glossary comes with it. */
    projectId: string
    projectName: string
    glossary?: GlossaryEntry[]
  }) => void
  markSaved: (id: string, name: string, version: number) => void
  /** A blank sequence in the given project. The glossary is the project's, so it stays. */
  newSequence: (project: { id: string; name: string; glossary?: GlossaryEntry[] }) => void
  setSequenceName: (name: string) => void

  // Actions
  /**
   * Mark the start of one undoable action, before it changes anything.
   *
   * Called by whoever is about to act, rather than automatically on every
   * mutation, because "one action" is a human idea the store cannot infer: a
   * drag fires a retime on every pointer move, and undoing one frame of a drag
   * is not undoing anything anybody did.
   */
  pushUndo: (edit?: AnchorEdit) => void
  undo: () => void
  redo: () => void

  setComments: (comments: ProjectComment[]) => void

  loadSubtitles: (subs: Subtitle[]) => void
  clearAll: () => void
  setTranslation: (lang: string, subs: Subtitle[]) => void
  updateSubtitle: (lang: string, index: number, text: string) => void
  /** Timings belong to the cue, not to any one language. */
  retimeSubtitle: (index: number, start: string, end: string) => void
  /**
   * Structural edits, applied to every language at once.
   *
   * Unlike the others these mark their own undo step: there is exactly one of
   * them per click, so there is nothing for a caller to decide.
   */
  splitSubtitle: (index: number, atSec?: number) => void
  deleteSubtitle: (index: number) => void
  setBackTranslation: (lang: string, subs: Subtitle[]) => void
  clearBackTranslation: (lang: string) => void
  closeTab: (lang: string) => void
  switchToTab: (tab: string) => void
  setOutputMode: (mode: OutputMode) => void
  setViewMode: (mode: ViewMode) => void
  setSrcLang: (l: string) => void
  setTgtLang: (l: string) => void
  setAllowRephrase: (v: boolean) => void
  /**
   * Replaces the whole list. The table is edited a cell at a time and there are
   * a few dozen rows at most, so nothing is gained by patching one entry.
   */
  setGlossary: (entries: GlossaryEntry[]) => void
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
  glossary: [],
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
  glossaryDirty: false,
  projectId: null,
  projectName: '',
  sequenceId: null,
  sequenceName: 'Untitled',
  sequenceVersion: null,
  dirty: false,
  comments: [],
  anchorOps: [],

  openSequence: s => set({
    subtitles: s.subtitles,
    translations: s.translations,
    backTranslations: {},
    glossary: s.glossary ?? [],
    glossaryDirty: false,
    activeTab: 'source',
    projectId: s.projectId,
    projectName: s.projectName,
    sequenceId: s.id,
    sequenceName: s.name,
    sequenceVersion: s.version,
    // Freshly loaded is by definition identical to what is stored.
    dirty: false,
    past: [],
    future: [],
    // The notes are fetched separately, and the anchors of the sequence being
    // closed have nothing to do with the one being opened.
    comments: [],
    anchorOps: [],
  }),

  // The anchors went with the save, so replaying them would move every comment
  // a second time.
  markSaved: (id, name, version) =>
    set({
      sequenceId: id,
      sequenceName: name,
      sequenceVersion: version,
      dirty: false,
      glossaryDirty: false,
      anchorOps: [],
    }),

  // The glossary survives, because it belongs to the project rather than to the
  // sequence being left behind: starting reel two should not mean re-typing
  // every character's name.
  newSequence: project => set({
    subtitles: [],
    translations: {},
    backTranslations: {},
    glossary: project.glossary ?? [],
    glossaryDirty: false,
    activeTab: 'source',
    projectId: project.id,
    projectName: project.name,
    sequenceId: null,
    sequenceName: 'Untitled',
    sequenceVersion: null,
    dirty: false,
    past: [],
    future: [],
    comments: [],
    anchorOps: [],
  }),

  setSequenceName: name => set({ sequenceName: name, dirty: true }),

  // Opening a different file starts a different piece of work. Carrying the
  // history across would let undo paste the previous job's cues into this one.
  //
  // ponytail: the anchors are dropped rather than remapped. A new file renumbers
  // the whole track at once, which no sequence of one-cue shifts describes — the
  // existing notes then point at whatever cue now holds their old number. Worth
  // solving if importing over a commented project turns out to be something
  // people do.
  loadSubtitles: subs => set({
    subtitles: subs,
    translations: {},
    backTranslations: {},
    activeTab: 'source',
    translateJob: defaultJob,
    past: [],
    future: [],
    anchorOps: [],
    dirty: true,
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
    anchorOps: [],
    // Emptying the editor is itself a change worth saving or abandoning; the
    // project row is still there with the old cues in it. The glossary stays:
    // it is the terminology of the job, not of the file that was loaded, and
    // re-importing a corrected export should not cost somebody their terms.
    dirty: true,
  }),

  setTranslation: (lang, subs) => set(s => ({
    translations: { ...s.translations, [lang]: subs },
    activeTab: lang,
    dirty: true,
  })),

  updateSubtitle: (lang, index, text) => set(s => {
    const subs = s.translations[lang]?.map(sub => sub.index === index ? { ...sub, text } : sub) ?? []
    return { translations: { ...s.translations, [lang]: subs }, dirty: true }
  }),

  pushUndo: edit => set(s => ({
    past: [...s.past, { ...snapshot(s), edit }].slice(-UNDO_DEPTH),
    // Any new action abandons the branch that redo would have replayed. Keeping
    // it would let redo paste work from a timeline that no longer happened.
    future: [],
  })),

  undo: () => set(s => {
    const previous = s.past.at(-1)
    if (!previous) return {}
    const back = previous.edit?.undo
    return {
      ...restore(s, previous),
      past: s.past.slice(0, -1),
      future: [...s.future, { ...snapshot(s), edit: previous.edit }],
      // Taking back a split has to take back the renumbering with it, or the
      // comments stay one line below where they belong.
      ...(back
        ? { comments: reanchor(s.comments, back), anchorOps: [...s.anchorOps, back] }
        : {}),
      // Undoing back to the saved state still counts as unsaved: the store
      // does not know which snapshot the database holds, and claiming "saved"
      // when it might not be is the wrong way to be wrong.
      dirty: true,
    }
  }),

  redo: () => set(s => {
    const next = s.future.at(-1)
    if (!next) return {}
    const again = next.edit?.op
    return {
      ...restore(s, next),
      future: s.future.slice(0, -1),
      past: [...s.past, { ...snapshot(s), edit: next.edit }],
      ...(again
        ? { comments: reanchor(s.comments, again), anchorOps: [...s.anchorOps, again] }
        : {}),
      dirty: true,
    }
  }),

  setComments: comments => set({ comments }),

  /**
   * Move a cue in time, in every language at once.
   *
   * A cue is one moment of the recording that happens to have been written
   * several times over. Retiming only the tab somebody is looking at would let
   * the Spanish and the English drift apart until an export silently disagreed
   * with itself — and nothing in the editor would show it, because each tab
   * looks right on its own.
   */
  retimeSubtitle: (index, start, end) => set(s => {
    const move = (subs: Subtitle[]) =>
      subs.map(sub => (sub.index === index ? { ...sub, start, end } : sub))

    return {
      subtitles: move(s.subtitles),
      translations: Object.fromEntries(
        Object.entries(s.translations).map(([lang, subs]) => [lang, move(subs)]),
      ),
      dirty: true,
    }
  }),

  splitSubtitle: (index, atSec) => {
    const edit = splitAnchors(index)
    get().pushUndo(edit)
    set(s => ({
      ...structural(s, subs => splitCue(subs, index, atSec)),
      comments: reanchor(s.comments, edit.op),
      anchorOps: [...s.anchorOps, edit.op],
    }))
  },

  deleteSubtitle: index => {
    const edit = deleteAnchors(index)
    get().pushUndo(edit)
    set(s => ({
      ...structural(s, subs => deleteCue(subs, index)),
      comments: reanchor(s.comments, edit.op),
      anchorOps: [...s.anchorOps, edit.op],
    }))
  },

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

  // Not part of the undo history: the history is for the cues, and a table of
  // terminology is edited a field at a time by somebody who can see it.
  // `dirty` too, so the unsaved dot appears: the terms are part of the work even
  // though they are written to a different row.
  setGlossary: entries => set({ glossary: entries, glossaryDirty: true, dirty: true }),

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
