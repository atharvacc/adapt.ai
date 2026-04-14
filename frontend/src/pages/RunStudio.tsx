import { useState } from 'react'
import { createRun, regenerateVariant, updateVariant } from '../lib/api'
import { PlatformIcon, PLATFORM_LABELS } from '../components/PlatformIcon'
import type { Platform, RunResponse } from '../types'

export function RunStudio() {
  const [sourceContent, setSourceContent] = useState('')
  const [run, setRun] = useState<RunResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})

  async function generate() {
    setLoading(true)
    try {
      const data = await createRun(sourceContent)
      setRun(data)
      setEdits({})
    } finally {
      setLoading(false)
    }
  }

  async function acceptVariant(platform: Platform, variantId: string) {
    if (!run) return
    const data = await updateVariant(run.run_id, platform, variantId, { status: 'accepted' })
    setRun(data)
  }

  async function saveEdit(platform: Platform, variantId: string) {
    if (!run) return
    const edit = edits[variantId]
    if (!edit) return
    const data = await updateVariant(run.run_id, platform, variantId, { text: edit })
    setRun(data)
  }

  async function regenerate(platform: Platform, variantId: string) {
    if (!run) return
    const data = await regenerateVariant(run.run_id, platform, variantId)
    setRun(data)
  }

  return (
    <section className="panel">
      <h2>Run Studio</h2>
      <textarea
        value={sourceContent}
        onChange={(e) => setSourceContent(e.target.value)}
        placeholder="Paste source content, blog excerpt, or transcript..."
      />
      <button onClick={generate} disabled={loading || sourceContent.length < 20}>
        {loading ? 'Generating...' : 'Generate Platform Variants'}
      </button>

      {run && (
        <section className="grid">
          {run.outputs.map((output) => (
            <article key={output.platform} className="platform">
              <h3 className="flex items-center gap-2">
                <PlatformIcon platform={output.platform} size={18} />
                {PLATFORM_LABELS[output.platform]}
              </h3>
              {output.variants.map((variant) => (
                <div key={variant.id} className="variant">
                  <div className="variant-header">
                    <strong>{variant.label}</strong>
                    <span className={`status status-${variant.status}`}>{variant.status}</span>
                  </div>
                  <p>{variant.text}</p>
                  <textarea
                    value={edits[variant.id] ?? variant.text}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [variant.id]: e.target.value }))
                    }
                  />
                  <div className="row">
                    <button onClick={() => acceptVariant(output.platform, variant.id)}>
                      Accept
                    </button>
                    <button onClick={() => saveEdit(output.platform, variant.id)}>Save Edit</button>
                    <button onClick={() => regenerate(output.platform, variant.id)}>
                      Regenerate
                    </button>
                  </div>
                  <small>{variant.rationale}</small>
                </div>
              ))}
            </article>
          ))}
        </section>
      )}
    </section>
  )
}
