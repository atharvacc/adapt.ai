import { useEffect, useState } from 'react'
import {
  Save,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Eye,
  EyeOff,
  Cpu,
} from 'lucide-react'
import { getSettings, updateSettings } from '../lib/api'

type FieldDef = {
  key: string
  label: string
  placeholder: string
}

type SectionDef = {
  id: string
  title: string
  description: string
  helpUrl?: string
  helpLabel?: string
  fields: FieldDef[]
}

const SECTIONS: SectionDef[] = [
  {
    id: 'anthropic',
    title: 'Claude (Anthropic)',
    description: 'Powers all AI content generation, adaptation, validation, and research agents.',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    helpLabel: 'Get API Key',
    fields: [
      { key: 'anthropic_api_key', label: 'API Key', placeholder: 'sk-ant-api03-...' },
    ],
  },
  {
    id: 'openai',
    title: 'OpenAI (GPT Image 1.5)',
    description: 'Generates platform-optimized images for each content variant.',
    helpUrl: 'https://platform.openai.com/api-keys',
    helpLabel: 'Get API Key',
    fields: [
      { key: 'openai_api_key', label: 'API Key', placeholder: 'sk-...' },
    ],
  },
  {
    id: 'xai',
    title: 'xAI (Grok Imagine Video)',
    description: 'Generates short video clips for video-native platforms (TikTok, Instagram).',
    helpUrl: 'https://console.x.ai/',
    helpLabel: 'Get API Key',
    fields: [
      { key: 'xai_api_key', label: 'API Key', placeholder: 'xai-...' },
    ],
  },
  {
    id: 'voyage',
    title: 'Voyage AI (Embeddings)',
    description: 'Vector embeddings for RAG retrieval. Optional — falls back to keyword search.',
    helpUrl: 'https://dash.voyageai.com/api-keys',
    helpLabel: 'Get API Key',
    fields: [
      { key: 'voyage_api_key', label: 'API Key', placeholder: 'pa-...' },
    ],
  },
  {
    id: 'langsmith',
    title: 'LangSmith (Agent Tracing)',
    description: 'Traces every LLM call and agent step in the LangSmith dashboard. Optional — tracing is disabled when no key is set.',
    helpUrl: 'https://smith.langchain.com/',
    helpLabel: 'Open LangSmith',
    fields: [
      { key: 'langsmith_api_key', label: 'API Key', placeholder: 'lsv2_pt_...' },
      { key: 'langsmith_project', label: 'Project Name', placeholder: 'adapt-ai' },
    ],
  },
]

export function Settings() {
  const [values, setValues] = useState<Record<string, string>>({})
  const [configured, setConfigured] = useState<Record<string, boolean>>({})
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})

  useEffect(() => {
    getSettings()
      .then((data) => {
        setValues(data.values)
        setConfigured(data.configured)
      })
      .catch(() => setError('Could not load settings — is the backend running?'))
  }, [])

  function handleChange(key: string, val: string) {
    setEdits((prev) => ({ ...prev, [key]: val }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const data = await updateSettings(edits)
      setValues(data.values)
      setConfigured(data.configured)
      setEdits({})
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const hasEdits = Object.values(edits).some((v) => v.length > 0)

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage API keys and OAuth credentials. Changes take effect immediately — no restart needed.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <CheckCircle2 size={16} /> Saved
            </span>
          )}
          {error && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-red-500">
              <AlertTriangle size={14} /> {error}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !hasEdits}
            className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {SECTIONS.map((section) => {
          const isConfigured = section.fields.every((f) => configured[f.key])
          const isPartial = section.fields.some((f) => configured[f.key]) && !isConfigured

          return (
            <div
              key={section.id}
              className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
            >
              {/* Section header */}
              <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-gray-200 shadow-sm">
                  <Cpu size={20} className="text-indigo-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{section.title}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      isConfigured
                        ? 'bg-emerald-50 text-emerald-700'
                        : isPartial
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {isConfigured ? 'Configured' : isPartial ? 'Partial' : 'Not configured'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">{section.description}</p>
                </div>
                {section.helpUrl && (
                  <a
                    href={section.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                  >
                    {section.helpLabel} <ExternalLink size={10} />
                  </a>
                )}
              </div>

              {/* Fields */}
              <div className="px-6 py-4 space-y-4">
                {section.fields.map((field) => {
                  const currentVal = edits[field.key] ?? ''
                  const savedVal = values[field.key] ?? ''
                  const isSecret = field.key.includes('secret') || field.key.includes('api_key') || field.key.includes('app_secret')
                  const visible = showSecrets[field.key]

                  return (
                    <div key={field.key}>
                      <label className="mb-1.5 flex items-center justify-between text-sm font-medium text-gray-700">
                        {field.label}
                        {isSecret && savedVal && (
                          <button
                            type="button"
                            onClick={() => setShowSecrets((p) => ({ ...p, [field.key]: !p[field.key] }))}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        )}
                      </label>
                      <input
                        type={isSecret && !visible ? 'password' : 'text'}
                        value={currentVal || (isSecret && !visible ? savedVal : savedVal)}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
