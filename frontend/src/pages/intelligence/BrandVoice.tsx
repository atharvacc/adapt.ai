import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Mic,
  X,
  ChevronLeft,
  Sliders,
  Pencil,
  BookOpen,
  Check,
  Loader2,
  AlertCircle,
  Tag,
  Save,
  History,
  RotateCcw,
  ChevronRight,
  ChevronDown,
} from 'lucide-react'
import { listVoices, createVoice, getVoice, updateVoice, listAccounts, listVersions, restoreVersion } from '../../lib/api'
import type { Version } from '../../lib/api'
import { PlatformIcon, PLATFORM_LABELS } from '../../components/PlatformIcon'
import type { Platform } from '../../types'

type Voice = Record<string, unknown>

function ConsistencyBadge({ value }: { value: number }) {
  const r = 16
  const circ = 2 * Math.PI * r
  const offset = circ - (value / 100) * circ
  const color = value >= 70 ? '#22C55E' : value >= 40 ? '#F59E0B' : '#EF4444'
  return (
    <div className="relative inline-flex items-center justify-center w-10 h-10">
      <svg width="40" height="40" className="-rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="#E5E7EB" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute text-[10px] font-bold text-gray-700">{value}%</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'generating') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        <Loader2 size={10} className="animate-spin" /> Generating
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        <AlertCircle size={10} /> Error
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      <Check size={10} /> Ready
    </span>
  )
}

function VoiceCard({
  voice,
  onClick,
}: {
  voice: Voice
  onClick: () => void
}) {
  const name = (voice.name as string) ?? 'Untitled'
  const purpose = (voice.purpose as string) ?? ''
  const consistency = (voice.consistency_score as number) ?? 0
  const postsTrained = (voice.posts_trained_on as number) ?? 0
  const status = (voice.status as string) ?? 'generated'
  const sourceIds = (voice.source_account_ids as string[]) ?? []

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:shadow-md hover:border-indigo-300"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50">
            <Mic size={18} className="text-indigo-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">{name}</h3>
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-gray-500 line-clamp-1">{purpose}</p>
          </div>
        </div>
        {consistency > 0 && <ConsistencyBadge value={consistency} />}
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          {postsTrained} posts trained
        </span>
        {sourceIds.length > 0 && (
          <span>{sourceIds.length} source account{sourceIds.length !== 1 ? 's' : ''}</span>
        )}
      </div>
    </button>
  )
}

function CreateVoiceModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [timePeriod, setTimePeriod] = useState('6mo')
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: listAccounts,
  })

  const activeAccounts = accounts.filter((a) => {
    const status = a.status as string
    const hasPosts = ((a.imported_posts as unknown[]) ?? []).length > 0
    return (status === 'active' || status === 'connected') && hasPosts
  })

  function toggleAccount(id: string) {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function selectAll() {
    if (selectedAccountIds.length === activeAccounts.length) {
      setSelectedAccountIds([])
    } else {
      setSelectedAccountIds(activeAccounts.map((a) => a.id as string))
    }
  }

  const mutation = useMutation({
    mutationFn: () =>
      createVoice(name.trim(), purpose.trim() || 'Brand voice', selectedAccountIds, timePeriod),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voices'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-900">Create Brand Voice</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100">
            <X size={18} className="text-gray-400" />
          </button>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Professional LinkedIn Voice"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Purpose</label>
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={2}
              placeholder="Describe what this voice is for..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none resize-none"
            />
          </div>

          {/* Source Accounts */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Source Accounts
              </label>
              {activeAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                >
                  {selectedAccountIds.length === activeAccounts.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>
            {activeAccounts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center">
                <p className="text-sm text-gray-400">
                  No active accounts with posts. Import accounts first.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto rounded-lg border border-gray-200 p-2">
                {activeAccounts.map((acct) => {
                  const id = acct.id as string
                  const handle = acct.handle as string
                  const platform = acct.platform as Platform
                  const postCount = ((acct.imported_posts as unknown[]) ?? []).length
                  const selected = selectedAccountIds.includes(id)

                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleAccount(id)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        selected
                          ? 'bg-indigo-50 border border-indigo-200'
                          : 'bg-white border border-transparent hover:bg-gray-50'
                      }`}
                    >
                      <div
                        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                          selected
                            ? 'border-indigo-500 bg-indigo-500'
                            : 'border-gray-300 bg-white'
                        }`}
                      >
                        {selected && <Check size={12} className="text-white" />}
                      </div>
                      <PlatformIcon platform={platform} size={18} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-900 truncate block">
                          {handle}
                        </span>
                        <span className="text-xs text-gray-400">
                          {PLATFORM_LABELS[platform]} &middot; {postCount} posts
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            {selectedAccountIds.length > 0 && (
              <p className="mt-1.5 text-xs text-indigo-600">
                {selectedAccountIds.length} account{selectedAccountIds.length !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>

          {/* Training Period */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Training Period
            </label>
            <p className="text-xs text-gray-400 mb-1.5">
              Posts without dates are treated as recent and always included.
            </p>
            <select
              value={timePeriod}
              onChange={(e) => setTimePeriod(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            >
              <option value="3mo">Last 3 months</option>
              <option value="6mo">Last 6 months</option>
              <option value="12mo">Last 12 months</option>
              <option value="all">All time</option>
            </select>
          </div>

          <button
            type="button"
            disabled={!name.trim() || selectedAccountIds.length === 0 || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="mt-1 w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Creating...' : 'Create Voice'}
          </button>
          {selectedAccountIds.length === 0 && name.trim() && (
            <p className="text-xs text-amber-600 text-center -mt-2">
              Select at least one source account
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  formality: 'Formality',
  confidence: 'Confidence',
  warmth: 'Warmth',
  technical_depth: 'Technical Depth',
  storytelling: 'Storytelling',
  humor: 'Humor',
  urgency: 'Urgency',
  authority: 'Authority',
}

function EditableTagList({
  label,
  items,
  onChange,
  placeholder,
  color = 'indigo',
}: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
  color?: 'indigo' | 'red' | 'emerald'
}) {
  const [input, setInput] = useState('')
  const colorMap = {
    indigo: { bg: 'bg-indigo-50', border: 'border-indigo-100', text: 'text-indigo-700' },
    red: { bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-600' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-700' },
  }
  const c = colorMap[color]

  function add() {
    const t = input.trim()
    if (t && !items.includes(t)) {
      onChange([...items, t])
      setInput('')
    }
  }

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-700">{label}</label>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
        />
        <button type="button" onClick={add} className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
          Add
        </button>
      </div>
      {items.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={item} className={`inline-flex items-center gap-1.5 rounded-full ${c.bg} border ${c.border} px-3 py-1 text-xs font-medium ${c.text}`}>
              <Tag size={10} />
              {item}
              <button type="button" onClick={() => onChange(items.filter((x) => x !== item))} className="ml-0.5 hover:opacity-70">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function SectionHeader({
  title,
  editing,
  onToggle,
}: {
  title: string
  editing: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
          editing
            ? 'bg-indigo-50 text-indigo-600 border border-indigo-200'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
        }`}
      >
        <Pencil size={12} />
        {editing ? 'Editing' : 'Edit'}
      </button>
    </div>
  )
}

function VersionHistoryPanel({
  entityType,
  entityId,
  onRestore,
}: {
  entityType: string
  entityId: string
  onRestore: () => void
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [previewVersion, setPreviewVersion] = useState<Version | null>(null)

  const { data: versions = [] } = useQuery({
    queryKey: ['versions', entityType, entityId],
    queryFn: () => listVersions(entityType, entityId),
    enabled: expanded,
  })

  const restoreMut = useMutation({
    mutationFn: (version: number) => restoreVersion(entityType, entityId, version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice', entityId] })
      queryClient.invalidateQueries({ queryKey: ['voices'] })
      queryClient.invalidateQueries({ queryKey: ['persona', entityId] })
      queryClient.invalidateQueries({ queryKey: ['personas'] })
      queryClient.invalidateQueries({ queryKey: ['versions', entityType, entityId] })
      setPreviewVersion(null)
      onRestore()
    },
  })

  function formatDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors rounded-xl"
      >
        <span className="flex items-center gap-2">
          <History size={14} className="text-gray-400" />
          Version History
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          {versions.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">No previous versions yet. Versions are created when you save edits.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {versions.map((v) => (
                <div key={v.id} className={`flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors ${previewVersion?.id === v.id ? 'bg-indigo-50 border border-indigo-200' : 'bg-gray-50 hover:bg-gray-100'}`}>
                  <div>
                    <span className="text-sm font-medium text-gray-700">v{v.version}</span>
                    {v.snapshot.name ? <span className="ml-2 text-xs text-gray-400">{String(v.snapshot.name)}</span> : null}
                    <p className="text-xs text-gray-400">{v.created_at ? formatDate(v.created_at) : ''}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewVersion(previewVersion?.id === v.id ? null : v)}
                      className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-white hover:text-gray-700 transition-colors"
                    >
                      {previewVersion?.id === v.id ? 'Hide' : 'Preview'}
                    </button>
                    <button
                      type="button"
                      onClick={() => restoreMut.mutate(v.version)}
                      disabled={restoreMut.isPending}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={10} /> Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {previewVersion && (
            <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
              <p className="text-xs font-medium text-indigo-600 mb-2">Preview — v{previewVersion.version}</p>
              <div className="space-y-1.5 text-xs text-gray-600 max-h-48 overflow-y-auto">
                {previewVersion.snapshot.description ? <p><span className="font-medium">Description:</span> {String(previewVersion.snapshot.description).slice(0, 200)}...</p> : null}
                {previewVersion.snapshot.attributes ? (
                  <p><span className="font-medium">Attributes:</span> {Object.entries(previewVersion.snapshot.attributes as Record<string, number>).map(([k, v]) => `${ATTRIBUTE_LABELS[k] ?? k}: ${v}`).join(', ')}</p>
                ) : null}
                {previewVersion.snapshot.avoid_list && (previewVersion.snapshot.avoid_list as string[]).length > 0 ? (
                  <p><span className="font-medium">Avoid:</span> {(previewVersion.snapshot.avoid_list as string[]).join(', ')}</p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function VoiceDetail({ voice: initial, onBack }: { voice: Voice; onBack: () => void }) {
  const queryClient = useQueryClient()
  const [detailTab, setDetailTab] = useState<'overview' | 'patterns'>('overview')
  const voiceId = initial.id as string

  const { data: voice = initial } = useQuery({
    queryKey: ['voice', voiceId],
    queryFn: () => getVoice(voiceId),
    refetchInterval: (initial.status as string) === 'generating' ? 3000 : false,
  })

  const name = (voice.name as string) ?? 'Untitled'
  const purpose = (voice.purpose as string) ?? ''
  const description = (voice.description as string) ?? ''
  const status = (voice.status as string) ?? 'generated'
  const attributes = (voice.attributes as Record<string, number>) ?? {}
  const avoidList = (voice.avoid_list as string[]) ?? []
  const overrides = (voice.overrides as Record<string, unknown>) ?? {}
  const postsTrained = (voice.posts_trained_on as number) ?? 0
  const consistencyScore = (voice.consistency_score as number) ?? 0
  const toneDescriptors = (overrides.tone_descriptors as string[]) ?? []
  const vocabPatterns = (overrides.vocabulary_patterns as string[]) ?? []
  const structurePatterns = (overrides.structure_patterns as string[]) ?? []
  const platformNuances = (overrides.platform_nuances as Record<string, string>) ?? {}
  const webResearch = (overrides.web_research_notes as string) ?? ''
  const topPatterns = (overrides.top_performing_patterns as string) ?? ''

  // Per-section inline editing state
  const [editingSection, setEditingSection] = useState<string | null>(null)

  // Inline edit state (populated when a section enters edit mode)
  const [editName, setEditName] = useState(name)
  const [editPurpose, setEditPurpose] = useState(purpose)
  const [editDescription, setEditDescription] = useState(description)
  const [editAttributes, setEditAttributes] = useState(attributes)
  const [editAttrLabels, setEditAttrLabels] = useState<Record<string, string>>({})
  const [editAvoidList, setEditAvoidList] = useState(avoidList)
  const [editToneDescriptors, setEditToneDescriptors] = useState(toneDescriptors)
  const [editVocabPatterns, setEditVocabPatterns] = useState(vocabPatterns)
  const [editStructurePatterns, setEditStructurePatterns] = useState(structurePatterns)
  const [editPlatformNuances, setEditPlatformNuances] = useState(platformNuances)
  const [editWebResearch, setEditWebResearch] = useState(webResearch)
  const [editTopPatterns, setEditTopPatterns] = useState(topPatterns)

  function toggleSection(section: string) {
    if (editingSection === section) {
      setEditingSection(null)
    } else {
      // Reset edit state to current values when entering edit mode
      setEditName(name)
      setEditPurpose(purpose)
      setEditDescription(description)
      setEditAttributes(attributes)
      setEditAttrLabels({})
      setEditAvoidList(avoidList)
      setEditToneDescriptors(toneDescriptors)
      setEditVocabPatterns(vocabPatterns)
      setEditStructurePatterns(structurePatterns)
      setEditPlatformNuances(platformNuances)
      setEditWebResearch(webResearch)
      setEditTopPatterns(topPatterns)
      setEditingSection(section)
    }
  }

  function buildPayload() {
    // Remap attribute keys if any labels were changed
    const remappedAttrs: Record<string, number> = {}
    for (const [key, val] of Object.entries(editAttributes)) {
      const newLabel = editAttrLabels[key]
      if (newLabel && newLabel !== (ATTRIBUTE_LABELS[key] ?? key)) {
        const newKey = newLabel.toLowerCase().replace(/\s+/g, '_')
        remappedAttrs[newKey] = val
      } else {
        remappedAttrs[key] = val
      }
    }
    return {
      name: editName.trim(),
      purpose: editPurpose.trim(),
      description: editDescription.trim(),
      attributes: remappedAttrs,
      avoid_list: editAvoidList,
      overrides: {
        ...overrides,
        tone_descriptors: editToneDescriptors,
        vocabulary_patterns: editVocabPatterns,
        structure_patterns: editStructurePatterns,
        platform_nuances: editPlatformNuances,
        web_research_notes: editWebResearch,
        top_performing_patterns: editTopPatterns,
      },
    }
  }

  const saveMutation = useMutation({
    mutationFn: () => updateVoice(voiceId, buildPayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice', voiceId] })
      queryClient.invalidateQueries({ queryKey: ['voices'] })
      queryClient.invalidateQueries({ queryKey: ['versions', 'voices', voiceId] })
      setEditingSection(null)
    },
  })

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: Sliders },
    { id: 'patterns' as const, label: 'Patterns', icon: BookOpen },
  ]

  const isEditing = editingSection !== null

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ChevronLeft size={16} /> Back to voices
      </button>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
                <Mic size={20} className="text-indigo-500" />
              </div>
              {editingSection === 'header' ? (
                <div className="flex-1 space-y-2">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-lg font-semibold text-gray-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none" />
                  <input value={editPurpose} onChange={(e) => setEditPurpose(e.target.value)} placeholder="Purpose" className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none" />
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">{name}</h2>
                    <StatusBadge status={status} />
                  </div>
                  <p className="text-sm text-gray-500">{purpose}</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-xs text-gray-400">
                <div>{postsTrained} posts trained</div>
                {consistencyScore > 0 && <div>Consistency: {consistencyScore}%</div>}
              </div>
              <button
                type="button"
                onClick={() => toggleSection('header')}
                className={`rounded-lg p-2 transition-colors ${editingSection === 'header' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50'}`}
              >
                <Pencil size={14} />
              </button>
            </div>
          </div>
        </div>

        {status === 'generating' && (
          <div className="flex items-center gap-3 mx-6 mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
            <Loader2 size={16} className="text-amber-600 animate-spin" />
            <span className="text-sm text-amber-700">
              Analyzing posts and generating voice profile... This may take a minute.
            </span>
          </div>
        )}

        <div className="flex gap-0 border-b border-gray-100 px-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setDetailTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                detailTab === t.id
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>
        <div className="p-6">
          {detailTab === 'overview' && (
            <div className="space-y-6">
              {/* Description */}
              <div>
                <SectionHeader title="Description" editing={editingSection === 'description'} onToggle={() => toggleSection('description')} />
                {editingSection === 'description' ? (
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none resize-none"
                  />
                ) : description ? (
                  <div className="rounded-lg bg-indigo-50/50 border border-indigo-100 p-4">
                    <p className="text-sm text-gray-700 leading-relaxed">{description}</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No description yet. Click Edit to add one.</p>
                )}
              </div>

              {/* Voice Attributes */}
              <div>
                <SectionHeader title="Voice Attributes" editing={editingSection === 'attributes'} onToggle={() => toggleSection('attributes')} />
                {editingSection === 'attributes' ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                    {Object.keys(editAttributes).length > 0 ? (
                      <div className="space-y-3">
                        {Object.entries(editAttributes).map(([key, val]) => (
                          <div key={key} className="flex items-center gap-3">
                            <input
                              value={editAttrLabels[key] ?? (ATTRIBUTE_LABELS[key] ?? key)}
                              onChange={(e) => setEditAttrLabels({ ...editAttrLabels, [key]: e.target.value })}
                              className="w-36 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 focus:outline-none"
                            />
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={val}
                              onChange={(e) => setEditAttributes({ ...editAttributes, [key]: Number(e.target.value) })}
                              className="flex-1 accent-indigo-500"
                            />
                            <span className="w-10 text-right text-xs font-semibold text-gray-500">{val}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const next = { ...editAttributes }
                                delete next[key]
                                const nextLabels = { ...editAttrLabels }
                                delete nextLabels[key]
                                setEditAttributes(next)
                                setEditAttrLabels(nextLabels)
                              }}
                              className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 text-center py-2">No attributes yet. Add one below.</p>
                    )}

                    {(() => {
                      const usedKeys = new Set(Object.keys(editAttributes))
                      const availablePresets = Object.entries(ATTRIBUTE_LABELS).filter(([k]) => !usedKeys.has(k))
                      return (
                        <div className={`flex items-center gap-2 ${Object.keys(editAttributes).length > 0 ? 'mt-4 pt-4 border-t border-gray-200' : 'mt-1'}`}>
                          <select
                            id="new-attr-select"
                            defaultValue=""
                            className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none bg-white"
                          >
                            <option value="" disabled>Add an attribute...</option>
                            {availablePresets.map(([k, label]) => (
                              <option key={k} value={k}>{label}</option>
                            ))}
                            <option value="__custom">Custom attribute...</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              const sel = document.getElementById('new-attr-select') as HTMLSelectElement
                              const val = sel.value
                              if (!val) return
                              if (val === '__custom') {
                                const custom = prompt('Enter custom attribute name:')
                                if (custom) {
                                  const key = custom.toLowerCase().replace(/\s+/g, '_')
                                  if (!editAttributes[key]) {
                                    setEditAttributes({ ...editAttributes, [key]: 50 })
                                  }
                                }
                              } else if (!editAttributes[val]) {
                                setEditAttributes({ ...editAttributes, [val]: 50 })
                              }
                              sel.value = ''
                            }}
                            className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-600 transition-colors"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      )
                    })()}
                  </div>
                ) : Object.keys(attributes).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(attributes).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-4">
                        <span className="w-32 text-sm text-gray-600">
                          {ATTRIBUTE_LABELS[key] ?? key}
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${value}%` }} />
                        </div>
                        <span className="w-8 text-right text-xs font-medium text-gray-500">{value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No attributes yet. Click Edit to add them.</p>
                )}
              </div>

              {/* Tone */}
              <div>
                <SectionHeader title="Tone" editing={editingSection === 'tone'} onToggle={() => toggleSection('tone')} />
                {editingSection === 'tone' ? (
                  <EditableTagList label="" items={editToneDescriptors} onChange={setEditToneDescriptors} placeholder="e.g. confident, warm" />
                ) : toneDescriptors.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {toneDescriptors.map((t) => (
                      <span key={t} className="rounded-full bg-indigo-50 border border-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700">{t}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No tone descriptors yet.</p>
                )}
              </div>

              {/* Avoid List */}
              <div>
                <SectionHeader title="Avoid List" editing={editingSection === 'avoid'} onToggle={() => toggleSection('avoid')} />
                {editingSection === 'avoid' ? (
                  <EditableTagList label="" items={editAvoidList} onChange={setEditAvoidList} placeholder="e.g. jargon, passive voice" color="red" />
                ) : avoidList.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {avoidList.map((item, i) => (
                      <span key={i} className="rounded-full bg-red-50 border border-red-100 px-3 py-1 text-xs font-medium text-red-600">{item}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No avoid-list items yet.</p>
                )}
              </div>

              {/* Top Patterns */}
              <div>
                <SectionHeader title="Top-Performing Content Patterns" editing={editingSection === 'topPatterns'} onToggle={() => toggleSection('topPatterns')} />
                {editingSection === 'topPatterns' ? (
                  <textarea value={editTopPatterns} onChange={(e) => setEditTopPatterns(e.target.value)} rows={3} className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none resize-none" />
                ) : topPatterns ? (
                  <div className="rounded-lg bg-emerald-50/50 border border-emerald-100 p-4">
                    <p className="text-sm text-gray-700 leading-relaxed">{topPatterns}</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No top patterns yet.</p>
                )}
              </div>

              {/* Web Research */}
              <div>
                <SectionHeader title="Web Research Insights" editing={editingSection === 'webResearch'} onToggle={() => toggleSection('webResearch')} />
                {editingSection === 'webResearch' ? (
                  <textarea value={editWebResearch} onChange={(e) => setEditWebResearch(e.target.value)} rows={3} className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none resize-none" />
                ) : webResearch ? (
                  <div className="rounded-lg bg-sky-50/50 border border-sky-100 p-4">
                    <p className="text-sm text-gray-700 leading-relaxed">{webResearch}</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No web research insights yet.</p>
                )}
              </div>

              {Object.keys(attributes).length === 0 && !description && !topPatterns && !webResearch && avoidList.length === 0 && toneDescriptors.length === 0 && status === 'generated' && !isEditing && (
                <div className="flex flex-col items-center py-8 text-gray-400">
                  <Mic size={32} className="mb-2 opacity-40" />
                  <p className="text-sm">No voice data yet.</p>
                  <p className="text-xs mt-1">Voice was created without source accounts. Click any Edit button to add content.</p>
                </div>
              )}
            </div>
          )}

          {detailTab === 'patterns' && (
            <div className="space-y-6">
              {/* Vocabulary Patterns */}
              <div>
                <SectionHeader title="Vocabulary Patterns" editing={editingSection === 'vocab'} onToggle={() => toggleSection('vocab')} />
                {editingSection === 'vocab' ? (
                  <EditableTagList label="" items={editVocabPatterns} onChange={setEditVocabPatterns} placeholder="Add a vocabulary pattern..." />
                ) : vocabPatterns.length > 0 ? (
                  <ul className="space-y-1.5">
                    {vocabPatterns.map((p, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600 rounded-lg bg-gray-50 px-3 py-2">
                        <span className="mt-0.5 text-indigo-400">&bull;</span> {p}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-400 italic">No vocabulary patterns yet.</p>
                )}
              </div>

              {/* Structure Patterns */}
              <div>
                <SectionHeader title="Structure Patterns" editing={editingSection === 'structure'} onToggle={() => toggleSection('structure')} />
                {editingSection === 'structure' ? (
                  <EditableTagList label="" items={editStructurePatterns} onChange={setEditStructurePatterns} placeholder="Add a structure pattern..." color="emerald" />
                ) : structurePatterns.length > 0 ? (
                  <ul className="space-y-1.5">
                    {structurePatterns.map((p, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600 rounded-lg bg-gray-50 px-3 py-2">
                        <span className="mt-0.5 text-indigo-400">&bull;</span> {p}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-400 italic">No structure patterns yet.</p>
                )}
              </div>

              {/* Platform Nuances */}
              <div>
                <SectionHeader title="Platform Nuances" editing={editingSection === 'platformNuances'} onToggle={() => toggleSection('platformNuances')} />
                {editingSection === 'platformNuances' ? (
                  <div className="space-y-3">
                    {Object.entries(editPlatformNuances).map(([platform, nuance]) => (
                      <div key={platform} className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50 border border-gray-200 mt-1">
                          <PlatformIcon platform={platform as Platform} size={18} />
                        </div>
                        <div className="flex-1">
                          <label className="mb-1 block text-xs font-medium text-gray-500">{PLATFORM_LABELS[platform as Platform] ?? platform}</label>
                          <textarea
                            value={nuance}
                            onChange={(e) => setEditPlatformNuances({ ...editPlatformNuances, [platform]: e.target.value })}
                            rows={2}
                            className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none resize-none"
                          />
                        </div>
                      </div>
                    ))}
                    {Object.keys(editPlatformNuances).length === 0 && (
                      <p className="text-sm text-gray-400 italic">No platform nuances to edit.</p>
                    )}
                  </div>
                ) : Object.entries(platformNuances).filter(([, v]) => v).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(platformNuances).filter(([, v]) => v).map(([platform, nuance]) => (
                      <div key={platform} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                        <PlatformIcon platform={platform as Platform} size={18} />
                        <div>
                          <span className="text-xs font-semibold text-gray-700">{PLATFORM_LABELS[platform as Platform] ?? platform}</span>
                          <p className="text-sm text-gray-600 mt-0.5">{nuance}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No platform nuances yet.</p>
                )}
              </div>

              {vocabPatterns.length === 0 && structurePatterns.length === 0 && Object.keys(platformNuances).length === 0 && !isEditing && (
                <div className="flex flex-col items-center py-8 text-gray-400">
                  <BookOpen size={32} className="mb-2 opacity-40" />
                  <p className="text-sm">No patterns extracted yet.</p>
                </div>
              )}
            </div>
          )}

          {/* Floating save bar */}
          {isEditing && (
            <div className="mt-6 flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/50 px-5 py-3">
              <span className="text-sm text-indigo-600">You have unsaved changes</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditingSection(null)}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-gray-500 hover:bg-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!editName.trim() || saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                  className="flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save size={14} />
                  {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Version History */}
      <div className="mt-4">
        <VersionHistoryPanel
          entityType="voices"
          entityId={voiceId}
          onRestore={() => setEditingSection(null)}
        />
      </div>
    </div>
  )
}

export function BrandVoice() {
  const [showCreate, setShowCreate] = useState(false)
  const [selectedVoice, setSelectedVoice] = useState<Voice | null>(null)

  const { data: voices = [], isLoading } = useQuery({
    queryKey: ['voices'],
    queryFn: listVoices,
    refetchInterval: (query) => {
      const data = query.state.data as Voice[] | undefined
      if (data?.some((v) => (v.status as string) === 'generating')) return 3000
      return false
    },
  })

  if (selectedVoice) {
    return <VoiceDetail voice={selectedVoice} onBack={() => setSelectedVoice(null)} />
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Brand Voices</h2>
          <p className="text-sm text-gray-500">
            Define and manage your brand's tonal identity across platforms
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-600"
        >
          <Plus size={16} /> Create Voice
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : voices.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-16">
          <Mic size={36} className="mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No voices yet</p>
          <p className="text-xs text-gray-400 mt-1">
            Create a brand voice from your imported social accounts
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {voices.map((v, i) => (
            <VoiceCard key={(v.id as string) ?? i} voice={v} onClick={() => setSelectedVoice(v)} />
          ))}
        </div>
      )}

      {showCreate && <CreateVoiceModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}
