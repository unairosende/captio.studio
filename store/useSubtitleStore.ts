'use client'

import { create } from 'zustand'
import type {
  Subtitle, TranslationStore, BackTranslationStore,
  OutputMode, ViewMode,
} from '@/types/subtitle'
import { finalSubs, qcForMode } from '@/lib/subtitles'

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

  // Actions
  loadSubtitles: (subs: Subtitle[]) => void
  clearAll: () => void
  setTranslation: (lang: string, subs: Subtitle[]) => void
  updateSubtitle: (lang: string, index: number, text: string) => void
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

  loadSubtitles: subs => set({
    subtitles: subs,
    translations: {},
    backTranslations: {},
    activeTab: 'source',
    translateJob: defaultJob,
  }),

  clearAll: () => set({
    subtitles: [],
    translations: {},
    backTranslations: {},
    activeTab: 'source',
    translateJob: defaultJob,
    backTranslateJob: defaultJob,
    transcribeJob: defaultJob,
  }),

  setTranslation: (lang, subs) => set(s => ({
    translations: { ...s.translations, [lang]: subs },
    activeTab: lang,
  })),

  updateSubtitle: (lang, index, text) => set(s => {
    const subs = s.translations[lang]?.map(sub => sub.index === index ? { ...sub, text } : sub) ?? []
    return { translations: { ...s.translations, [lang]: subs } }
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
