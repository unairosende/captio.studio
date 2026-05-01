'use client'

import { useSubtitleStore } from '@/store/useSubtitleStore'
import { LANG_CODES } from '@/lib/providers'

export default function LangTabsBar() {
  const { subtitles, translations, activeTab, switchToTab, closeTab } = useSubtitleStore()
  const langs = Object.keys(translations)

  const tabCls = (active: boolean, src = false) =>
    `flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer border-b-2 whitespace-nowrap transition-all select-none ` +
    (active
      ? src ? 'text-[var(--text)] border-[var(--border2)]' : 'text-[var(--accent)] border-[var(--accent)]'
      : 'text-[var(--text3)] border-transparent hover:text-[var(--text2)]')

  return (
    <div
      style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--border)', padding: '0 12px' }}
      className="flex items-center gap-0 shrink-0 overflow-x-auto min-h-[38px]"
    >
      <div className={tabCls(activeTab === 'source', true)} onClick={() => switchToTab('source')}>
        Source
      </div>

      {langs.length > 0 && (
        <>
          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 6px', flexShrink: 0 }} />
          {langs.map(lang => {
            const code = LANG_CODES[lang] ?? lang.slice(0, 2).toUpperCase()
            const active = activeTab === lang
            return (
              <div key={lang} className={tabCls(active)} onClick={() => switchToTab(lang)}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
                {code}
                <span
                  onClick={e => { e.stopPropagation(); closeTab(lang) }}
                  title={`Remove ${lang}`}
                  style={{ width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, color: 'var(--text3)', fontSize: 13, transition: 'all .15s', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.target as HTMLElement).style.background = 'var(--red-dim)'; (e.target as HTMLElement).style.color = 'var(--red)' }}
                  onMouseLeave={e => { (e.target as HTMLElement).style.background = ''; (e.target as HTMLElement).style.color = 'var(--text3)' }}
                >
                  ×
                </span>
              </div>
            )
          })}
        </>
      )}

      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)', paddingLeft: 12, flexShrink: 0, fontFamily: 'var(--mono)' }}>
        {langs.length ? `${langs.length} language${langs.length > 1 ? 's' : ''}` : subtitles.length ? 'no translations yet' : ''}
      </span>
    </div>
  )
}
