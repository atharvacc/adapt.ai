import { useState, useCallback } from 'react'
import { Route, Routes, useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Play,
  Check,
  Clock,
  AlertCircle,
  ArrowLeft,
  RefreshCw,
  Pencil,
  GitBranch,
  X,
  Trash2,
  Upload,
  Image as ImageIcon,
  FileText,
  ShieldCheck,
  Eye,
  Send,
  ScrollText,
  Sparkles,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  History,
  Save,
  ArrowRight,
  MessageSquare,
  Layers,
  Copy,
  RotateCcw,
  Settings,
  Database,
  Search,
  BookOpen,
  Lightbulb,
  Globe,
  ChevronUp,
} from 'lucide-react'
import {
  listWorkflows,
  createWorkflowDefinition,
  createWorkflowRun,
  getWorkflowRun,
  updateWorkflowNode,
  updateWorkflowDefinition,
  deleteWorkflow,
  listWorkflowRuns,
  getWorkflow,
  uploadImage,
  getRunAudit,
  getRunTraces,
  getRunChangelog,
  updateRunSource,
  seedRuleSets,
  listVoices,
  listPersonas,
  listRuleSets,
  submitFeedback,
  getEditSuggestions,
  chatWithDraft,
  chatWithDraftSession,
  summarizeChanges,
  propagateChanges,
  getEditHistory,
  type TraceEntry,
} from '../lib/api'
import type {
  Platform,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowNode,
  Variant,
  AuditEntry,
  ValidationResult,
  RationaleStruct,
  DiffOp,
  EditRecordEntry,
  ChangeItem,
  ChatSessionMessage,
} from '../types'
import { PlatformIcon, PLATFORM_LABELS } from '../components/PlatformIcon'

// ─── Constants ───────────────────────────────────────────────────────────────

const PLATFORM_ABBR: Record<Platform, string> = { linkedin: 'LI', x: 'X', instagram: 'IG', tiktok: 'TT' }
const ALL_PLATFORMS: Platform[] = ['linkedin', 'x', 'instagram', 'tiktok']

const COMPOSITION_COLORS: Record<string, { dot: string; border: string }> = {
  voice: { dot: 'bg-indigo-400', border: 'border-l-indigo-400' },
  agent: { dot: 'bg-amber-400', border: 'border-l-amber-400' },
  audience: { dot: 'bg-green-400', border: 'border-l-green-400' },
  rules: { dot: 'bg-gray-400', border: 'border-l-gray-400' },
}

const ACTIVITY_ICONS: Record<string, { icon: typeof Search; color: string }> = {
  audience_platform: { icon: BookOpen, color: 'text-green-500 bg-green-50' },
  trends_listening: { icon: Sparkles, color: 'text-pink-500 bg-pink-50' },
  competitor_industry: { icon: Eye, color: 'text-blue-500 bg-blue-50' },
  brand_knowledge: { icon: Database, color: 'text-indigo-500 bg-indigo-50' },
}

const ACTIVITY_LABELS: Record<string, string> = {
  audience_platform: 'Audience & Platform Intelligence',
  trends_listening: 'Trends & Social Listening',
  competitor_industry: 'Competitor & Industry Analysis',
  brand_knowledge: 'Brand & Internal Knowledge',
}

const ACTIVITY_DESCRIPTIONS: Record<string, string> = {
  audience_platform: 'Audience demographics, algorithm signals, optimal formats, timing, and visual best practices',
  trends_listening: 'Trending topics, hashtags, hook benchmarking, engagement triggers, and live conversations',
  competitor_industry: 'Competitor content patterns, industry news, supporting data/stats, and gaps to exploit',
  brand_knowledge: 'Brand voice guidelines, internal rules, personal stories, and customer proof points',
}

const ALL_ACTIVITY_KEYS = Object.keys(ACTIVITY_LABELS)

type NodeKind = 'source' | 'adapt' | 'edit' | 'review' | 'publish'

const NODE_META: Record<NodeKind, { label: string; color: string; activeBorder: string; icon: typeof FileText }> = {
  source:  { label: 'Source Input',      color: 'bg-slate-50 border-slate-300', activeBorder: 'ring-slate-400', icon: FileText },
  adapt:   { label: 'Adapt + Validate',  color: 'bg-indigo-50 border-indigo-300', activeBorder: 'ring-indigo-400', icon: Sparkles },
  edit:    { label: 'Edit',              color: 'bg-amber-50 border-amber-300', activeBorder: 'ring-amber-400', icon: Pencil },
  review:  { label: 'Review',            color: 'bg-emerald-50 border-emerald-300', activeBorder: 'ring-emerald-400', icon: Eye },
  publish: { label: 'Publish',           color: 'bg-cyan-50 border-cyan-300', activeBorder: 'ring-cyan-400', icon: Send },
}

// ─── Shared Components ──────────────────────────────────────────────────────

function PlatformChip({ platform }: { platform: Platform }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">
      <PlatformIcon platform={platform} size={12} />
      {PLATFORM_ABBR[platform]}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-blue-100 text-blue-700', done: 'bg-green-100 text-green-700', failed: 'bg-red-100 text-red-700',
    running: 'bg-amber-100 text-amber-700', pending: 'bg-gray-100 text-gray-500', completed: 'bg-green-100 text-green-700',
    review: 'bg-purple-100 text-purple-700',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status === 'done' || status === 'completed' ? <Check size={10} /> : status === 'failed' ? <AlertCircle size={10} /> :
       status === 'running' ? <RefreshCw size={10} className="animate-spin" /> : status === 'pending' ? <Clock size={10} /> :
       status === 'review' ? <Eye size={10} /> : <Play size={10} />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function statusDotColor(status: string) {
  if (status === 'done' || status === 'completed') return 'bg-green-500'
  if (status === 'running' || status === 'in_progress') return 'bg-amber-400 animate-pulse'
  if (status === 'failed') return 'bg-red-500'
  return 'bg-gray-300'
}

// ─── Workflow List ───────────────────────────────────────────────────────────

function WorkflowList() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [showNewForm, setShowNewForm] = useState(false)
  const { data: definitions = [], isLoading } = useQuery({ queryKey: ['workflows'], queryFn: listWorkflows })

  if (isLoading) return <div className="flex items-center justify-center py-20"><RefreshCw size={24} className="animate-spin text-gray-400" /></div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div><h1 className="text-xl font-semibold text-gray-900">Workflows</h1><p className="mt-1 text-sm text-gray-500">Create and manage content adaptation pipelines</p></div>
        <button onClick={() => setShowNewForm(true)} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"><Plus size={16} /> New Workflow</button>
      </div>
      {showNewForm && <NewWorkflowForm onClose={() => setShowNewForm(false)} onCreated={(id) => { setShowNewForm(false); queryClient.invalidateQueries({ queryKey: ['workflows'] }); navigate(id) }} />}
      {definitions.length === 0 && !showNewForm && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center"><GitBranch size={40} className="mx-auto mb-3 text-gray-300" /><p className="text-sm text-gray-500">No workflows yet.</p></div>
      )}
      <div className="space-y-3">{definitions.map((def) => <WorkflowCard key={def.id} definition={def} onOpen={() => navigate(def.id)} onDeleted={() => queryClient.invalidateQueries({ queryKey: ['workflows'] })} />)}</div>
    </div>
  )
}

function WorkflowCard({ definition, onOpen, onDeleted }: { definition: WorkflowDefinition; onOpen: () => void; onDeleted: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteMut = useMutation({ mutationFn: () => deleteWorkflow(definition.id), onSuccess: onDeleted })
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm hover:border-indigo-200 hover:shadow-md transition-all">
      <button onClick={onOpen} className="flex w-full items-center gap-4 px-5 py-4 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50"><GitBranch size={18} className="text-indigo-500" /></div>
        <div className="min-w-0 flex-1"><span className="font-medium text-gray-900">{definition.name}</span>{definition.description && <p className="mt-0.5 truncate text-xs text-gray-400">{definition.description}</p>}</div>
        <div className="flex items-center gap-2">{(definition.platforms ?? []).map((p) => <PlatformChip key={p} platform={p} />)}</div>
        <ChevronRight size={18} className="shrink-0 text-gray-300" />
      </button>
      {confirmDelete ? (
        <div className="flex items-center gap-3 border-t border-red-100 bg-red-50 px-5 py-3">
          <span className="text-sm text-red-700">Delete this workflow?</span>
          <button onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">{deleteMut.isPending ? 'Deleting...' : 'Confirm'}</button>
          <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-red-100">Cancel</button>
        </div>
      ) : (
        <div className="flex justify-end border-t border-gray-100 px-5 py-2"><button onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={12} /> Delete</button></div>
      )}
    </div>
  )
}

function NewWorkflowForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [platforms, setPlatforms] = useState<Set<Platform>>(new Set())
  const mutation = useMutation({ mutationFn: () => createWorkflowDefinition(name, description, [...platforms]), onSuccess: (wf) => onCreated(wf.id) })
  const toggle = (p: Platform) => setPlatforms((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n })
  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-900">New Workflow</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button></div>
      <div className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Workflow name" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none" />
        <div><label className="mb-1.5 block text-xs font-medium text-gray-500">Platforms</label><div className="flex flex-wrap gap-2">{ALL_PLATFORMS.map((p) => <button key={p} onClick={() => toggle(p)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${platforms.has(p) ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}><PlatformIcon platform={p} size={14} className="inline-block" /> {PLATFORM_ABBR[p]}</button>)}</div></div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button onClick={() => mutation.mutate()} disabled={!name.trim() || platforms.size === 0 || mutation.isPending} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{mutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />} Create</button>
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100">Cancel</button>
      </div>
    </div>
  )
}

// ─── Workflow Detail ─────────────────────────────────────────────────────────

type PlatformNodeConfig = {
  voice_id?: string
  agent_id?: string
  audience_ids?: string[]
  rule_set_id?: string
  research_activities?: string[]
}

function PlatformConfigCard({
  platform,
  config,
  defaults,
  onChange,
  voices,
  writingPersonas,
  audiencePersonas,
  ruleSets,
  allPersonas,
}: {
  platform: Platform
  config: PlatformNodeConfig
  defaults: PlatformNodeConfig
  onChange: (cfg: PlatformNodeConfig) => void
  voices: Array<Record<string, unknown>>
  writingPersonas: Array<Record<string, unknown>>
  audiencePersonas: Array<Record<string, unknown>>
  ruleSets: Array<Record<string, unknown>>
  allPersonas: Array<Record<string, unknown>>
}) {
  const [expanded, setExpanded] = useState(false)
  const voiceId = config.voice_id ?? ''
  const agentId = config.agent_id ?? ''
  const audienceIds = config.audience_ids ?? []
  const ruleSetId = config.rule_set_id ?? ''
  const activities = config.research_activities ?? []

  const effectiveVoice = voiceId || defaults.voice_id || ''
  const effectiveAgent = agentId || defaults.agent_id || ''
  const effectiveAudiences = audienceIds.length > 0 ? audienceIds : (defaults.audience_ids ?? [])
  const effectiveRuleSet = ruleSetId || defaults.rule_set_id || ''

  const selectedPersona = effectiveAgent ? allPersonas.find((p) => String(p.id) === effectiveAgent) : null
  const personaActivities = (selectedPersona?.enabled_tools as string[]) ?? []
  const effectiveActivities = activities.length > 0 ? activities : personaActivities

  const hasOverride = voiceId || agentId || audienceIds.length > 0 || ruleSetId || activities.length > 0
  const getName = (list: Array<Record<string, unknown>>, id: string) =>
    (list.find((item) => item.id === id)?.name as string) ?? ''

  const toggleAudience = (id: string) => {
    const prev = audienceIds
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    onChange({ ...config, audience_ids: next })
  }

  const selectClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none appearance-none cursor-pointer'

  const summaryParts: string[] = []
  if (effectiveVoice) summaryParts.push(getName(voices, effectiveVoice) || 'Voice')
  if (effectiveAgent) summaryParts.push(getName(writingPersonas, effectiveAgent) || 'Persona')
  if (effectiveAudiences.length) summaryParts.push(`${effectiveAudiences.length} audience${effectiveAudiences.length > 1 ? 's' : ''}`)
  if (effectiveRuleSet) summaryParts.push(getName(ruleSets, effectiveRuleSet) || 'Rules')

  return (
    <div className={`rounded-xl border ${expanded ? 'border-indigo-200 shadow-sm' : 'border-gray-200'} bg-white transition-all`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <PlatformIcon platform={platform} size={18} />
        <span className="text-sm font-semibold text-gray-800">{PLATFORM_LABELS[platform]}</span>
        {hasOverride && (
          <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-700">OVERRIDE</span>
        )}
        {!expanded && summaryParts.length > 0 && (
          <span className="ml-auto mr-2 text-[10px] text-gray-400 truncate max-w-[200px]">{summaryParts.join(' · ')}</span>
        )}
        {expanded ? <ChevronDown size={14} className="ml-auto text-gray-400" /> : <ChevronRight size={14} className="ml-auto text-gray-400" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          <p className="mb-3 text-[10px] text-gray-400">Leave blank to inherit from defaults. Set a value to override for this platform.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-medium text-gray-500">Brand Voice</label>
              <select
                value={voiceId}
                onChange={(e) => onChange({ ...config, voice_id: e.target.value || undefined })}
                className={selectClass}
              >
                <option value="">{defaults.voice_id ? `Inherit (${getName(voices, defaults.voice_id)})` : 'Inherit (none)'}</option>
                {voices.map((v) => <option key={String(v.id)} value={String(v.id)}>{String(v.name)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-gray-500">Writing Persona</label>
              <select
                value={agentId}
                onChange={(e) => {
                  const newId = e.target.value || undefined
                  const persona = newId ? allPersonas.find((p) => String(p.id) === newId) : null
                  const tools = (persona?.enabled_tools as string[]) ?? []
                  onChange({ ...config, agent_id: newId, research_activities: tools.length > 0 ? tools : undefined })
                }}
                className={selectClass}
              >
                <option value="">{defaults.agent_id ? `Inherit (${getName(writingPersonas, defaults.agent_id)})` : 'Inherit (none)'}</option>
                {writingPersonas.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-gray-500">Rule Set</label>
              <select
                value={ruleSetId}
                onChange={(e) => onChange({ ...config, rule_set_id: e.target.value || undefined })}
                className={selectClass}
              >
                <option value="">{defaults.rule_set_id ? `Inherit (${getName(ruleSets, defaults.rule_set_id)})` : 'Inherit (none)'}</option>
                {ruleSets.map((r) => <option key={String(r.id)} value={String(r.id)}>{String(r.name)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-gray-500">
                Audiences <span className="font-normal text-gray-400">(multi-select)</span>
              </label>
              <div className="max-h-28 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                {audiencePersonas.length === 0 && <p className="px-3 py-2 text-[10px] text-gray-400">No audience personas yet</p>}
                {audiencePersonas.map((p) => {
                  const id = String(p.id)
                  const selected = audienceIds.includes(id)
                  const inherited = !selected && (defaults.audience_ids ?? []).includes(id)
                  return (
                    <button key={id} onClick={() => toggleAudience(id)}
                      className={`flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] transition-colors ${
                        selected ? 'bg-green-50 text-green-800 font-medium' : inherited ? 'bg-gray-50 text-gray-500' : 'text-gray-600 hover:bg-gray-50'
                      }`}>
                      <span className={`flex h-3 w-3 shrink-0 items-center justify-center rounded border ${
                        selected ? 'border-green-500 bg-green-500 text-white' : inherited ? 'border-gray-300 bg-gray-200' : 'border-gray-300'
                      }`}>{(selected || inherited) && <Check size={7} />}</span>
                      {String(p.name)}{inherited && ' (inherited)'}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <ResearchActivitiesEditor
            selected={effectiveActivities}
            onChange={(acts) => onChange({ ...config, research_activities: acts })}
            personaActivities={personaActivities}
          />

          {hasOverride && (
            <button
              onClick={() => onChange({})}
              className="mt-3 flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-[10px] text-gray-500 hover:bg-gray-50"
            >
              <RotateCcw size={10} /> Reset to defaults
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function WorkflowDefaultsPanel({ definition, defId }: { definition: WorkflowDefinition; defId: string }) {
  const queryClient = useQueryClient()
  const { data: voices = [] } = useQuery({ queryKey: ['voices'], queryFn: listVoices })
  const { data: personas = [] } = useQuery({ queryKey: ['personas'], queryFn: listPersonas })
  const { data: ruleSets = [] } = useQuery({ queryKey: ['rule-sets'], queryFn: listRuleSets })

  const writingPersonas = personas.filter((p: Record<string, unknown>) => p.persona_type === 'writing' || p.persona_type === 'agent')
  const audiencePersonas = personas.filter((p: Record<string, unknown>) => p.persona_type === 'audience')

  const [voiceId, setVoiceId] = useState<string>(definition.default_voice_id || '')
  const [agentId, setAgentId] = useState<string>(definition.default_agent_id || '')
  const selectedDefaultPersona = agentId ? personas.find((p: Record<string, unknown>) => String(p.id) === agentId) : null
  const defaultPersonaActivities = (selectedDefaultPersona?.enabled_tools as string[]) ?? []
  const [audienceIds, setAudienceIds] = useState<string[]>(definition.default_audience_ids || [])
  const [ruleSetId, setRuleSetId] = useState<string>(definition.default_rule_set_id || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const initPpc = (definition.per_platform_config ?? {}) as Record<string, PlatformNodeConfig>
  const [platformConfigs, setPlatformConfigs] = useState<Record<string, PlatformNodeConfig>>(initPpc)

  const platforms = (definition.platforms ?? []) as Platform[]

  const defaultsCfg: PlatformNodeConfig = {
    voice_id: voiceId || undefined,
    agent_id: agentId || undefined,
    audience_ids: audienceIds,
    rule_set_id: ruleSetId || undefined,
  }

  const hasChanges = voiceId !== (definition.default_voice_id || '') ||
    agentId !== (definition.default_agent_id || '') ||
    JSON.stringify(audienceIds) !== JSON.stringify(definition.default_audience_ids || []) ||
    ruleSetId !== (definition.default_rule_set_id || '') ||
    JSON.stringify(platformConfigs) !== JSON.stringify(initPpc)

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateWorkflowDefinition(defId, {
        default_voice_id: voiceId || null,
        default_agent_id: agentId || null,
        default_audience_ids: audienceIds,
        default_rule_set_id: ruleSetId || null,
        per_platform_config: platformConfigs,
      })
      queryClient.invalidateQueries({ queryKey: ['workflow', defId] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  const seedMut = useMutation({
    mutationFn: seedRuleSets,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rule-sets'] }),
  })

  const toggleAudience = (id: string) => {
    setAudienceIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const updatePlatformConfig = (platform: Platform, cfg: PlatformNodeConfig) => {
    setPlatformConfigs((prev) => {
      const next = { ...prev }
      const isEmpty = !cfg.voice_id && !cfg.agent_id
        && (!cfg.audience_ids || cfg.audience_ids.length === 0)
        && !cfg.rule_set_id
        && (!cfg.research_activities || cfg.research_activities.length === 0)
      if (isEmpty) delete next[platform]
      else next[platform] = cfg
      return next
    })
  }

  const selectClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none appearance-none cursor-pointer'

  return (
    <div className="space-y-4">
      {/* Global Defaults */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-gray-400 uppercase"><Settings size={12} /> Global Defaults</h3>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-green-600">Saved</span>}
            <button onClick={handleSave} disabled={!hasChanges || saving}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
              {saving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />} Save All
            </button>
          </div>
        </div>
        <p className="mb-4 text-[11px] text-gray-400">These defaults apply to all platforms unless overridden below.</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-500">Brand Voice</label>
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={selectClass}>
              <option value="">None (default)</option>
              {voices.map((v: Record<string, unknown>) => <option key={String(v.id)} value={String(v.id)}>{String(v.name)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-500">Writing Persona</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={selectClass}>
              <option value="">None (default)</option>
              {writingPersonas.map((p: Record<string, unknown>) => <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-500">Rule Set</label>
            <div className="flex gap-1.5">
              <select value={ruleSetId} onChange={(e) => setRuleSetId(e.target.value)} className={selectClass + ' flex-1'}>
                <option value="">None (default)</option>
                {ruleSets.map((r: Record<string, unknown>) => <option key={String(r.id)} value={String(r.id)}>{String(r.name)}</option>)}
              </select>
              {ruleSets.length === 0 && (
                <button onClick={() => seedMut.mutate()} disabled={seedMut.isPending}
                  className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[10px] font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50">
                  {seedMut.isPending ? <RefreshCw size={10} className="animate-spin" /> : <Database size={10} className="inline mr-0.5" />}
                  Seed Demo Rules
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-500">Audience Personas <span className="font-normal text-gray-400">(multi-select)</span></label>
            <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-white">
              {audiencePersonas.length === 0 && <p className="px-3 py-2 text-[10px] text-gray-400">No audience personas created yet</p>}
              {audiencePersonas.map((p: Record<string, unknown>) => {
                const id = String(p.id)
                const selected = audienceIds.includes(id)
                return (
                  <button key={id} onClick={() => toggleAudience(id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${selected ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                    <span className={`h-3 w-3 shrink-0 rounded border ${selected ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300'}`}>
                      {selected && <Check size={9} className="text-white mx-auto" />}
                    </span>
                    {String(p.name)}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <ResearchActivitiesPreview activities={defaultPersonaActivities} />
      </div>

      {/* Per-Platform Configuration */}
      {platforms.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-bold tracking-wider text-gray-400 uppercase">
            <GitBranch size={12} /> Per-Platform Configuration
          </h3>
          <p className="mb-3 text-[11px] text-gray-400">Override defaults for specific platforms. Expand a platform to customize its configuration.</p>
          <div className="space-y-2">
            {platforms.map((p) => (
              <PlatformConfigCard
                key={p}
                platform={p}
                config={platformConfigs[p] ?? {}}
                defaults={defaultsCfg}
                onChange={(cfg) => updatePlatformConfig(p, cfg)}
                voices={voices}
                writingPersonas={writingPersonas}
                audiencePersonas={audiencePersonas}
                ruleSets={ruleSets}
                allPersonas={personas}
              />
            ))}
          </div>
        </div>
      )}

      {hasChanges && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          Unsaved changes — click <strong>Save All</strong> above to persist.
        </div>
      )}
    </div>
  )
}

function WorkflowDetailView() {
  const { defId } = useParams<{ defId: string }>()
  const navigate = useNavigate()
  const { data: definition, isLoading: defLoading } = useQuery({ queryKey: ['workflow', defId], queryFn: () => getWorkflow(defId!), enabled: !!defId })
  const { data: runs = [], isLoading: runsLoading } = useQuery({ queryKey: ['workflow-runs', defId], queryFn: () => listWorkflowRuns(defId!), enabled: !!defId })
  const handleNewRun = () => navigate(`runs/new`)

  if (defLoading || !definition) return <div className="flex items-center justify-center py-20"><RefreshCw size={24} className="animate-spin text-gray-400" /></div>
  const platforms = definition.platforms ?? []

  const statusForStage = (stage: string): string => {
    if (runs.length === 0) return 'pending'
    const latest = runs[runs.length - 1]
    const allNodes = latest.nodes ?? []
    if (stage === 'source') {
      const src = allNodes.find((n) => n.node_type === 'source')
      return src?.status ?? 'done'
    }
    if (stage === 'review') {
      const rev = allNodes.find((n) => n.node_type === 'review')
      return rev?.status ?? 'pending'
    }
    const platformNodes = allNodes.filter((n) => n.node_type === 'platform')
    if (platformNodes.length === 0) return 'pending'
    if (platformNodes.every((n) => n.status === 'done')) return 'done'
    if (platformNodes.some((n) => n.status === 'running')) return 'running'
    if (platformNodes.some((n) => n.status === 'failed')) return 'failed'
    return 'pending'
  }

  return (
    <div>
      <div className="mb-6">
        <button onClick={() => navigate('/workflows')} className="mb-3 flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600"><ArrowLeft size={14} /> Back</button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{definition.name}</h1>
            {definition.description && <p className="mt-1 text-sm text-gray-500">{definition.description}</p>}
          </div>
          <button onClick={handleNewRun} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"><Plus size={16} /> New Run</button>
        </div>
      </div>

      {/* Runs list */}
      <div className="mb-8">
        <h3 className="mb-3 text-xs font-bold tracking-wider text-gray-400 uppercase">Runs {!runsLoading && <span className="font-normal">({runs.length})</span>}</h3>
        {runsLoading && <div className="flex justify-center py-8"><RefreshCw size={20} className="animate-spin text-gray-400" /></div>}
        {!runsLoading && runs.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center"><Play size={32} className="mx-auto mb-2 text-gray-300" /><p className="text-sm text-gray-500">No runs yet. Click &ldquo;New Run&rdquo; to start.</p></div>}
        <div className="space-y-2">{runs.map((run) => {
          const allNodes = run.nodes ?? []
          const platformNodes = allNodes.filter((n) => n.node_type === 'platform')
          const doneCount = platformNodes.filter((n) => n.status === 'done').length
          return (
            <button key={run.id} onClick={() => navigate(`runs/${run.id}`)} className="flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 text-left hover:border-indigo-200 hover:shadow-sm transition-all group">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-700 group-hover:text-indigo-700">{run.source_content?.slice(0, 120) || 'New run'}{(run.source_content?.length ?? 0) > 120 && '...'}</p>
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-gray-400">
                  <span>{run.created_at ? new Date(run.created_at).toLocaleString() : ''}</span>
                  <span>{doneCount}/{platformNodes.length} platforms done</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {platformNodes.map((n) => (
                  <span key={n.id} className="flex items-center gap-1 text-[10px]">
                    <PlatformIcon platform={n.platform!} size={10} />
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDotColor(n.status)}`} />
                  </span>
                ))}
              </div>
              <StatusBadge status={run.status} />
              <ChevronRight size={16} className="shrink-0 text-gray-300 group-hover:text-indigo-400" />
            </button>
          )
        })}</div>
      </div>

      {/* Top-level Pipeline DAG */}
      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-xs font-bold tracking-wider text-gray-400 uppercase">Pipeline Architecture</h3>
        <div className="flex items-start gap-1 overflow-x-auto pb-2">
          {/* Source node */}
          <div className="flex flex-col items-center shrink-0">
            <div className={`rounded-xl border-2 px-5 py-3 text-center ${NODE_META.source.color}`}>
              <FileText size={16} className="mx-auto mb-1 text-slate-500" />
              <span className="block text-xs font-semibold text-gray-800">Source Input</span>
              <span className="block text-[10px] text-gray-400">Text + Images</span>
              <span className={`mt-1.5 inline-block h-2 w-2 rounded-full ${statusDotColor(statusForStage('source'))}`} />
            </div>
          </div>

          <div className="flex shrink-0 items-center self-center px-2">
            <div className="h-px w-6 bg-gray-300" />
            <div className="h-0 w-0 border-t-[4px] border-b-[4px] border-l-[6px] border-transparent border-l-gray-300" />
          </div>

          {/* Platform lanes */}
          <div className="flex flex-col gap-2 shrink-0">
            {platforms.map((p) => (
              <div key={p} className="flex items-center gap-1">
                <div className={`rounded-xl border-2 px-4 py-2 text-center ${NODE_META.adapt.color}`}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <PlatformIcon platform={p} size={12} />
                    <span className="text-xs font-semibold text-gray-800">{PLATFORM_LABELS[p] || p}</span>
                  </div>
                  <span className="block text-[10px] text-gray-400">Adapt + Validate</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex shrink-0 items-center self-center px-2">
            <div className="h-px w-6 bg-gray-300" />
            <div className="h-0 w-0 border-t-[4px] border-b-[4px] border-l-[6px] border-transparent border-l-gray-300" />
          </div>

          {/* Edit node */}
          <div className="flex flex-col items-center shrink-0">
            <div className={`rounded-xl border-2 px-5 py-3 text-center ${NODE_META.edit.color}`}>
              <Pencil size={16} className="mx-auto mb-1 text-amber-500" />
              <span className="block text-xs font-semibold text-gray-800">Edit</span>
              <span className="block text-[10px] text-gray-400">Refine & Adjust</span>
              <span className={`mt-1.5 inline-block h-2 w-2 rounded-full ${statusDotColor(statusForStage('review'))}`} />
            </div>
          </div>

          <div className="flex shrink-0 items-center self-center px-2">
            <div className="h-px w-6 bg-gray-300" />
            <div className="h-0 w-0 border-t-[4px] border-b-[4px] border-l-[6px] border-transparent border-l-gray-300" />
          </div>

          {/* Review node */}
          <div className="flex flex-col items-center shrink-0">
            <div className={`rounded-xl border-2 px-5 py-3 text-center ${NODE_META.review.color}`}>
              <Eye size={16} className="mx-auto mb-1 text-emerald-500" />
              <span className="block text-xs font-semibold text-gray-800">Review</span>
              <span className="block text-[10px] text-gray-400">Accept / Reject</span>
              <span className={`mt-1.5 inline-block h-2 w-2 rounded-full ${statusDotColor(statusForStage('review'))}`} />
            </div>
          </div>

          <div className="flex shrink-0 items-center self-center px-2">
            <div className="h-px w-6 bg-gray-300" />
            <div className="h-0 w-0 border-t-[4px] border-b-[4px] border-l-[6px] border-transparent border-l-gray-300" />
          </div>

          {/* Publish node */}
          <div className="flex flex-col items-center shrink-0">
            <div className={`rounded-xl border-2 px-5 py-3 text-center ${NODE_META.publish.color}`}>
              <Send size={16} className="mx-auto mb-1 text-cyan-500" />
              <span className="block text-xs font-semibold text-gray-800">Publish</span>
              <span className="block text-[10px] text-gray-400">Deploy</span>
            </div>
          </div>
        </div>
      </div>

      {/* Defaults Configuration */}
      <div className="mb-8">
        <WorkflowDefaultsPanel definition={definition} defId={defId!} />
      </div>
    </div>
  )
}

// ─── DAG Run Editor ─────────────────────────────────────────────────────────
// Visual DAG with double-click to open node detail panels

type OpenPanel = { kind: NodeKind; platform?: Platform } | null

function RunEditorView() {
  const { defId, runId } = useParams<{ defId: string; runId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null)
  const [showAudit, setShowAudit] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)

  const isNew = runId === 'new'
  const { data: run, isLoading } = useQuery({
    queryKey: ['workflow-run', runId],
    queryFn: () => getWorkflowRun(runId!),
    enabled: !!runId && !isNew,
    refetchInterval: 3000,
  })
  const { data: definition } = useQuery({ queryKey: ['workflow', defId], queryFn: () => getWorkflow(defId!), enabled: !!defId })
  const { data: auditEntries = [] } = useQuery({
    queryKey: ['audit', runId],
    queryFn: () => getRunAudit(runId!),
    enabled: !!runId && !isNew,
    refetchInterval: 3000,
  })
  const updateNodeMut = useMutation({
    mutationFn: ({ node, comp, ctx }: { node: WorkflowNode; comp?: Record<string, unknown>; ctx?: string }) => updateWorkflowNode(runId!, node, comp, ctx),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-run', runId] }),
  })

  if (isNew) {
    return <NewRunView defId={defId!} />
  }

  if (isLoading || !run) return <div className="flex items-center justify-center py-20"><RefreshCw size={24} className="animate-spin text-gray-400" /></div>

  const platforms = (definition?.platforms ?? []) as Platform[]
  const allNodes = run.nodes ?? []
  const platformNodes = allNodes.filter((n) => n.node_type === 'platform')
  const getNode = (p: Platform) => platformNodes.find((n) => n.platform === p) ?? null

  const typedAudit = auditEntries as unknown as AuditEntry[]
  const getNodeProgress = (platform: Platform): { step: string; agent: string; detail: string; count: number; total: number } | null => {
    const nodeEntries = typedAudit.filter((e) => e.platform === platform)
    if (nodeEntries.length === 0) return null
    const latest = nodeEntries[nodeEntries.length - 1]
    const researchCount = nodeEntries.filter((e) => e.step === 'research').length
    const hasValidate = nodeEntries.some((e) => e.step === 'validate')
    const hasDraft = nodeEntries.some((e) => e.step === 'draft')
    const hasPlan = nodeEntries.some((e) => e.step === 'plan')
    const total = 4
    const completed = (hasPlan ? 1 : 0) + (researchCount > 0 ? 1 : 0) + (hasDraft ? 1 : 0) + (hasValidate ? 1 : 0)
    let step = 'Initializing'
    if (hasValidate) step = 'Validating'
    else if (hasDraft) step = 'Generating variants'
    else if (researchCount > 0) step = `Researching (${researchCount} agents)`
    else if (hasPlan) step = 'Planning research'
    return { step, agent: latest.agent_name, detail: latest.output_summary?.slice(0, 80) ?? '', count: completed, total }
  }

  const handleDoubleClick = (kind: NodeKind, platform?: Platform) => {
    setOpenPanel({ kind, platform })
  }

  const activeNode = openPanel?.platform ? getNode(openPanel.platform) : null

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* Top bar */}
      <div className="mb-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => navigate('/workflows')} className="text-gray-500 hover:text-indigo-600"><ArrowLeft size={14} className="inline mr-1" />Workflows</button>
          <span className="text-gray-300">/</span>
          <button onClick={() => navigate(`/workflows/${defId}`)} className="text-gray-500 hover:text-indigo-600">{definition?.name ?? 'Workflow'}</button>
          <span className="text-gray-300">/</span>
          <span className="font-medium text-gray-900">Run #{run.id.slice(0, 8)}</span>
          <StatusBadge status={run.status} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowChangelog(!showChangelog); if (!showChangelog) setShowAudit(false) }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${showChangelog ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:bg-gray-100'}`}>
            <History size={14} /> History
          </button>
          <button onClick={() => { setShowAudit(!showAudit); if (!showAudit) setShowChangelog(false) }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${showAudit ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'}`}>
            <ScrollText size={14} /> Audit Trail
          </button>
        </div>
      </div>

      {/* Main area: DAG + optional panel */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* DAG Canvas */}
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-6">
          <p className="mb-5 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Double-click any node to open its details</p>

          <div className="inline-flex flex-col gap-4 min-w-max">
            {/* Column headers */}
            <div className="flex items-center gap-0 pl-1 mb-1">
              <div className="w-[150px] shrink-0 text-center text-[10px] font-bold tracking-wider text-gray-400 uppercase">Source</div>
              <div className="w-[42px] shrink-0" />
              <div className="w-[150px] shrink-0 text-center text-[10px] font-bold tracking-wider text-gray-400 uppercase">Adapt + Validate</div>
              <div className="w-[42px] shrink-0" />
              <div className="w-[120px] shrink-0 text-center text-[10px] font-bold tracking-wider text-gray-400 uppercase">Edit</div>
              <div className="w-[42px] shrink-0" />
              <div className="w-[120px] shrink-0 text-center text-[10px] font-bold tracking-wider text-gray-400 uppercase">Review</div>
              <div className="w-[42px] shrink-0" />
              <div className="w-[120px] shrink-0 text-center text-[10px] font-bold tracking-wider text-gray-400 uppercase">Publish</div>
            </div>

            {/* Per-platform lanes */}
            {platforms.map((p, i) => {
              const node = getNode(p)
              const nodeStatus = node?.status ?? 'pending'
              const hasVariants = (node?.variants?.length ?? 0) > 0
              return (
                <div key={p} className="flex items-center">
                  {/* Source — spans all lanes */}
                  {i === 0 ? (
                    <div className="w-[150px] shrink-0 flex items-center justify-center" style={platforms.length > 1 ? { height: `${platforms.length * 80}px` } : undefined}>
                      <DAGNode kind="source" status={run.source_content ? 'done' : 'pending'}
                        label="Source Input" sub="Text + Images"
                        isOpen={openPanel?.kind === 'source' && !openPanel.platform}
                        onDoubleClick={() => handleDoubleClick('source')} />
                    </div>
                  ) : <div className="w-[150px] shrink-0" />}

                  <DAGArrow />
                  <div className="w-[150px] shrink-0">
                    {(() => {
                      const progress = nodeStatus === 'running' ? getNodeProgress(p) : null
                      const adaptSub = progress ? progress.step : `${node?.variants?.length ?? 0} variants`
                      return (
                        <DAGNode kind="adapt" status={hasVariants ? 'done' : nodeStatus} platform={p}
                          label={PLATFORM_LABELS[p]} sub={adaptSub}
                          progress={progress ? { count: progress.count, total: progress.total } : undefined}
                          isOpen={openPanel?.kind === 'adapt' && openPanel.platform === p}
                          onDoubleClick={() => handleDoubleClick('adapt', p)} />
                      )
                    })()}
                  </div>

                  <DAGArrow />
                  <div className="w-[120px] shrink-0">
                    <DAGNode kind="edit" status={hasVariants ? (node?.variants?.some((v) => v.status === 'edited') ? 'done' : 'pending') : 'pending'}
                      label="Edit" sub="Refine variants"
                      isOpen={openPanel?.kind === 'edit' && openPanel.platform === p}
                      onDoubleClick={() => handleDoubleClick('edit', p)} />
                  </div>

                  <DAGArrow />
                  <div className="w-[120px] shrink-0">
                    <DAGNode kind="review" status={node?.variants?.some((v) => v.status === 'accepted') ? 'done' : hasVariants ? 'pending' : 'pending'}
                      label="Review" sub="Accept / Reject"
                      isOpen={openPanel?.kind === 'review' && openPanel.platform === p}
                      onDoubleClick={() => handleDoubleClick('review', p)} />
                  </div>

                  <DAGArrow />
                  <div className="w-[120px] shrink-0">
                    <DAGNode kind="publish" status="pending"
                      label="Publish" sub={PLATFORM_LABELS[p]}
                      isOpen={openPanel?.kind === 'publish' && openPanel.platform === p}
                      onDoubleClick={() => handleDoubleClick('publish', p)} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* empty placeholder — modal renders as overlay below */}

        {/* Changelog Drawer */}
        {showChangelog && (
          <div className="w-80 shrink-0 overflow-y-auto rounded-xl border border-amber-200 bg-white">
            <ChangelogDrawer runId={runId!} />
          </div>
        )}
        {/* Audit Drawer */}
        {showAudit && (
          <div className="w-72 shrink-0 overflow-y-auto rounded-xl border border-gray-200 bg-white">
            <AuditDrawer runId={runId!} earliestStartedAt={
              platformNodes.reduce<string | undefined>((earliest, n) => {
                const ts = n.started_at
                if (!ts) return earliest
                if (!earliest) return ts
                return ts < earliest ? ts : earliest
              }, undefined)
            } />
          </div>
        )}
      </div>

      {/* ── Node Detail Modal ── */}
      {openPanel && (
        <NodeDetailModal
          openPanel={openPanel}
          onClose={() => setOpenPanel(null)}
          run={run}
          defId={defId!}
          runId={runId!}
          activeNode={activeNode}
          updateNodeMut={updateNodeMut}
          onFeedback={() => queryClient.invalidateQueries({ queryKey: ['workflow-run', runId] })}
          auditEntries={typedAudit}
        />
      )}
    </div>
  )
}

// ─── Node Detail Modal ──────────────────────────────────────────────────────

function NodeDetailModal({ openPanel, onClose, run, defId, runId, activeNode, updateNodeMut, onFeedback, auditEntries = [] }: {
  openPanel: NonNullable<OpenPanel>
  onClose: () => void
  run: WorkflowRun
  defId: string
  runId: string
  activeNode: WorkflowNode | null
  updateNodeMut: ReturnType<typeof useMutation<WorkflowRun, Error, { node: WorkflowNode; comp?: Record<string, unknown>; ctx?: string }>>
  onFeedback: () => void
  auditEntries?: AuditEntry[]
}) {
  const isSource = openPanel.kind === 'source'
  const isPublish = openPanel.kind === 'publish'
  const isAdapt = openPanel.kind === 'adapt' && !!openPanel.platform
  const isEdit = openPanel.kind === 'edit' && !!openPanel.platform
  const isReview = openPanel.kind === 'review' && !!openPanel.platform

  type AdaptTab = 'config' | 'variants'
  const [adaptTab, setAdaptTab] = useState<AdaptTab>('config')

  const platformLabel = openPanel.platform ? PLATFORM_LABELS[openPanel.platform] : ''
  const kindLabel = NODE_META[openPanel.kind].label
  const title = openPanel.platform ? `${platformLabel} — ${kindLabel}` : kindLabel
  const variantCount = activeNode?.variants?.length ?? 0
  const validationCount = (activeNode?.validation_results ?? []).length
  const platformNodes = (run.nodes ?? []).filter((n) => n.node_type === 'platform')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            {openPanel.platform && <PlatformIcon platform={openPanel.platform} size={20} />}
            <div>
              <h2 className="text-base font-semibold text-gray-900">{title}</h2>
              <p className="text-xs text-gray-400">{openPanel.platform ? `${platformLabel}` : ''}</p>
            </div>
            {activeNode && (
              <StatusBadge status={activeNode.status} />
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"><X size={18} /></button>
        </div>

        {/* Tabs — only for Adapt + Validate nodes */}
        {isAdapt && (
          <div className="flex border-b border-gray-100 px-6 shrink-0">
            <button onClick={() => setAdaptTab('config')}
              className={`relative px-4 py-3 text-sm font-medium transition-colors ${adaptTab === 'config' ? 'text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>
              <Settings size={14} className="inline mr-1.5 -mt-0.5" />
              Configuration
              {adaptTab === 'config' && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-indigo-600" />}
            </button>
            <button onClick={() => setAdaptTab('variants')}
              className={`relative px-4 py-3 text-sm font-medium transition-colors ${adaptTab === 'variants' ? 'text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>
              <Sparkles size={14} className="inline mr-1.5 -mt-0.5" />
              A/B Variants
              {variantCount > 0 && <span className="ml-1.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-700">{variantCount}</span>}
              {validationCount > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">{validationCount} checks</span>}
              {adaptTab === 'variants' && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-indigo-600" />}
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Source panel */}
          {isSource && <SourcePanel run={run} defId={defId} />}

          {/* Publish panel */}
          {isPublish && activeNode && openPanel.platform && <PublishPanel node={activeNode} platform={openPanel.platform} />}

          {/* Adapt: config tab */}
          {isAdapt && adaptTab === 'config' && activeNode && (
            <div className="p-6">
              <ModalConfigTab
                node={activeNode}
                onUpdate={(comp, ctx) => updateNodeMut.mutate({ node: activeNode, comp, ctx })}
                isUpdating={updateNodeMut.isPending}
              />
            </div>
          )}

          {/* Adapt: variants tab (read-only view with validation) */}
          {isAdapt && adaptTab === 'variants' && activeNode && (activeNode.variants?.length ?? 0) > 0 && (
            <div className="p-6">
              <VariantsReadOnlyPanel node={activeNode} />
            </div>
          )}

          {/* Adapt: running state */}
          {isAdapt && adaptTab === 'variants' && activeNode?.status === 'running' && (activeNode?.variants?.length ?? 0) === 0 && (
            <PipelineProgress platform={openPanel.platform!} auditEntries={auditEntries} runId={runId} nodeId={activeNode?.id} startedAt={activeNode?.started_at} />
          )}

          {/* Adapt: pending state (not yet started) */}
          {isAdapt && adaptTab === 'variants' && activeNode?.status === 'pending' && (activeNode?.variants?.length ?? 0) === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Clock size={20} className="text-gray-300" />
              <span className="text-sm font-medium text-gray-500">Waiting to start</span>
              <span className="text-xs text-gray-400">This platform pipeline will begin shortly</span>
            </div>
          )}

          {/* Edit workspace — redesigned split-panel editing */}
          {isEdit && activeNode && (activeNode.variants?.length ?? 0) > 0 && (
            <EditWorkspace node={activeNode} runId={runId} allVariants={activeNode.variants} allPlatformNodes={platformNodes} onFeedback={onFeedback} />
          )}
          {isEdit && (activeNode?.variants?.length ?? 0) === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Pencil size={32} className="mb-2 text-gray-300" />
              <p className="text-sm text-gray-400">Variants not yet generated.</p>
              <p className="text-xs text-gray-400 mt-1">Run the Adapt + Validate step first.</p>
            </div>
          )}

          {/* Review panel — accept/reject only */}
          {isReview && activeNode && (activeNode.variants?.length ?? 0) > 0 && (
            <div className="p-6">
              <ReviewPanel node={activeNode} runId={runId} onFeedback={onFeedback} />
            </div>
          )}
          {isReview && (activeNode?.variants?.length ?? 0) === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Eye size={32} className="mb-2 text-gray-300" />
              <p className="text-sm text-gray-400">No variants to review yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Pipeline Progress (live view during generation) ─────────────────────────

const PHASE_CONFIG: Record<string, { label: string; icon: typeof Lightbulb; color: string; bg: string }> = {
  plan:     { label: 'Planning',    icon: Lightbulb,  color: 'text-blue-600',   bg: 'bg-blue-50' },
  research: { label: 'Researching', icon: Search,     color: 'text-purple-600', bg: 'bg-purple-50' },
  draft:    { label: 'Generating',  icon: Sparkles,   color: 'text-amber-600',  bg: 'bg-amber-50' },
  validate: { label: 'Validating',  icon: ShieldCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
}

function classifyTrace(t: TraceEntry): string {
  const a = (t.agent || t.name || '').toLowerCase()
  const s = (t.step || '').toLowerCase()
  if (a.includes('planner') || s === 'planning') return 'plan'
  if (a.includes('research') || s === 'research') return 'research'
  if (a.includes('synthesizer') || a.includes('image') || s === 'draft' || s.includes('image')) return 'draft'
  if (a.includes('validator') || s === 'validate') return 'validate'
  return 'plan'
}

function PipelineProgress({ platform, runId, startedAt }: {
  platform: Platform
  auditEntries: AuditEntry[]
  runId: string
  nodeId?: string
  startedAt?: string | null
}) {
  const { data: traces = [], isLoading } = useQuery({
    queryKey: ['traces', runId, platform, startedAt],
    queryFn: () => getRunTraces(runId, platform, startedAt ?? undefined),
    refetchInterval: 2500,
  })

  const byPhase: Record<string, TraceEntry[]> = {}
  for (const t of traces) {
    const p = classifyTrace(t)
    ;(byPhase[p] ??= []).push(t)
  }

  const phaseOrder = ['plan', 'research', 'draft', 'validate'] as const
  const donePhases = new Set(
    phaseOrder.filter(p => byPhase[p]?.length && byPhase[p]!.every(
      t => t.status === 'success' || t.status === 'completed',
    )),
  )
  const activePhase = phaseOrder.find(p => byPhase[p]?.some(
    t => t.status !== 'success' && t.status !== 'completed' && !t.error,
  )) || phaseOrder.find(p => !donePhases.has(p) && !byPhase[p]?.length) || null

  const totalTokens = traces.reduce((s, t) => s + (t.total_tokens || 0), 0)
  const totalTime = traces.reduce((s, t) => s + (t.elapsed_ms || 0), 0)

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
        <RefreshCw size={20} className="animate-spin" />
        <span className="text-xs">Connecting to pipeline…</span>
      </div>
    )
  }

  if (!traces.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="flex items-center gap-2 text-gray-500">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm font-medium">Starting pipeline…</span>
        </div>
        <span className="text-xs text-gray-400">Waiting for agent activity</span>
      </div>
    )
  }

  return (
    <div className="p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100">
            <RefreshCw size={13} className="animate-spin text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Generating Content</h3>
            <p className="text-[10px] text-gray-400">{traces.length} agent calls  ·  {(totalTime / 1000).toFixed(1)}s  ·  {totalTokens.toLocaleString()} tokens</p>
          </div>
        </div>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 tabular-nums">
          {donePhases.size}/{phaseOrder.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-5 h-1 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-700 ease-out"
          style={{ width: `${Math.max(5, (donePhases.size / phaseOrder.length) * 100)}%` }}
        />
      </div>

      {/* Phases */}
      <div className="space-y-2">
        {phaseOrder.map(phaseKey => {
          const cfg = PHASE_CONFIG[phaseKey]
          const Icon = cfg.icon
          const phaseTraces = byPhase[phaseKey] || []
          const isDone = donePhases.has(phaseKey)
          const isActive = phaseKey === activePhase
          const isPending = !isDone && !isActive && !phaseTraces.length

          return (
            <div key={phaseKey} className={`rounded-xl border transition-all duration-300 ${
              isActive ? 'border-gray-200 bg-white shadow-sm' :
              isDone ? 'border-gray-100 bg-gray-50/50' :
              'border-gray-100 bg-gray-50/30'
            }`}>
              {/* Phase header */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  isActive ? cfg.bg : isDone ? 'bg-emerald-50' : 'bg-gray-100'
                }`}>
                  {isActive ? <RefreshCw size={13} className={`animate-spin ${cfg.color}`} /> :
                   isDone ? <CheckCircle2 size={13} className="text-emerald-500" /> :
                   <Icon size={13} className="text-gray-300" />}
                </div>
                <span className={`text-xs font-semibold ${
                  isActive ? 'text-gray-900' : isDone ? 'text-gray-600' : 'text-gray-300'
                }`}>
                  {cfg.label}
                </span>
                {phaseTraces.length > 0 && (
                  <span className="text-[10px] text-gray-400">
                    {phaseTraces.filter(t => t.status === 'success' || t.status === 'completed').length}/{phaseTraces.length}
                  </span>
                )}
                {isDone && phaseTraces.length > 0 && (
                  <span className="ml-auto text-[10px] tabular-nums text-gray-400">
                    {(phaseTraces.reduce((s, t) => s + (t.elapsed_ms || 0), 0) / 1000).toFixed(1)}s
                  </span>
                )}
                {isPending && <span className="ml-auto text-[10px] text-gray-300">Pending</span>}
              </div>

              {/* Trace entries (only for active or done phases) */}
              {(isActive || isDone) && phaseTraces.length > 0 && (
                <div className="border-t border-gray-100 px-4 py-2 space-y-1">
                  {phaseTraces.map(t => (
                    <div key={t.id} className="flex items-center gap-2 py-1">
                      {t.error ? (
                        <XCircle size={11} className="shrink-0 text-red-400" />
                      ) : t.status === 'success' || t.status === 'completed' ? (
                        <CheckCircle2 size={11} className="shrink-0 text-emerald-400" />
                      ) : (
                        <RefreshCw size={11} className="shrink-0 animate-spin text-amber-400" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[11px] text-gray-700">
                        {t.agent}
                      </span>
                      {t.total_tokens > 0 && (
                        <span className="shrink-0 text-[9px] tabular-nums text-gray-400">
                          {t.total_tokens.toLocaleString()} tok
                        </span>
                      )}
                      <span className="shrink-0 text-[10px] tabular-nums text-gray-400">
                        {t.elapsed_ms != null ? `${(t.elapsed_ms / 1000).toFixed(1)}s` : '…'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Modal Config Tab (composition selectors extracted) ─────────────────────

function ResearchActivitiesPreview({ activities }: { activities: string[] }) {
  if (activities.length === 0) return null
  return (
    <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <h4 className="mb-3 flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-indigo-600 uppercase">
        <Search size={12} /> Research Activities
      </h4>
      <p className="mb-3 text-[11px] text-indigo-500/80">
        These research agents will run in parallel during generation to gather context:
      </p>
      <div className="grid gap-2">
        {activities.map((a) => {
          const meta = ACTIVITY_ICONS[a] ?? { icon: Search, color: 'text-gray-500 bg-gray-50' }
          const Icon = meta.icon
          return (
            <div key={a} className="flex items-start gap-2.5 rounded-lg bg-white px-3 py-2 border border-indigo-100/80">
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${meta.color}`}>
                <Icon size={13} />
              </span>
              <div className="min-w-0">
                <span className="text-xs font-semibold text-gray-800">{ACTIVITY_LABELS[a] ?? a}</span>
                {ACTIVITY_DESCRIPTIONS[a] && (
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{ACTIVITY_DESCRIPTIONS[a]}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ResearchActivitiesEditor({
  selected,
  onChange,
  personaActivities,
}: {
  selected: string[]
  onChange: (activities: string[]) => void
  personaActivities: string[]
}) {
  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key])
  }

  return (
    <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-indigo-600 uppercase">
        <Search size={12} /> Research Activities
      </h4>
      <p className="mb-3 text-[10px] text-indigo-500/70">
        Toggle which research agents run during generation. Defaults from the Writing Persona are pre-selected.
      </p>
      <div className="grid gap-1.5">
        {ALL_ACTIVITY_KEYS.map((a) => {
          const active = selected.includes(a)
          const fromPersona = personaActivities.includes(a)
          const meta = ACTIVITY_ICONS[a] ?? { icon: Search, color: 'text-gray-500 bg-gray-50' }
          const Icon = meta.icon
          return (
            <button
              key={a}
              type="button"
              onClick={() => toggle(a)}
              className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-all border ${
                active
                  ? 'bg-white border-indigo-200 shadow-sm'
                  : 'bg-white/50 border-transparent hover:border-gray-200 hover:bg-white opacity-60'
              }`}
            >
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                active ? 'bg-indigo-500 text-white' : 'border border-gray-300'
              }`}>
                {active && <Check size={11} />}
              </span>
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${meta.color}`}>
                <Icon size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-semibold text-gray-800">
                  {ACTIVITY_LABELS[a] ?? a}
                  {fromPersona && !active && (
                    <span className="ml-1.5 text-[9px] font-normal text-gray-400">(from persona)</span>
                  )}
                </span>
                {ACTIVITY_DESCRIPTIONS[a] && (
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{ACTIVITY_DESCRIPTIONS[a]}</p>
                )}
              </div>
            </button>
          )
        })}
      </div>
      {selected.length === 0 && (
        <p className="mt-2 text-[10px] text-amber-600">No activities selected — the pipeline will use default internal knowledge only.</p>
      )}
    </div>
  )
}

function ModalConfigTab({ node, onUpdate, isUpdating }: {
  node: WorkflowNode
  onUpdate: (comp?: Record<string, unknown>, ctx?: string) => void
  isUpdating: boolean
}) {
  const comp = node.composition ?? {}
  const [voiceId, setVoiceId] = useState<string>((comp.voice_id as string) || '')
  const [agentId, setAgentId] = useState<string>((comp.agent_id as string) || '')
  const [audienceIds, setAudienceIds] = useState<string[]>(() => {
    if (Array.isArray(comp.audience_ids)) return comp.audience_ids as string[]
    if (comp.audience_id) return [comp.audience_id as string]
    return []
  })
  const [rulesId, setRulesId] = useState<string>((comp.rule_set_id as string) || (comp.rules_id as string) || '')
  const [dirty, setDirty] = useState(false)

  const { data: voices = [] } = useQuery({ queryKey: ['voices'], queryFn: listVoices })
  const { data: allPersonas = [] } = useQuery({ queryKey: ['personas'], queryFn: listPersonas })
  const { data: ruleSets = [] } = useQuery({ queryKey: ['rule-sets'], queryFn: listRuleSets })

  const writingPersonas = allPersonas.filter((p) => {
    const t = (p.persona_type as string) ?? ''
    return t === 'writing' || t === 'agent'
  })
  const audiencePersonas = allPersonas.filter((p) => (p.persona_type as string) === 'audience')

  const selectedPersona = agentId ? allPersonas.find((p) => String(p.id) === agentId) : null
  const personaActivities = (selectedPersona?.enabled_tools as string[]) ?? []

  const [researchActivities, setResearchActivities] = useState<string[]>(() => {
    const saved = comp.research_activities as string[] | undefined
    return saved ?? personaActivities
  })
  const prevAgentIdRef = { current: agentId }

  const handleAgentChange = (newId: string) => {
    setAgentId(newId)
    setDirty(true)
    const persona = newId ? allPersonas.find((p) => String(p.id) === newId) : null
    const tools = (persona?.enabled_tools as string[]) ?? []
    if (prevAgentIdRef.current !== newId) {
      setResearchActivities(tools)
      prevAgentIdRef.current = newId
    }
  }

  const getName = (list: Array<Record<string, unknown>>, id: string) =>
    (list.find((item) => item.id === id)?.name as string) ?? ''

  const getNames = (list: Array<Record<string, unknown>>, ids: string[]) =>
    ids.map((id) => getName(list, id)).filter(Boolean)

  const toggleAudience = (id: string) => {
    setAudienceIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
    setDirty(true)
  }

  const handleApply = () => {
    const newComp: Record<string, unknown> = {
      ...comp,
      voice_id: voiceId || undefined,
      voice_name: getName(voices, voiceId) || undefined,
      agent_id: agentId || undefined,
      agent_name: getName(writingPersonas, agentId) || undefined,
      audience_ids: audienceIds.length > 0 ? audienceIds : undefined,
      audience_names: audienceIds.length > 0 ? getNames(audiencePersonas, audienceIds) : undefined,
      audience_id: audienceIds[0] || undefined,
      audience_name: audienceIds.length > 0 ? getNames(audiencePersonas, audienceIds).join(', ') : undefined,
      rule_set_id: rulesId || undefined,
      rules_id: rulesId || undefined,
      rules_name: getName(ruleSets, rulesId) || undefined,
      research_activities: researchActivities,
    }
    onUpdate(newComp)
    setDirty(false)
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Composition</h3>
        <div className="flex items-center gap-2">
          {dirty && (
            <button onClick={handleApply} disabled={isUpdating}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
              {isUpdating ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} Apply & Regenerate
            </button>
          )}
          {!dirty && (
            <button onClick={() => onUpdate()} disabled={isUpdating}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {isUpdating ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />} Regenerate
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-gray-500 uppercase">Brand Voice</label>
          <select value={voiceId} onChange={(e) => { setVoiceId(e.target.value); setDirty(true) }}
            className={`w-full rounded-lg border border-gray-200 border-l-4 ${COMPOSITION_COLORS.voice.border} bg-white px-3 py-2.5 text-xs text-gray-800 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none cursor-pointer`}>
            <option value="">None (default)</option>
            {voices.map((v) => <option key={String(v.id)} value={String(v.id)}>{String(v.name)}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-gray-500 uppercase">Writing Persona</label>
          <select value={agentId} onChange={(e) => handleAgentChange(e.target.value)}
            className={`w-full rounded-lg border border-gray-200 border-l-4 ${COMPOSITION_COLORS.agent.border} bg-white px-3 py-2.5 text-xs text-gray-800 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none cursor-pointer`}>
            <option value="">None (default)</option>
            {writingPersonas.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-gray-500 uppercase">Rule Set</label>
          <select value={rulesId} onChange={(e) => { setRulesId(e.target.value); setDirty(true) }}
            className={`w-full rounded-lg border border-gray-200 border-l-4 ${COMPOSITION_COLORS.rules.border} bg-white px-3 py-2.5 text-xs text-gray-800 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none cursor-pointer`}>
            <option value="">None (default)</option>
            {ruleSets.map((r) => <option key={String(r.id)} value={String(r.id)}>{String(r.name)}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Audiences <span className="font-normal text-gray-300">(multi-select)</span>
          </label>
          <div className={`rounded-lg border border-gray-200 border-l-4 ${COMPOSITION_COLORS.audience.border} bg-white max-h-36 overflow-y-auto`}>
            {audiencePersonas.length === 0 && <p className="px-3 py-2 text-[10px] text-gray-400">No audience personas yet</p>}
            {audienceIds.length > 0 && (
              <div className="flex flex-wrap gap-1 px-3 pt-2">
                {audienceIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">
                    {getName(audiencePersonas, id) || id.slice(0, 8)}
                    <button onClick={() => toggleAudience(id)} className="ml-0.5 rounded-full p-0.5 hover:bg-green-200"><X size={7} /></button>
                  </span>
                ))}
              </div>
            )}
            {audiencePersonas.map((p) => {
              const id = String(p.id)
              const selected = audienceIds.includes(id)
              return (
                <button key={id} onClick={() => toggleAudience(id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                    selected ? 'bg-green-50 text-green-800 font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                    selected ? 'border-green-500 bg-green-500 text-white' : 'border-gray-300'
                  }`}>{selected && <Check size={8} />}</span>
                  {String(p.name)}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <ResearchActivitiesEditor
        selected={researchActivities}
        onChange={(acts) => { setResearchActivities(acts); setDirty(true) }}
        personaActivities={personaActivities}
      />
    </div>
  )
}

// ─── New Run View ──────────────────────────────────────────────────────────

function NewRunView({ defId }: { defId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sourceText, setSourceText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const { data: definition } = useQuery({ queryKey: ['workflow', defId], queryFn: () => getWorkflow(defId), enabled: !!defId })

  const createRunMut = useMutation({
    mutationFn: () => createWorkflowRun(defId, sourceText, images),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs', defId] })
      navigate(`/workflows/${defId}/runs/${run.id}`, { replace: true })
    },
  })

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        try { const url = await uploadImage(file); setImages((prev) => [...prev, url]) }
        catch { setImages((prev) => [...prev, URL.createObjectURL(file)]) }
      }
    } finally { setUploading(false) }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      <div className="mb-4 flex items-center gap-2 text-sm shrink-0">
        <button onClick={() => navigate('/workflows')} className="text-gray-500 hover:text-indigo-600"><ArrowLeft size={14} className="inline mr-1" />Workflows</button>
        <span className="text-gray-300">/</span>
        <button onClick={() => navigate(`/workflows/${defId}`)} className="text-gray-500 hover:text-indigo-600">{definition?.name ?? 'Workflow'}</button>
        <span className="text-gray-300">/</span>
        <span className="font-medium text-gray-900">New Run</span>
      </div>

      <div className="mx-auto w-full max-w-xl flex-1">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-gray-900">Create New Run</h2>
          <p className="mb-5 text-sm text-gray-500">Enter your source content and the pipeline will generate platform-adapted variants.</p>

          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-gray-700"><FileText size={14} className="inline mr-1.5 text-gray-400" /> Source Content</label>
            <textarea value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder="Paste your blog post, article, or content here..."
              rows={10}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm leading-relaxed text-gray-800 placeholder:text-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none resize-none" />
            <span className="text-[11px] text-gray-400">{sourceText.length} characters</span>
          </div>

          <div className="mb-5">
            <label className="mb-1.5 block text-sm font-medium text-gray-700"><ImageIcon size={14} className="inline mr-1.5 text-gray-400" /> Images <span className="text-xs font-normal text-gray-400">(optional)</span></label>
            <div onDragOver={(e) => { e.preventDefault(); setDragActive(true) }} onDragLeave={() => setDragActive(false)} onDrop={handleDrop}
              className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${dragActive ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}>
              <Upload size={20} className="mx-auto mb-1 text-gray-400" />
              <label className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-700">Browse files
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
              </label>
              {uploading && <p className="mt-1 text-xs text-indigo-500"><RefreshCw size={10} className="inline mr-1 animate-spin" />Uploading...</p>}
            </div>
            {images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">{images.map((url, i) => (
                <div key={i} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200">
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <button onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute top-0.5 right-0.5 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block"><X size={8} /></button>
                </div>
              ))}</div>
            )}
          </div>

          {definition && (
            <div className="mb-5">
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Target Platforms</label>
              <div className="flex flex-wrap gap-2">{(definition.platforms ?? []).map((p) => <PlatformChip key={p} platform={p} />)}</div>
            </div>
          )}

          <button onClick={() => createRunMut.mutate()} disabled={sourceText.length < 20 || createRunMut.isPending}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 shadow-sm">
            {createRunMut.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate Adaptations
          </button>
          {sourceText.length > 0 && sourceText.length < 20 && (
            <p className="mt-2 text-xs text-amber-600">Please enter at least 20 characters of source content.</p>
          )}
          {createRunMut.isError && (
            <p className="mt-2 text-xs text-red-600">Failed to create run. Please try again.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── DAG Node ────────────────────────────────────────────────────────────────

function DAGNode({ kind, status, platform, label, sub, progress, isOpen, onDoubleClick }: {
  kind: NodeKind; status: string; platform?: Platform; label: string; sub: string
  progress?: { count: number; total: number }
  isOpen: boolean; onDoubleClick: () => void
}) {
  const meta = NODE_META[kind]
  const Icon = meta.icon
  const isRunning = status === 'running' || status === 'in_progress'
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label} node`}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onDoubleClick() }}
      className={`cursor-pointer select-none rounded-xl border-2 px-4 py-3 transition-all hover:shadow-md ${meta.color} ${
        isOpen ? `ring-2 ${meta.activeBorder} ring-offset-1 shadow-md` : 'hover:ring-1 hover:ring-gray-300'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`h-2 w-2 rounded-full shrink-0 ${statusDotColor(status)}`} />
        {platform && <PlatformIcon platform={platform} size={14} />}
        <Icon size={13} className="text-gray-500" />
      </div>
      <span className="block text-xs font-semibold text-gray-800">{label}</span>
      <span className={`block text-[10px] mt-0.5 ${isRunning ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>{sub}</span>
      {progress && (
        <div className="mt-1.5">
          <div className="h-1 w-full rounded-full bg-gray-200 overflow-hidden">
            <div className="h-full rounded-full bg-amber-400 transition-all duration-500" style={{ width: `${Math.round((progress.count / progress.total) * 100)}%` }} />
          </div>
          <span className="block text-[8px] text-amber-500 mt-0.5">{progress.count}/{progress.total} steps</span>
        </div>
      )}
    </div>
  )
}

function DAGArrow() {
  return (
    <div className="flex shrink-0 items-center px-1.5">
      <div className="h-px w-5 bg-gray-300" />
      <div className="h-0 w-0 border-t-[4px] border-b-[4px] border-l-[6px] border-transparent border-l-gray-300" />
    </div>
  )
}

// ─── Source Panel ────────────────────────────────────────────────────────────

function SourcePanel({ run, defId }: { run: WorkflowRun; defId: string }) {
  const queryClient = useQueryClient()
  const [sourceText, setSourceText] = useState(run.source_content || '')
  const [images, setImages] = useState<string[]>(run.source_images ?? [])
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editReason, setEditReason] = useState('')

  const hasContent = run.source_content && run.source_content.length > 0
  const hasChanges = sourceText !== (run.source_content || '') || JSON.stringify(images) !== JSON.stringify(run.source_images ?? [])

  const generateMut = useMutation({
    mutationFn: () => createWorkflowRun(defId, sourceText, images),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-run'] }),
  })

  const updateSourceMut = useMutation({
    mutationFn: () => updateRunSource(run.id, sourceText, images, editReason || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-run'] })
      setEditing(false)
      setEditReason('')
    },
  })

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        try { const url = await uploadImage(file); setImages((prev) => [...prev, url]) }
        catch { setImages((prev) => [...prev, URL.createObjectURL(file)]) }
      }
    } finally { setUploading(false) }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const canEdit = !!hasContent && !editing
  const isEditing = !!hasContent && editing

  return (
    <div className="p-5">
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700"><FileText size={14} className="inline mr-1.5 text-gray-400" /> Text Content</label>
          {canEdit && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"><Pencil size={11} /> Edit Source</button>
          )}
          {isEditing && (
            <button onClick={() => { setEditing(false); setSourceText(run.source_content || ''); setImages(run.source_images ?? []); setEditReason('') }}
              className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"><RotateCcw size={11} /> Cancel</button>
          )}
        </div>
        <textarea value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder="Paste source content..." rows={8}
          disabled={!!hasContent && !editing}
          className={`w-full rounded-lg border px-3 py-2.5 text-sm leading-relaxed text-gray-800 placeholder:text-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none resize-none transition-colors ${
            isEditing ? 'border-indigo-300 bg-indigo-50/30' : 'border-gray-200 disabled:bg-gray-50 disabled:text-gray-600'
          }`} />
        <span className="text-[11px] text-gray-400">{sourceText.length} chars</span>
      </div>

      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium text-gray-700"><ImageIcon size={14} className="inline mr-1.5 text-gray-400" /> Images <span className="text-xs font-normal text-gray-400">(optional)</span></label>
        {(!hasContent || editing) && (
          <div onDragOver={(e) => { e.preventDefault(); setDragActive(true) }} onDragLeave={() => setDragActive(false)} onDrop={handleDrop}
            className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${dragActive ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}>
            <Upload size={20} className="mx-auto mb-1 text-gray-400" />
            <label className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-700">Browse files
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
            </label>
            {uploading && <p className="mt-1 text-xs text-indigo-500"><RefreshCw size={10} className="inline mr-1 animate-spin" />Uploading...</p>}
          </div>
        )}
        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">{images.map((url, i) => (
            <div key={i} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200">
              <img src={url} alt="" className="h-full w-full object-cover" />
              {(!hasContent || editing) && (
                <button onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute top-0.5 right-0.5 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block"><X size={8} /></button>
              )}
            </div>
          ))}</div>
        )}
      </div>

      {/* Edit reason + save */}
      {isEditing && hasChanges && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <label className="mb-1 block text-xs font-medium text-amber-700">Why are you changing this? <span className="font-normal text-amber-500">(optional, helps improve future generations)</span></label>
          <input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="e.g. Updated messaging to focus on Q3 launch..."
            className="w-full rounded border border-amber-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 placeholder:text-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none" />
          <button onClick={() => updateSourceMut.mutate()} disabled={sourceText.length < 1 || updateSourceMut.isPending}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {updateSourceMut.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />} Save & Regenerate All Platforms
          </button>
          {updateSourceMut.isError && <p className="mt-1 text-xs text-red-600">Failed to update. Please try again.</p>}
        </div>
      )}

      {!hasContent && (
        <button onClick={() => generateMut.mutate()} disabled={sourceText.length < 20 || generateMut.isPending}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 shadow-sm">
          {generateMut.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate Adaptations
        </button>
      )}
      {hasContent && !editing && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 size={14} /> Source submitted. Double-click platform nodes in the DAG to view results.
        </div>
      )}
    </div>
  )
}

function VariantCard({ variant, runId, nodeId, onFeedback, validationResults = [] }: {
  variant: Variant; runId: string; nodeId: string; onFeedback?: () => void
  validationResults?: ValidationResult[]
}) {
  const [expanded, setExpanded] = useState(true)
  const [showValidation, setShowValidation] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(variant.text)
  const [showSuggest, setShowSuggest] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [viewStart] = useState(Date.now())

  const score = variant.consistency_score ?? 70
  const scoreColor = score >= 75 ? 'text-green-600 bg-green-50' : score >= 60 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50'
  const labelColors: Record<string, string> = { A: 'bg-indigo-100 text-indigo-700', B: 'bg-amber-100 text-amber-700', C: 'bg-green-100 text-green-700' }

  const doFeedback = async (action: string, finalText?: string, instruction?: string) => {
    setActionPending(action)
    try {
      await submitFeedback(runId, {
        node_id: nodeId,
        variant_id: variant.id,
        action,
        final_text: finalText,
        user_instruction: instruction,
        time_spent_ms: Date.now() - viewStart,
      })
      onFeedback?.()
    } catch { /* swallow */ }
    setActionPending(null)
  }

  const handleAccept = () => doFeedback('accept')
  const handleReject = () => doFeedback('reject')
  const handleSaveEdit = () => {
    doFeedback('edit', editText)
    setEditing(false)
  }

  const handleTextSelect = () => {
    const sel = window.getSelection()?.toString() ?? ''
    if (sel.length > 3) {
      setSelectedText(sel)
      setShowSuggest(true)
    }
  }

  const handleGetSuggestions = async () => {
    if (!selectedText) return
    setSuggestLoading(true)
    try {
      const result = await getEditSuggestions(runId, {
        node_id: nodeId,
        variant_id: variant.id,
        selected_text: selectedText,
      })
      setSuggestions(result.suggestions)
    } catch { setSuggestions([]) }
    setSuggestLoading(false)
  }

  const applySuggestion = (suggestion: string) => {
    setEditText(editText.replace(selectedText, suggestion))
    setShowSuggest(false)
    setSuggestions([])
    setEditing(true)
  }

  const isAccepted = variant.status === 'accepted'
  const isRejected = variant.status === 'rejected'

  return (
    <div className={`rounded-lg border-2 bg-white p-3 transition-colors ${isAccepted ? 'border-green-300 bg-green-50/30' : isRejected ? 'border-red-200 bg-red-50/30 opacity-60' : 'border-gray-200'}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${labelColors[variant.label] ?? 'bg-gray-100 text-gray-700'}`}>{variant.label}</span>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">{variant.hook_type ?? 'question'}</span>
        {isAccepted && <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-medium text-green-700">Accepted</span>}
        {variant.status === 'edited' && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">Edited</span>}
        <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${scoreColor}`}>{score}%</span>
      </div>

      {(variant.image_url || variant.video_url) && (
        <div className="mb-3 space-y-2">
          {variant.image_url && (
            <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
              <img src={variant.image_url} alt="Generated" className="h-48 w-full object-cover" />
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-gray-50 border-t border-gray-100">
                <span className="text-[10px] font-medium text-gray-500">AI-Generated Image</span>
                <a href={variant.image_url} target="_blank" rel="noopener noreferrer"
                   className="text-[10px] text-blue-500 hover:text-blue-700 hover:underline">View full</a>
              </div>
            </div>
          )}
          {variant.video_url && (
            <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
              <video src={variant.video_url} controls className="h-48 w-full object-cover" />
              <div className="px-2.5 py-1.5 bg-gray-50 border-t border-gray-100">
                <span className="text-[10px] font-medium text-gray-500">
                  AI Video{variant.video_duration ? ` (${variant.video_duration}s)` : ''}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {editing ? (
        <div>
          <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4}
            className="w-full resize-none rounded border border-indigo-300 px-2 py-1.5 text-xs text-gray-800 focus:ring-1 focus:ring-indigo-400 focus:outline-none" />
          <div className="mt-1.5 flex items-center gap-1.5">
            <button onClick={handleSaveEdit} disabled={actionPending === 'edit'}
              className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {actionPending === 'edit' ? <RefreshCw size={10} className="animate-spin" /> : <Check size={10} />} Save Edit
            </button>
            <button onClick={() => { setEditing(false); setEditText(variant.text) }}
              className="rounded px-2 py-1 text-[10px] text-gray-500 hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      ) : (
        <div onMouseUp={handleTextSelect}>
          <p className="text-xs leading-relaxed text-gray-700 whitespace-pre-wrap cursor-text">{variant.text}</p>
        </div>
      )}

      {showSuggest && selectedText && !editing && (
        <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-indigo-700">AI Suggestions for: "{selectedText.slice(0, 40)}{selectedText.length > 40 ? '...' : ''}"</span>
            <button onClick={() => { setShowSuggest(false); setSuggestions([]) }} className="text-gray-400 hover:text-gray-600"><X size={12} /></button>
          </div>
          {suggestions.length === 0 ? (
            <button onClick={handleGetSuggestions} disabled={suggestLoading}
              className="flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {suggestLoading ? <RefreshCw size={10} className="animate-spin" /> : <Sparkles size={10} />} Get 3 Alternatives
            </button>
          ) : (
            <div className="space-y-1">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => applySuggestion(s)}
                  className="block w-full rounded border border-indigo-100 bg-white px-2 py-1.5 text-left text-[10px] text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {(variant.rationale || variant.rationale_struct) && (
        <div className="mt-3">
          <button onClick={() => setExpanded(!expanded)}
            className="mb-1 flex items-center gap-2 text-left">
            <Lightbulb size={12} className="shrink-0 text-amber-500" />
            <span className="text-[11px] font-semibold text-gray-700">Rationale</span>
            {expanded ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
          </button>
          {expanded && <StructuredRationale variant={variant} />}
        </div>
      )}

      {validationResults.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white">
          <button onClick={() => setShowValidation(!showValidation)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-100/50 rounded-t-lg">
            <ShieldCheck size={12} className="shrink-0 text-indigo-500" />
            <span className="text-[11px] font-semibold text-gray-700">Validation</span>
            {(() => {
              const passCount = validationResults.filter((r) => r.status === 'pass').length
              const warnCount = validationResults.filter((r) => r.status === 'warn').length
              const failCount = validationResults.filter((r) => r.status === 'fail').length
              return (
                <span className="flex items-center gap-1.5 ml-1">
                  {failCount > 0 && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[8px] font-bold text-red-700">{failCount} fail</span>}
                  {warnCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-700">{warnCount} warn</span>}
                  {passCount > 0 && <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[8px] font-bold text-green-700">{passCount} pass</span>}
                </span>
              )
            })()}
            {showValidation ? <ChevronDown size={12} className="ml-auto text-gray-400" /> : <ChevronRight size={12} className="ml-auto text-gray-400" />}
          </button>
          {showValidation && (
            <div className="border-t border-slate-100 px-3 py-2 space-y-1.5">
              {(() => {
                const statusOrder: Record<string, number> = { fail: 0, warn: 1, pass: 2 }
                const sorted = [...validationResults].sort(
                  (a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3),
                )
                const typeColors: Record<string, string> = {
                  voice: 'bg-indigo-50 text-indigo-600',
                  persona: 'bg-amber-50 text-amber-600',
                  ruleset: 'bg-gray-100 text-gray-600',
                }
                return sorted.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-white px-2.5 py-1.5 border border-gray-100">
                    {r.status === 'pass' ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-green-500" />
                     : r.status === 'warn' ? <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
                     : <XCircle size={12} className="mt-0.5 shrink-0 text-red-500" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-gray-800">{r.rule_name}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-medium ${typeColors[r.rule_type] ?? 'bg-gray-50 text-gray-500'}`}>
                          {r.rule_type}
                        </span>
                      </div>
                      {r.message && <p className="text-[10px] text-gray-500 mt-0.5">{r.message}</p>}
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5">
        {!isAccepted && (
          <button onClick={handleAccept} disabled={!!actionPending}
            className="flex items-center gap-1 rounded bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">
            {actionPending === 'accept' ? <RefreshCw size={10} className="animate-spin" /> : <Check size={10} />} Accept
          </button>
        )}
        {isAccepted && (
          <span className="flex items-center gap-1 rounded bg-green-600 px-2 py-1 text-[10px] font-medium text-white"><Check size={10} /> Accepted</span>
        )}
        <button onClick={() => { setEditing(true); setEditText(variant.text) }}
          className="flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-100"><Pencil size={10} /> Edit</button>
        <button onClick={handleReject} disabled={!!actionPending}
          className="flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-100 disabled:opacity-50">
          <XCircle size={10} /> Reject
        </button>
      </div>
    </div>
  )
}

// ─── Structured Rationale ─────────────────────────────────────────────────────

const RATIONALE_SECTIONS: Array<{
  key: keyof RationaleStruct
  label: string
  icon: typeof Lightbulb
  color: string
}> = [
  { key: 'strategy', label: 'Strategy', icon: Lightbulb, color: 'text-amber-500 bg-amber-50' },
  { key: 'audience_fit', label: 'Audience Fit', icon: Eye, color: 'text-blue-500 bg-blue-50' },
  { key: 'voice_alignment', label: 'Voice Alignment', icon: BookOpen, color: 'text-indigo-500 bg-indigo-50' },
  { key: 'rules_alignment', label: 'Rules Alignment', icon: ShieldCheck, color: 'text-emerald-500 bg-emerald-50' },
]

function StructuredRationale({ variant, briefs }: {
  variant: Variant
  briefs?: Array<Record<string, unknown>>
}) {
  const rs = variant.rationale_struct
  const hasStruct = rs && (rs.strategy || rs.audience_fit || rs.voice_alignment || rs.rules_alignment)
  const evidenceIds = rs?.evidence_links ?? []
  const openQs = rs?.open_questions ?? []

  const matchedBriefs = briefs?.filter(b => {
    const act = String(b.activity ?? '')
    return evidenceIds.some(e => e.toLowerCase().includes(act.toLowerCase()))
  }) ?? []

  if (!hasStruct && !variant.rationale) return null

  if (!hasStruct) {
    return (
      <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1.5">
          <Lightbulb size={12} className="text-amber-500" />
          <span className="text-[11px] font-semibold text-gray-700">Rationale</span>
        </div>
        <p className="text-[11px] leading-relaxed text-gray-600">{variant.rationale}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <Lightbulb size={12} className="text-amber-500" />
        <span className="text-[11px] font-semibold text-gray-800">Rationale</span>
      </div>

      <div className="divide-y divide-slate-50">
        {RATIONALE_SECTIONS.map(({ key, label, icon: Icon, color }) => {
          const value = rs?.[key]
          if (!value) return null
          return (
            <div key={key} className="flex items-start gap-2.5 px-3 py-2">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${color}`}>
                <Icon size={10} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
                <p className="text-[11px] leading-relaxed text-gray-700">{value}</p>
              </div>
            </div>
          )
        })}

        {evidenceIds.length > 0 && (
          <div className="flex items-start gap-2.5 px-3 py-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-purple-500 bg-purple-50">
              <Database size={10} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-gray-400">Sources</span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {evidenceIds.map((eid, i) => (
                  <span key={i} className="rounded-full bg-purple-50 px-2 py-0.5 text-[9px] font-medium text-purple-700">
                    {eid.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
              {matchedBriefs.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[10px] font-medium text-purple-600 hover:text-purple-800">
                    View research details ({matchedBriefs.length})
                  </summary>
                  <div className="mt-1 space-y-1">
                    {matchedBriefs.map((b, i) => {
                      const summary = String(b.summary ?? b.rationale ?? '')
                      return (
                        <div key={i} className="rounded border border-purple-100 bg-purple-50/50 px-2 py-1.5">
                          <span className="block text-[9px] font-semibold text-purple-700">
                            {String(b.activity ?? 'Research').replace(/_/g, ' ')}
                          </span>
                          <p className="text-[10px] leading-relaxed text-gray-600">
                            {summary.slice(0, 300)}{summary.length > 300 ? '…' : ''}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </details>
              )}
            </div>
          </div>
        )}

        {openQs.length > 0 && (
          <div className="flex items-start gap-2.5 px-3 py-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 bg-gray-100">
              <AlertCircle size={10} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-gray-400">Open Questions</span>
              <ul className="mt-0.5 space-y-0.5">
                {openQs.map((q, i) => (
                  <li key={i} className="text-[10px] text-gray-600">• {q}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Research Context ────────────────────────────────────────────────────────

function ResearchContext({ composition }: { composition: Record<string, unknown> }) {
  const [expandedBrief, setExpandedBrief] = useState<string | null>(null)
  const briefs = (composition.research_briefs ?? []) as Array<Record<string, unknown>>
  const plan = (composition.research_plan ?? {}) as Record<string, Record<string, string>>
  const activities = (composition.research_activities ?? []) as string[]

  if (briefs.length === 0 && activities.length === 0) return null

  const formatBriefContent = (brief: Record<string, unknown>) => {
    const excluded = new Set(['activity', 'rationale', 'error'])
    return Object.entries(brief).filter(([k]) => !excluded.has(k))
  }

  return (
    <div className="mb-5 rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <Search size={14} className="text-indigo-500" />
        <h4 className="text-xs font-bold text-gray-800">Research Context</h4>
        <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-700">{briefs.length} agents</span>
      </div>

      <div className="divide-y divide-gray-50">
        {briefs.map((brief, idx) => {
          const activity = String(brief.activity ?? 'unknown')
          const isExpanded = expandedBrief === activity
          const meta = ACTIVITY_ICONS[activity] ?? { icon: Search, color: 'text-gray-500 bg-gray-50' }
          const Icon = meta.icon
          const label = ACTIVITY_LABELS[activity] ?? activity.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          const planEntry = plan[activity]
          const rationale = brief.rationale as string | undefined
          const hasError = !!brief.error
          const contentEntries = formatBriefContent(brief)

          return (
            <div key={idx}>
              <button onClick={() => setExpandedBrief(isExpanded ? null : activity)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gray-50">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.color}`}>
                  <Icon size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold text-gray-800">{label}</span>
                  {planEntry?.focus && (
                    <span className="block truncate text-[10px] text-gray-400">{planEntry.focus}</span>
                  )}
                </div>
                {hasError && <AlertTriangle size={12} className="shrink-0 text-red-400" />}
                {!hasError && rationale && <CheckCircle2 size={12} className="shrink-0 text-green-400" />}
                {isExpanded ? <ChevronDown size={14} className="shrink-0 text-gray-400" /> : <ChevronRight size={14} className="shrink-0 text-gray-400" />}
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3 space-y-2.5">
                  {planEntry?.query && (
                    <div>
                      <span className="mb-0.5 block text-[9px] font-bold tracking-wider text-gray-400 uppercase">Search Query</span>
                      <p className="rounded border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-600 italic">&ldquo;{planEntry.query}&rdquo;</p>
                    </div>
                  )}

                  {rationale && (
                    <div>
                      <span className="mb-0.5 block text-[9px] font-bold tracking-wider text-gray-400 uppercase">Agent Summary</span>
                      <p className="text-[11px] leading-relaxed text-gray-600">{String(rationale)}</p>
                    </div>
                  )}

                  {contentEntries.length > 0 && (
                    <div>
                      <span className="mb-1 block text-[9px] font-bold tracking-wider text-gray-400 uppercase">Findings</span>
                      <div className="space-y-1.5">
                        {contentEntries.map(([key, value]) => {
                          const displayKey = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
                          const displayValue = typeof value === 'string' ? value
                            : Array.isArray(value)
                              ? (value.length > 0 ? value.map((v) => typeof v === 'string' ? v : JSON.stringify(v)).join(', ') : '(none)')
                              : JSON.stringify(value, null, 2)
                          return (
                            <div key={key} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                              <span className="mb-0.5 block text-[10px] font-semibold text-gray-500">{displayKey}</span>
                              <p className="text-[11px] leading-relaxed text-gray-700 whitespace-pre-wrap">
                                {String(displayValue).slice(0, 500)}{String(displayValue).length > 500 ? '...' : ''}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {hasError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                      <span className="text-[10px] font-semibold text-red-600">Error: {String(brief.error)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Variant Tab Bar (shared between panels) ────────────────────────────────

const VARIANT_TAB_COLORS: Record<string, { tab: string; active: string }> = {
  A: { tab: 'text-indigo-600 hover:bg-indigo-50', active: 'bg-indigo-600 text-white shadow-sm' },
  B: { tab: 'text-amber-600 hover:bg-amber-50', active: 'bg-amber-600 text-white shadow-sm' },
  C: { tab: 'text-green-600 hover:bg-green-50', active: 'bg-green-600 text-white shadow-sm' },
}

function VariantTabBar({ variants, activeIdx, onSelect }: {
  variants: Variant[]; activeIdx: number; onSelect: (idx: number) => void
}) {
  return (
    <div className="mb-4 flex items-center gap-1.5 rounded-lg bg-gray-100 p-1">
      {variants.map((v, idx) => {
        const isActive = idx === activeIdx
        const colors = VARIANT_TAB_COLORS[v.label] ?? { tab: 'text-gray-600 hover:bg-gray-50', active: 'bg-gray-700 text-white shadow-sm' }
        const score = v.consistency_score ?? 70
        const isAccepted = v.status === 'accepted'
        const isRejected = v.status === 'rejected'
        return (
          <button key={v.id} onClick={() => onSelect(idx)}
            className={`relative flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-all ${isActive ? colors.active : colors.tab + ' bg-transparent'}`}>
            <span>Variant {v.label}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${isActive ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}>
              {score}%
            </span>
            {isAccepted && <CheckCircle2 size={12} className={isActive ? 'text-white' : 'text-green-500'} />}
            {isRejected && <XCircle size={12} className={isActive ? 'text-white/70' : 'text-red-400'} />}
            {v.status === 'edited' && <Pencil size={10} className={isActive ? 'text-white/70' : 'text-blue-400'} />}
          </button>
        )
      })}
    </div>
  )
}

// ─── Variants Read-Only Panel (Adapt + Validate node) ───────────────────────

function VariantsReadOnlyPanel({ node }: { node: WorkflowNode }) {
  const [activeIdx, setActiveIdx] = useState(0)
  const variants = node.variants
  const active = variants[activeIdx] ?? null

  const getVariantValidation = (label: string) =>
    (node.validation_results ?? []).filter(
      (r) => r.variant_label === label || r.variant_label === `Variant ${label}`
    )

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Generated Variants</h3>
        <p className="mt-0.5 text-xs text-gray-500">Adapted content with validation results</p>
      </div>

      <ResearchContext composition={node.composition ?? {}} />

      <VariantTabBar variants={variants} activeIdx={activeIdx} onSelect={setActiveIdx} />

      {active && (
        <div className="space-y-3">
          {/* Media */}
          {(active.image_url || active.video_url) && (
            <div className="space-y-2">
              {active.image_url && (
                <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                  <img src={active.image_url} alt="Generated" className="w-full max-h-72 object-cover" />
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-t border-gray-100">
                    <span className="text-[10px] font-medium text-gray-500">AI-Generated Image</span>
                    <a href={active.image_url} target="_blank" rel="noopener noreferrer"
                       className="text-[10px] text-blue-500 hover:text-blue-700 hover:underline">View full size</a>
                  </div>
                </div>
              )}
              {active.video_url && (
                <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                  <video src={active.video_url} controls className="w-full max-h-72 object-cover" />
                  <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
                    <span className="text-[10px] font-medium text-gray-500">
                      AI Video{active.video_duration ? ` (${active.video_duration}s)` : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Variant content */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{active.text}</p>
          </div>

          {/* Structured Rationale */}
          <StructuredRationale
            variant={active}
            briefs={(node.composition?.research_briefs ?? []) as Array<Record<string, unknown>>}
          />

          {/* Validation results */}
          {(() => {
            const results = getVariantValidation(active.label)
            if (results.length === 0) return null
            const statusOrder: Record<string, number> = { fail: 0, warn: 1, pass: 2 }
            const sorted = [...results].sort(
              (a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3),
            )
            const passCount = results.filter((r) => r.status === 'pass').length
            const warnCount = results.filter((r) => r.status === 'warn').length
            const failCount = results.filter((r) => r.status === 'fail').length
            const typeColors: Record<string, string> = {
              voice: 'bg-indigo-50 text-indigo-600',
              persona: 'bg-amber-50 text-amber-600',
              ruleset: 'bg-gray-100 text-gray-600',
            }
            return (
              <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white">
                <div className="flex items-center gap-2 px-3 py-2">
                  <ShieldCheck size={12} className="text-indigo-500" />
                  <span className="text-[11px] font-semibold text-gray-700">Validation</span>
                  {failCount > 0 && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[8px] font-bold text-red-700">{failCount} fail</span>}
                  {warnCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-700">{warnCount} warn</span>}
                  {passCount > 0 && <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[8px] font-bold text-green-700">{passCount} pass</span>}
                </div>
                <div className="border-t border-slate-100 px-3 py-2 space-y-1.5">
                  {sorted.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg bg-white px-2.5 py-1.5 border border-gray-100">
                      {r.status === 'pass' ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-green-500" />
                       : r.status === 'warn' ? <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
                       : <XCircle size={12} className="mt-0.5 shrink-0 text-red-500" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-gray-800">{r.rule_name}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-medium ${typeColors[r.rule_type] ?? 'bg-gray-50 text-gray-500'}`}>
                            {r.rule_type}
                          </span>
                        </div>
                        {r.message && <p className="text-[10px] text-gray-500 mt-0.5">{r.message}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ─── Cursor-style Diff View ─────────────────────────────────────────────────

function computeClientDiffOps(before: string, after: string): DiffOp[] {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const ops: DiffOp[] = []
  const max = Math.max(beforeLines.length, afterLines.length)
  let i = 0, j = 0
  while (i < beforeLines.length || j < afterLines.length) {
    if (i < beforeLines.length && j < afterLines.length && beforeLines[i] === afterLines[j]) {
      let eqStart = i
      while (i < beforeLines.length && j < afterLines.length && beforeLines[i] === afterLines[j]) { i++; j++ }
      ops.push({ op: 'equal', lines: beforeLines.slice(eqStart, i) })
    } else {
      const delLines: string[] = []
      const insLines: string[] = []
      const lookAhead = 3
      let found = false
      for (let scan = 0; scan < Math.min(lookAhead, max - Math.max(i, j)); scan++) {
        if (i + scan < beforeLines.length && j < afterLines.length && beforeLines[i + scan] === afterLines[j]) {
          for (let d = 0; d < scan; d++) delLines.push(beforeLines[i + d])
          i += scan
          found = true
          break
        }
        if (j + scan < afterLines.length && i < beforeLines.length && afterLines[j + scan] === beforeLines[i]) {
          for (let d = 0; d < scan; d++) insLines.push(afterLines[j + d])
          j += scan
          found = true
          break
        }
      }
      if (!found) {
        if (i < beforeLines.length) { delLines.push(beforeLines[i]); i++ }
        if (j < afterLines.length) { insLines.push(afterLines[j]); j++ }
      }
      if (delLines.length > 0) ops.push({ op: 'delete', lines: delLines })
      if (insLines.length > 0) ops.push({ op: 'insert', lines: insLines })
    }
  }
  return ops
}

function DiffView({ diffOps, compact = false }: { diffOps: DiffOp[]; compact?: boolean }) {
  if (!diffOps || diffOps.length === 0) return null

  let oldLineNum = 1
  let newLineNum = 1
  const rows: Array<{
    type: 'equal' | 'delete' | 'insert'
    oldNum: number | null
    newNum: number | null
    text: string
  }> = []

  for (const op of diffOps) {
    for (const line of op.lines) {
      if (op.op === 'equal') {
        rows.push({ type: 'equal', oldNum: oldLineNum++, newNum: newLineNum++, text: line })
      } else if (op.op === 'delete') {
        rows.push({ type: 'delete', oldNum: oldLineNum++, newNum: null, text: line })
      } else {
        rows.push({ type: 'insert', oldNum: null, newNum: newLineNum++, text: line })
      }
    }
  }

  return (
    <div className={`rounded-lg border border-gray-200 overflow-hidden ${compact ? 'max-h-48 overflow-y-auto' : ''}`}>
      <table className="w-full border-collapse font-mono text-[11px] leading-[18px]">
        <tbody>
          {rows.map((row, i) => {
            const bgClass = row.type === 'delete'
              ? 'bg-red-50/80'
              : row.type === 'insert'
                ? 'bg-green-50/80'
                : ''
            const textClass = row.type === 'delete'
              ? 'text-red-800'
              : row.type === 'insert'
                ? 'text-green-800'
                : 'text-gray-600'
            const gutterBg = row.type === 'delete'
              ? 'bg-red-100/60 text-red-400'
              : row.type === 'insert'
                ? 'bg-green-100/60 text-green-400'
                : 'bg-gray-50 text-gray-300'

            return (
              <tr key={i} className={bgClass}>
                <td className={`w-[1px] whitespace-nowrap px-2 py-0 text-right text-[9px] select-none border-r border-gray-100 ${gutterBg}`}>
                  {row.oldNum ?? ''}
                </td>
                <td className={`w-[1px] whitespace-nowrap px-2 py-0 text-right text-[9px] select-none border-r border-gray-200 ${gutterBg}`}>
                  {row.newNum ?? ''}
                </td>
                <td className={`w-5 text-center py-0 text-[9px] select-none ${row.type === 'delete' ? 'text-red-400' : row.type === 'insert' ? 'text-green-400' : 'text-transparent'}`}>
                  {row.type === 'delete' ? '−' : row.type === 'insert' ? '+' : ' '}
                </td>
                <td className={`px-3 py-0 whitespace-pre-wrap break-all ${textClass}`}>
                  {row.text || '\u00A0'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Edit History Timeline ──────────────────────────────────────────────────

function EditHistoryTimeline({ runId, nodeId, variantId }: {
  runId: string; nodeId: string; variantId: string
}) {
  const [entries, setEntries] = useState<EditRecordEntry[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getEditHistory(runId, nodeId, variantId)
      setEntries(data)
    } catch { /* swallow */ }
    setLoading(false)
  }, [runId, nodeId, variantId])

  useState(() => { loadHistory() })

  const typeIcon = (t: string) => {
    if (t === 'ai_chat') return <Sparkles size={10} className="text-indigo-500" />
    if (t === 'propagated') return <ArrowRight size={10} className="text-purple-500" />
    if (t === 'ai_suggest') return <Sparkles size={10} className="text-amber-500" />
    return <Pencil size={10} className="text-blue-500" />
  }

  const typeLabel = (t: string) => {
    if (t === 'ai_chat') return 'AI Chat'
    if (t === 'propagated') return 'Propagated'
    if (t === 'ai_suggest') return 'AI Suggest'
    return 'Inline Edit'
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-[10px] text-gray-400">
        <RefreshCw size={10} className="animate-spin" /> Loading history...
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="py-3 text-center text-[10px] text-gray-400">
        No edits yet
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {entries.map((e) => (
        <div key={e.id} className="rounded-lg border border-gray-100 bg-white">
          <button
            onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors rounded-lg"
          >
            {typeIcon(e.edit_type)}
            <span className="text-[10px] font-medium text-gray-700">{typeLabel(e.edit_type)}</span>
            {e.summary && (
              <span className="truncate text-[9px] text-gray-400 flex-1">{e.summary}</span>
            )}
            <span className="text-[9px] text-gray-400 shrink-0">
              {e.created_at ? new Date(e.created_at).toLocaleTimeString() : ''}
            </span>
            {expandedId === e.id
              ? <ChevronDown size={10} className="text-gray-400 shrink-0" />
              : <ChevronRight size={10} className="text-gray-400 shrink-0" />}
          </button>
          {expandedId === e.id && (
            <div className="px-3 pb-3">
              <DiffView diffOps={e.diff_ops} compact />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Change Summary Bar + Push Modal ────────────────────────────────────────

function ChangeSummaryBar({ runId, nodeId, variantId, variants, currentPlatform, allPlatformNodes = [], onFeedback }: {
  runId: string; nodeId: string; variantId: string; variants: Variant[]
  currentPlatform?: string; allPlatformNodes?: WorkflowNode[]
  onFeedback?: () => void
}) {
  const [showPushModal, setShowPushModal] = useState(false)
  const [summary, setSummary] = useState<{ summary: string; change_items: ChangeItem[] } | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [targetVariantIds, setTargetVariantIds] = useState<Set<string>>(new Set())
  const [targetNodeIds, setTargetNodeIds] = useState<Set<string>>(new Set())
  const [propagating, setPropagating] = useState(false)
  const [editCount, setEditCount] = useState(0)
  const [expandCrossPlatform, setExpandCrossPlatform] = useState(false)

  const loadEditCount = useCallback(async () => {
    try {
      const data = await getEditHistory(runId, nodeId, variantId)
      setEditCount(data.length)
    } catch { /* swallow */ }
  }, [runId, nodeId, variantId])

  useState(() => { loadEditCount() })

  const handleSummarize = async () => {
    setSummarizing(true)
    try {
      const result = await summarizeChanges(runId, { node_id: nodeId, variant_id: variantId })
      setSummary(result)
      setSelectedItems(new Set(result.change_items.map((c) => c.id)))
      setShowPushModal(true)
    } catch { /* swallow */ }
    setSummarizing(false)
  }

  const handlePropagate = async () => {
    if (targetVariantIds.size === 0 && targetNodeIds.size === 0) return
    setPropagating(true)
    try {
      const selectedDirectives = (summary?.change_items ?? [])
        .filter((ci) => selectedItems.has(ci.id))
        .map((ci) => ci.edit_directive)
        .filter(Boolean)
      await propagateChanges(runId, {
        node_id: nodeId,
        source_variant_id: variantId,
        target_variant_ids: Array.from(targetVariantIds),
        target_node_ids: Array.from(targetNodeIds),
        change_item_ids: Array.from(selectedItems),
        edit_directives: selectedDirectives,
      })
      onFeedback?.()
      setShowPushModal(false)
    } catch { /* swallow */ }
    setPropagating(false)
  }

  const otherVariants = variants.filter((v) => v.id !== variantId)
  const otherPlatformNodes = allPlatformNodes.filter((n) => n.id !== nodeId && n.node_type === 'platform')
  const crossPlatformItems = summary?.change_items.filter((ci) => ci.cross_platform_applicable) ?? []
  const hasTargets = targetVariantIds.size > 0 || targetNodeIds.size > 0
  const totalTargets = targetVariantIds.size + targetNodeIds.size

  if (editCount === 0) return null

  return (
    <>
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <Layers size={12} className="text-gray-500" />
        <span className="text-[11px] font-medium text-gray-600">
          {editCount} edit{editCount !== 1 ? 's' : ''} made
        </span>
        <div className="flex-1" />
        <button
          onClick={handleSummarize}
          disabled={summarizing}
          className="flex items-center gap-1 rounded-md bg-white border border-gray-200 px-2.5 py-1 text-[10px] font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
          {summarizing ? <RefreshCw size={10} className="animate-spin" /> : <ScrollText size={10} />}
          Summarize & Push
        </button>
      </div>

      {showPushModal && summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <h3 className="text-sm font-semibold text-gray-900">Change Summary & Push</h3>
              <button onClick={() => setShowPushModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* Top-level summary */}
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-4 py-3">
                <div className="flex items-start gap-2">
                  <ScrollText size={14} className="mt-0.5 text-indigo-500 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-indigo-900 mb-1">Session Summary</p>
                    <p className="text-[11px] leading-relaxed text-indigo-800">{summary.summary}</p>
                  </div>
                </div>
              </div>

              {/* Selectable change items */}
              {summary.change_items.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-700">Select changes to push</p>
                    <button
                      onClick={() => {
                        if (selectedItems.size === summary.change_items.length) {
                          setSelectedItems(new Set())
                        } else {
                          setSelectedItems(new Set(summary.change_items.map((c) => c.id)))
                        }
                      }}
                      className="text-[10px] text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      {selectedItems.size === summary.change_items.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {summary.change_items.map((ci) => (
                      <label key={ci.id} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${selectedItems.has(ci.id) ? 'border-indigo-200 bg-indigo-50/40' : 'border-gray-100 bg-gray-50 hover:bg-gray-100'}`}>
                        <input
                          type="checkbox"
                          checked={selectedItems.has(ci.id)}
                          onChange={(e) => {
                            const next = new Set(selectedItems)
                            if (e.target.checked) next.add(ci.id)
                            else next.delete(ci.id)
                            setSelectedItems(next)
                          }}
                          className="mt-0.5 rounded border-gray-300"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium text-gray-800 leading-relaxed">{ci.description}</p>
                          {ci.edit_directive && (
                            <p className="mt-0.5 text-[10px] text-gray-500 italic leading-relaxed">&ldquo;{ci.edit_directive}&rdquo;</p>
                          )}
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="inline-block rounded-full bg-gray-200 px-1.5 py-0.5 text-[8px] font-medium text-gray-600">
                              {ci.category}
                            </span>
                            {ci.cross_platform_applicable && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[8px] font-medium text-blue-700">
                                <Globe size={7} /> cross-platform
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Same-node variant targets */}
              {otherVariants.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-2">
                    Push to other variants
                    {currentPlatform ? ` (${PLATFORM_LABELS[currentPlatform as Platform] ?? currentPlatform})` : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {otherVariants.map((v) => (
                      <label key={v.id} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${targetVariantIds.has(v.id) ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                        <input
                          type="checkbox"
                          checked={targetVariantIds.has(v.id)}
                          onChange={(e) => {
                            const next = new Set(targetVariantIds)
                            if (e.target.checked) next.add(v.id)
                            else next.delete(v.id)
                            setTargetVariantIds(next)
                          }}
                          className="rounded border-gray-300"
                        />
                        <span className="text-[11px] font-semibold text-gray-700">Variant {v.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Cross-platform node targets */}
              {otherPlatformNodes.length > 0 && crossPlatformItems.length > 0 && (
                <div>
                  <button
                    onClick={() => setExpandCrossPlatform(!expandCrossPlatform)}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-700 mb-2 hover:text-indigo-600 transition-colors"
                  >
                    <Globe size={12} className="text-blue-500" />
                    Push to other platforms
                    <span className="text-[9px] text-gray-400 font-normal">
                      ({crossPlatformItems.length} applicable change{crossPlatformItems.length !== 1 ? 's' : ''})
                    </span>
                    {expandCrossPlatform ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {expandCrossPlatform && (
                    <div className="ml-0.5 space-y-1.5 rounded-lg border border-blue-100 bg-blue-50/30 p-3">
                      <p className="text-[10px] text-gray-500 mb-2">
                        The LLM will adapt the selected cross-platform changes to each platform's conventions.
                      </p>
                      {otherPlatformNodes.map((pn) => {
                        const pLabel = PLATFORM_LABELS[pn.platform as Platform] ?? pn.platform ?? 'Unknown'
                        return (
                          <label key={pn.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${targetNodeIds.has(pn.id) ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                            <input
                              type="checkbox"
                              checked={targetNodeIds.has(pn.id)}
                              onChange={(e) => {
                                const next = new Set(targetNodeIds)
                                if (e.target.checked) next.add(pn.id)
                                else next.delete(pn.id)
                                setTargetNodeIds(next)
                              }}
                              className="rounded border-gray-300"
                            />
                            <PlatformIcon platform={pn.platform as Platform} size={14} />
                            <span className="text-[11px] font-semibold text-gray-700">{pLabel}</span>
                            <span className="text-[9px] text-gray-400">
                              ({pn.variants?.length ?? 0} variant{(pn.variants?.length ?? 0) !== 1 ? 's' : ''})
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
              <span className="text-[10px] text-gray-400">
                {selectedItems.size} change{selectedItems.size !== 1 ? 's' : ''} selected
                {hasTargets && ` → ${totalTargets} target${totalTargets !== 1 ? 's' : ''}`}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowPushModal(false)}
                  className="rounded-lg px-3 py-1.5 text-[11px] text-gray-500 hover:bg-gray-100">
                  Cancel
                </button>
                <button
                  onClick={handlePropagate}
                  disabled={propagating || !hasTargets || selectedItems.size === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {propagating ? <RefreshCw size={10} className="animate-spin" /> : <Copy size={10} />}
                  Push changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── AI Chat Panel (session-based with diff) ────────────────────────────────

function SessionChatPanel({ runId, nodeId, variant, currentText, onApply, onClose }: {
  runId: string; nodeId: string; variant: Variant; currentText: string
  onApply: (text: string, diffOps: DiffOp[]) => void; onClose: () => void
}) {
  const [messages, setMessages] = useState<ChatSessionMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [liveText, setLiveText] = useState(currentText)

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: userMsg }])
    setLoading(true)
    try {
      const result = await chatWithDraftSession(runId, {
        node_id: nodeId,
        variant_id: variant.id,
        message: userMsg,
        current_text: liveText,
        session_id: sessionId ?? undefined,
        history: messages.map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', text: m.text })),
      })
      if (!sessionId) setSessionId(result.session_id)
      setMessages((prev) => [...prev, {
        role: 'ai',
        text: result.reply,
        suggested_text: result.suggested_text,
        diff_ops: result.diff_ops,
      }])
      if (result.suggested_text) {
        setLiveText(result.suggested_text)
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'ai', text: 'Sorry, something went wrong.' }])
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <MessageSquare size={13} className="text-indigo-500" />
          <span className="text-xs font-semibold text-gray-800">AI Editor — Variant {variant.label}</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Sparkles size={20} className="mx-auto mb-2 text-indigo-300" />
            <p className="text-[11px] text-gray-400">Ask the AI to refine, restructure, or improve this variant.</p>
            <p className="text-[10px] text-gray-300 mt-1">Web search is available for factual lookups.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`rounded-lg ${msg.role === 'user' ? 'bg-indigo-50 ml-8 px-3 py-2' : 'bg-white border border-gray-100 mr-4 px-3 py-2.5 shadow-sm'}`}>
            <p className="text-xs text-gray-700 whitespace-pre-wrap">{msg.text}</p>
            {msg.diff_ops && msg.diff_ops.length > 0 && msg.suggested_text && (
              <div className="mt-2.5 space-y-2">
                <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide">Changes</p>
                <DiffView diffOps={msg.diff_ops} compact />
                <button
                  onClick={() => onApply(msg.suggested_text!, msg.diff_ops!)}
                  className="mt-1.5 flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-green-700 transition-colors"
                >
                  <Check size={9} /> Apply Changes
                </button>
              </div>
            )}
            {msg.suggested_text && (!msg.diff_ops || msg.diff_ops.length === 0) && (
              <div className="mt-2 rounded border border-green-200 bg-green-50 p-2">
                <p className="text-[10px] text-green-800 whitespace-pre-wrap">{msg.suggested_text.slice(0, 400)}{(msg.suggested_text?.length ?? 0) > 400 ? '...' : ''}</p>
                <button
                  onClick={() => onApply(msg.suggested_text!, [])}
                  className="mt-1.5 flex items-center gap-1 rounded bg-green-600 px-2 py-1 text-[9px] font-medium text-white hover:bg-green-700"
                >
                  <Check size={8} /> Apply This
                </button>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-1.5 text-[10px] text-indigo-500 mr-8">
            <RefreshCw size={10} className="animate-spin" /> Thinking...
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-gray-200 px-3 py-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
          placeholder="Ask AI to improve this variant..."
          className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs placeholder:text-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || loading}
          className="rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  )
}

// ─── Edit Workspace (split-panel redesign) ──────────────────────────────────

function EditWorkspace({ node, runId, allVariants, allPlatformNodes = [], onFeedback }: {
  node: WorkflowNode; runId: string; allVariants: Variant[]; allPlatformNodes?: WorkflowNode[]; onFeedback?: () => void
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [editorMode, setEditorMode] = useState<'inline' | 'ai'>('inline')
  const [editText, setEditText] = useState(allVariants[0]?.text ?? '')
  const [leftTab, setLeftTab] = useState<'output' | 'rationale' | 'research' | 'validation'>('output')
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [revalidating, setRevalidating] = useState(false)
  const [historyKey, setHistoryKey] = useState(0)
  const [showDiffPreview, setShowDiffPreview] = useState(false)
  const [lastSyncedText, setLastSyncedText] = useState(allVariants[0]?.text ?? '')
  const queryClient = useQueryClient()

  const variants = allVariants
  const active = variants[activeIdx] ?? null

  // Sync editText when the variant text changes from the server (e.g. after save + refetch)
  // but only if the user hasn't made local unsaved changes
  const serverText = active?.text ?? ''
  if (serverText !== lastSyncedText) {
    const userHasLocalEdits = editText !== lastSyncedText
    if (!userHasLocalEdits) {
      setEditText(serverText)
    }
    setLastSyncedText(serverText)
  }

  const switchVariant = (idx: number) => {
    setActiveIdx(idx)
    const newText = variants[idx]?.text ?? ''
    setEditText(newText)
    setLastSyncedText(newText)
    setHistoryKey((k) => k + 1)
    setShowDiffPreview(false)
  }

  const validationResults = (node.validation_results ?? []).filter(
    (r) => active && (r.variant_label === active.label || r.variant_label === `Variant ${active.label}`)
  )
  const failCount = validationResults.filter((r) => r.status === 'fail').length
  const warnCount = validationResults.filter((r) => r.status === 'warn').length
  const researchCount = ((node.composition?.research_briefs ?? []) as unknown[]).length
  const hasChanges = active && editText !== active.text

  const liveDiffOps = hasChanges ? computeClientDiffOps(active.text, editText) : []

  const doFeedback = async (action: string, finalText?: string, instruction?: string) => {
    setActionPending(action)
    try {
      await submitFeedback(runId, {
        node_id: node.id,
        variant_id: active!.id,
        action,
        final_text: finalText,
        user_instruction: instruction,
      })
      onFeedback?.()
      setHistoryKey((k) => k + 1)
      setShowDiffPreview(false)
    } catch { /* swallow */ }
    setActionPending(null)
  }

  const handleSaveEdit = () => {
    if (!hasChanges) return
    doFeedback('edit', editText)
  }

  const handleRevalidate = async () => {
    if (!active) return
    setRevalidating(true)
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/v1/workflows/runs/${runId}/revalidate`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ node_id: node.id }) },
      )
      if (resp.ok) {
        queryClient.invalidateQueries({ queryKey: ['run', runId] })
        onFeedback?.()
      }
    } catch { /* swallow */ }
    setRevalidating(false)
  }

  const handleAiApply = (newText: string, _diffOps: DiffOp[]) => {
    setEditText(newText)
    doFeedback('edit', newText, 'Applied from AI chat')
  }

  if (!active) return null

  const score = active.consistency_score ?? 70
  const scoreColor = score >= 75 ? 'text-green-600 bg-green-50' : score >= 60 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50'

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: variant tabs + status */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2 border-b border-gray-100">
        <div className="flex-1">
          <VariantTabBar variants={variants} activeIdx={activeIdx} onSelect={switchVariant} />
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${scoreColor}`}>{score}%</span>
        {active.status === 'edited' && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">Edited</span>}
        {active.status === 'accepted' && <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-medium text-green-700">Accepted</span>}
      </div>

      {/* Split panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT PANE: Sub-tabbed (Output / Research / Validation) */}
        <div className="w-1/2 border-r border-gray-100 flex flex-col overflow-hidden">
          {/* Sub-tab bar */}
          <div className="flex items-center gap-0.5 border-b border-gray-100 px-3 pt-1">
            {(['output', 'rationale', 'research', 'validation'] as const).map((tab) => {
              const isActive = leftTab === tab
              const label = tab === 'output' ? 'Output' : tab === 'rationale' ? 'Rationale' : tab === 'research' ? 'Research' : 'Validation'
              const badge = tab === 'research' && researchCount > 0
                ? <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[8px] font-bold text-indigo-600">{researchCount}</span>
                : tab === 'validation' && (failCount > 0 || warnCount > 0)
                  ? <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${failCount > 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>{failCount > 0 ? failCount : warnCount}</span>
                  : null
              return (
                <button
                  key={tab}
                  onClick={() => setLeftTab(tab)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors ${isActive ? 'border-gray-800 text-gray-800' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                >
                  {label}
                  {badge}
                </button>
              )
            })}
          </div>

          {/* Sub-tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {leftTab === 'output' && (
              <div className="space-y-4">
                {/* Media */}
                {(active.image_url || active.video_url) && (
                  <div className="space-y-2">
                    {active.image_url && (
                      <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
                        <img src={active.image_url} alt="Generated" className="h-40 w-full object-cover" />
                      </div>
                    )}
                    {active.video_url && (
                      <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
                        <video src={active.video_url} controls className="h-40 w-full object-cover" />
                      </div>
                    )}
                  </div>
                )}

                {/* Generated text */}
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Generated Output</p>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs leading-relaxed text-gray-700 whitespace-pre-wrap">{active.text}</p>
                  </div>
                </div>
              </div>
            )}

            {leftTab === 'rationale' && (
              <div>
                {(active.rationale || active.rationale_struct) ? (
                  <StructuredRationale variant={active} />
                ) : (
                  <div className="py-8 text-center">
                    <Lightbulb size={20} className="mx-auto mb-2 text-gray-200" />
                    <p className="text-[11px] text-gray-400">No rationale available</p>
                  </div>
                )}
              </div>
            )}

            {leftTab === 'research' && (
              <div>
                <ResearchContext composition={node.composition ?? {}} />
              </div>
            )}

            {leftTab === 'validation' && (
              <div className="space-y-2">
                {validationResults.length === 0 ? (
                  <div className="py-8 text-center">
                    <ShieldCheck size={20} className="mx-auto mb-2 text-gray-200" />
                    <p className="text-[11px] text-gray-400">No validation results yet</p>
                  </div>
                ) : (
                  <>
                    {(() => {
                      const statusOrder: Record<string, number> = { fail: 0, warn: 1, pass: 2 }
                      const sorted = [...validationResults].sort(
                        (a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3),
                      )
                      const typeColors: Record<string, string> = {
                        voice: 'bg-indigo-50 text-indigo-600',
                        persona: 'bg-amber-50 text-amber-600',
                        ruleset: 'bg-gray-100 text-gray-600',
                      }
                      return sorted.map((r, i) => (
                        <div key={i} className="flex items-start gap-2.5 rounded-lg bg-white px-3 py-2.5 border border-gray-100 shadow-sm">
                          {r.status === 'pass' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-green-500" />
                           : r.status === 'warn' ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                           : <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold text-gray-800">{r.rule_name}</span>
                              <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-medium ${typeColors[r.rule_type] ?? 'bg-gray-50 text-gray-500'}`}>
                                {r.rule_type}
                              </span>
                            </div>
                            {r.message && <p className="text-[11px] text-gray-500 mt-0.5">{r.message}</p>}
                          </div>
                        </div>
                      ))
                    })()}
                    {active.status === 'edited' && (
                      <button onClick={handleRevalidate} disabled={revalidating}
                        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 py-2 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors">
                        {revalidating ? <RefreshCw size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
                        Re-validate after edits
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANE: Editor + actions + history */}
        <div className="w-1/2 flex flex-col overflow-hidden">

          {/* Editor toolbar */}
          <div className="flex items-center gap-1 border-b border-gray-100 px-3 py-1.5">
            <button
              onClick={() => { setEditorMode('inline'); setShowDiffPreview(false) }}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${editorMode === 'inline' && !showDiffPreview ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <Pencil size={10} /> Edit
            </button>
            {hasChanges && (
              <button
                onClick={() => { setEditorMode('inline'); setShowDiffPreview(!showDiffPreview) }}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${showDiffPreview ? 'bg-amber-600 text-white' : 'text-amber-600 hover:bg-amber-50 border border-amber-200'}`}
              >
                <GitBranch size={10} /> Diff
              </button>
            )}
            <button
              onClick={() => { setEditorMode('ai'); setShowDiffPreview(false) }}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${editorMode === 'ai' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <Sparkles size={10} /> AI Editor
            </button>

            <div className="flex-1" />

            {active.status !== 'accepted' && (
              <button onClick={() => doFeedback('accept')} disabled={!!actionPending}
                className="flex items-center gap-1 rounded-md bg-green-50 border border-green-200 px-2 py-1 text-[10px] font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors">
                {actionPending === 'accept' ? <RefreshCw size={9} className="animate-spin" /> : <Check size={9} />} Accept
              </button>
            )}
            <button onClick={() => doFeedback('reject')} disabled={!!actionPending}
              className="flex items-center gap-1 rounded-md bg-red-50 border border-red-200 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors">
              <XCircle size={9} /> Reject
            </button>
          </div>

          {/* Editor content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {editorMode === 'inline' && !showDiffPreview ? (
              <div className="p-4 flex flex-col h-full">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="flex-1 w-full resize-none rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-800 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 focus:outline-none min-h-[200px] font-mono"
                  placeholder="Edit your variant text here..."
                />
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={!hasChanges || actionPending === 'edit'}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                  >
                    {actionPending === 'edit' ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                    Save
                  </button>
                  <button
                    onClick={() => setEditText(active.text)}
                    disabled={!hasChanges}
                    className="rounded-lg px-3 py-2 text-[11px] text-gray-500 hover:bg-gray-100 disabled:opacity-40 transition-colors"
                  >
                    Reset
                  </button>
                  {hasChanges && (
                    <button
                      onClick={() => setShowDiffPreview(true)}
                      className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-amber-700"
                    >
                      <GitBranch size={9} /> Review changes
                    </button>
                  )}
                </div>

                {/* Edit history */}
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <History size={12} className="text-gray-400" />
                    <span className="text-[11px] font-semibold text-gray-600">Edit History</span>
                  </div>
                  <EditHistoryTimeline key={`${active.id}-${historyKey}`} runId={runId} nodeId={node.id} variantId={active.id} />
                </div>
              </div>
            ) : editorMode === 'inline' && showDiffPreview ? (
              /* Cursor-style diff preview */
              <div className="p-4 flex flex-col h-full">
                <div className="mb-3 flex items-center gap-2">
                  <GitBranch size={13} className="text-amber-500" />
                  <span className="text-xs font-semibold text-gray-700">Review Changes</span>
                  <span className="text-[10px] text-gray-400">
                    {liveDiffOps.filter((o) => o.op === 'delete').reduce((n, o) => n + o.lines.length, 0)} removed,{' '}
                    {liveDiffOps.filter((o) => o.op === 'insert').reduce((n, o) => n + o.lines.length, 0)} added
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                  <DiffView diffOps={liveDiffOps} />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={!hasChanges || actionPending === 'edit'}
                    className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-[11px] font-medium text-white hover:bg-green-700 disabled:opacity-40 transition-colors"
                  >
                    {actionPending === 'edit' ? <RefreshCw size={11} className="animate-spin" /> : <Check size={11} />}
                    Accept Changes
                  </button>
                  <button
                    onClick={() => { setEditText(active.text); setShowDiffPreview(false) }}
                    className="flex items-center gap-1.5 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-[11px] font-medium text-red-600 hover:bg-red-100 transition-colors"
                  >
                    <XCircle size={11} /> Discard
                  </button>
                  <button
                    onClick={() => setShowDiffPreview(false)}
                    className="rounded-lg px-3 py-2 text-[11px] text-gray-500 hover:bg-gray-100 transition-colors"
                  >
                    Back to editor
                  </button>
                </div>
              </div>
            ) : (
              <SessionChatPanel
                runId={runId}
                nodeId={node.id}
                variant={active}
                currentText={editText}
                onApply={handleAiApply}
                onClose={() => setEditorMode('inline')}
              />
            )}
          </div>

          {/* Change summary bar */}
          <div className="border-t border-gray-100 px-4 py-2">
            <ChangeSummaryBar
              key={`${active.id}-${historyKey}`}
              runId={runId}
              nodeId={node.id}
              variantId={active.id}
              variants={variants}
              currentPlatform={node.platform ?? undefined}
              allPlatformNodes={allPlatformNodes}
              onFeedback={onFeedback}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Review Panel (accept / reject only) ────────────────────────────────────

function ReviewPanel({ node, runId, onFeedback }: { node: WorkflowNode; runId: string; onFeedback?: () => void }) {
  const [activeIdx, setActiveIdx] = useState(0)
  const variants = node.variants
  const active = variants[activeIdx] ?? null
  const [actionPending, setActionPending] = useState<string | null>(null)

  const handleAccept = async (v: Variant) => {
    setActionPending('accept')
    try {
      await submitFeedback(runId, { node_id: node.id, variant_id: v.id, action: 'accept', final_text: v.text })
      onFeedback?.()
    } finally { setActionPending(null) }
  }
  const handleReject = async (v: Variant) => {
    setActionPending('reject')
    try {
      await submitFeedback(runId, { node_id: node.id, variant_id: v.id, action: 'reject', final_text: v.text })
      onFeedback?.()
    } finally { setActionPending(null) }
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Review & Approve</h3>
        <p className="mt-0.5 text-xs text-gray-500">Accept or reject each variant</p>
      </div>

      <VariantTabBar variants={variants} activeIdx={activeIdx} onSelect={setActiveIdx} />

      {active && (
        <div className="space-y-3">
          {/* Read-only content */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{active.text}</p>
          </div>

          {/* Structured Rationale */}
          <StructuredRationale variant={active} />

          {/* Accept / Reject actions */}
          <div className="flex items-center gap-2 pt-1">
            {active.status === 'accepted' ? (
              <span className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-xs font-medium text-white">
                <CheckCircle2 size={14} /> Accepted
              </span>
            ) : active.status === 'rejected' ? (
              <span className="flex items-center gap-1.5 rounded-lg bg-red-100 px-4 py-2 text-xs font-medium text-red-700">
                <XCircle size={14} /> Rejected
              </span>
            ) : (
              <>
                <button onClick={() => handleAccept(active)} disabled={!!actionPending}
                  className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors">
                  {actionPending === 'accept' ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />} Accept
                </button>
                <button onClick={() => handleReject(active)} disabled={!!actionPending}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors">
                  {actionPending === 'reject' ? <RefreshCw size={14} className="animate-spin" /> : <XCircle size={14} />} Reject
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ChatPanel({ runId, nodeId, variant, onClose, onApply }: {
  runId: string; nodeId: string; variant: Variant; onClose: () => void
  onApply: (text: string) => void
}) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; text: string; suggested?: string | null }>>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentText, setCurrentText] = useState(variant.text)

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: userMsg }])
    setLoading(true)
    try {
      const result = await chatWithDraft(runId, {
        node_id: nodeId,
        variant_id: variant.id,
        message: userMsg,
        current_text: currentText,
      })
      setMessages((prev) => [...prev, { role: 'ai', text: result.reply, suggested: result.suggested_text }])
      if (result.suggested_text) {
        setCurrentText(result.suggested_text)
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'ai', text: 'Sorry, something went wrong.' }])
    }
    setLoading(false)
  }

  return (
    <div className="mt-4 rounded-xl border border-indigo-200 bg-white shadow-md">
      <div className="flex items-center justify-between border-b border-indigo-100 px-4 py-2.5">
        <span className="text-xs font-semibold text-indigo-700">Chat with AI — Variant {variant.label}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
      </div>

      <div className="max-h-64 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-[10px] text-gray-400 text-center py-4">Ask the AI to refine, restructure, or improve this variant.</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`rounded-lg px-3 py-2 text-xs ${msg.role === 'user' ? 'bg-indigo-50 text-indigo-800 ml-8' : 'bg-gray-50 text-gray-700 mr-8'}`}>
            <p className="whitespace-pre-wrap">{msg.text}</p>
            {msg.suggested && (
              <div className="mt-2 rounded border border-green-200 bg-green-50 p-2">
                <p className="mb-1 text-[9px] font-semibold text-green-700">Suggested revision:</p>
                <p className="text-[10px] text-green-800 whitespace-pre-wrap">{msg.suggested.slice(0, 300)}{(msg.suggested?.length ?? 0) > 300 ? '...' : ''}</p>
                <button onClick={() => onApply(msg.suggested!)}
                  className="mt-1.5 flex items-center gap-1 rounded bg-green-600 px-2 py-1 text-[9px] font-medium text-white hover:bg-green-700">
                  <Check size={8} /> Apply This
                </button>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-1.5 text-[10px] text-indigo-500 mr-8"><RefreshCw size={10} className="animate-spin" /> Thinking...</div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
          placeholder="Ask AI to improve this variant..."
          className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs placeholder:text-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none" />
        <button onClick={sendMessage} disabled={!input.trim() || loading}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          <Send size={12} />
        </button>
      </div>
    </div>
  )
}

// ─── Publish Panel ───────────────────────────────────────────────────────────

function PublishPanel({ node, platform }: { node: WorkflowNode; platform: Platform }) {
  const [scheduleDate, setScheduleDate] = useState('')
  const accepted = node.variants.filter((v) => v.status === 'accepted')
  const bestVariant = accepted.length > 0 ? accepted[0] : node.variants[0]
  return (
    <div className="p-5">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Publish to {PLATFORM_LABELS[platform]}</h3>
      <p className="mb-4 text-xs text-gray-500">Preview and schedule or publish</p>
      {!bestVariant ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-8 text-center"><Send size={24} className="mx-auto mb-1 text-gray-300" /><p className="text-xs text-gray-400">Approve a variant first.</p></div>
      ) : (
        <>
          <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="mb-2 flex items-center gap-2"><PlatformIcon platform={platform} size={16} /><span className="text-xs font-semibold text-gray-700">{PLATFORM_LABELS[platform]} Preview</span><span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">Variant {bestVariant.label}</span></div>
            <div className="rounded border border-gray-200 bg-white p-3"><p className="text-xs leading-relaxed text-gray-800 whitespace-pre-wrap">{bestVariant.text}</p></div>
          </div>
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-medium text-gray-700">Schedule</label>
            <input type="datetime-local" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 shadow-sm"><Send size={14} /> {scheduleDate ? 'Schedule' : 'Publish Now'}</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Audit Drawer ────────────────────────────────────────────────────────────

function AuditDrawer({ runId, earliestStartedAt }: { runId: string; earliestStartedAt?: string }) {
  const [tab, setTab] = useState<'traces' | 'audit'>('traces')
  const { data: entries = [], isLoading } = useQuery({ queryKey: ['audit', runId], queryFn: () => getRunAudit(runId), refetchInterval: 5000 })
  const { data: traces = [], isLoading: tracesLoading } = useQuery({
    queryKey: ['traces-all', runId, earliestStartedAt],
    queryFn: () => getRunTraces(runId, undefined, earliestStartedAt),
    refetchInterval: 3000,
  })

  const agentColors: Record<string, string> = {
    research: 'bg-blue-100 text-blue-700',
    draft: 'bg-indigo-100 text-indigo-700',
    validate: 'bg-amber-100 text-amber-700',
  }

  const byPlatform: Record<string, TraceEntry[]> = {}
  for (const t of traces) {
    const p = t.platform || 'general'
    ;(byPlatform[p] ??= []).push(t)
  }
  const platforms = Object.keys(byPlatform).sort()

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <ScrollText size={14} /> Audit Trail
        </h3>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[10px]">
          <button
            onClick={() => setTab('traces')}
            className={`px-2.5 py-1 font-medium ${tab === 'traces' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            Agent Traces{traces.length > 0 ? ` (${traces.length})` : ''}
          </button>
          <button
            onClick={() => setTab('audit')}
            className={`px-2.5 py-1 font-medium border-l border-gray-200 ${tab === 'audit' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            DB Audit Log
          </button>
        </div>
      </div>

      {tab === 'traces' && (
        <>
          {tracesLoading && (
            <div className="py-6 text-center">
              <RefreshCw size={14} className="mx-auto animate-spin text-gray-400" />
            </div>
          )}
          {!tracesLoading && traces.length === 0 && (
            <p className="py-6 text-center text-xs text-gray-400">
              No traces yet. Traces appear once a pipeline starts running.
            </p>
          )}
          {platforms.map(plat => (
            <div key={plat} className="mb-3">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{plat}</span>
                <span className="text-[9px] text-gray-300">{byPlatform[plat].length} calls</span>
              </div>
              <div className="space-y-1">
                {byPlatform[plat].map(t => (
                  <div key={t.id} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
                    t.error ? 'border-red-200 bg-red-50/50' :
                    t.status === 'success' || t.status === 'completed' ? 'border-gray-100 bg-gray-50/50' :
                    'border-amber-200 bg-amber-50/30'
                  }`}>
                    {t.error ? <XCircle size={11} className="shrink-0 text-red-400" /> :
                     t.status === 'success' || t.status === 'completed' ? <CheckCircle2 size={11} className="shrink-0 text-emerald-400" /> :
                     <RefreshCw size={11} className="shrink-0 animate-spin text-amber-400" />}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-gray-700">{t.agent}</span>
                    <span className="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[8px] text-gray-500">{t.run_type}</span>
                    {t.total_tokens > 0 && (
                      <span className="shrink-0 text-[9px] tabular-nums text-gray-400">{t.total_tokens.toLocaleString()}</span>
                    )}
                    <span className="shrink-0 text-[10px] tabular-nums text-gray-400">
                      {t.elapsed_ms != null ? `${(t.elapsed_ms / 1000).toFixed(1)}s` : '…'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'audit' && (
        <>
          {isLoading && (
            <div className="py-6 text-center">
              <RefreshCw size={14} className="mx-auto animate-spin text-gray-400" />
            </div>
          )}
          {!isLoading && entries.length === 0 && (
            <p className="py-6 text-center text-xs text-gray-400">No entries yet.</p>
          )}
          <div className="space-y-2">
            {(entries as unknown as AuditEntry[]).map((entry, i) => (
              <div key={entry.id ?? i} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                <div className="mb-1 flex items-center gap-2">
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${agentColors[entry.step] ?? 'bg-gray-100 text-gray-600'}`}>
                    {entry.agent_name}
                  </span>
                  {entry.platform && <PlatformChip platform={entry.platform as Platform} />}
                  <span className={`ml-auto text-[9px] ${entry.status === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                    {entry.latency_ms}ms
                  </span>
                </div>
                <p className="text-[10px] text-gray-600 line-clamp-2">{entry.output_summary}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Changelog Drawer ────────────────────────────────────────────────────────

const CHANGE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  source_edit: { label: 'Source Edit', color: 'bg-blue-100 text-blue-700' },
  composition_change: { label: 'Composition', color: 'bg-indigo-100 text-indigo-700' },
  variant_accept: { label: 'Accepted', color: 'bg-green-100 text-green-700' },
  variant_edit: { label: 'Edited', color: 'bg-amber-100 text-amber-700' },
  variant_reject: { label: 'Rejected', color: 'bg-red-100 text-red-700' },
  variant_regenerate: { label: 'Regenerated', color: 'bg-purple-100 text-purple-700' },
}

interface ChangeLogEntry {
  id: string
  run_id: string
  node_id?: string | null
  change_type: string
  field: string
  before_snapshot: Record<string, unknown>
  after_snapshot: Record<string, unknown>
  user_instruction?: string | null
  version: number
  created_at?: string | null
}

function ChangelogDrawer({ runId }: { runId: string }) {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['changelog', runId],
    queryFn: () => getRunChangelog(runId),
    refetchInterval: 5000,
  })

  const typedEntries = entries as unknown as ChangeLogEntry[]

  return (
    <div className="p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900"><History size={14} /> Version History</h3>
      {isLoading && <div className="py-6 text-center"><RefreshCw size={14} className="mx-auto animate-spin text-gray-400" /></div>}
      {!isLoading && typedEntries.length === 0 && <p className="py-6 text-center text-[10px] text-gray-400">No changes recorded yet.</p>}
      <div className="space-y-2">
        {typedEntries.map((entry) => {
          const meta = CHANGE_TYPE_LABELS[entry.change_type] ?? { label: entry.change_type, color: 'bg-gray-100 text-gray-600' }
          return (
            <div key={entry.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400">v{entry.version}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${meta.color}`}>{meta.label}</span>
                <span className="ml-auto text-[9px] text-gray-400">{entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}</span>
              </div>
              {entry.user_instruction && (
                <p className="mb-1 text-[10px] text-indigo-600 italic">&ldquo;{entry.user_instruction}&rdquo;</p>
              )}
              <div className="flex gap-2">
                {entry.field === 'source_content' && (
                  <>
                    <div className="flex-1 rounded border border-red-100 bg-red-50/50 p-1.5">
                      <span className="mb-0.5 block text-[8px] font-bold text-red-400 uppercase">Before</span>
                      <p className="text-[10px] text-gray-600 line-clamp-3">{String(entry.before_snapshot?.source_content ?? '').slice(0, 200)}</p>
                    </div>
                    <div className="flex-1 rounded border border-green-100 bg-green-50/50 p-1.5">
                      <span className="mb-0.5 block text-[8px] font-bold text-green-400 uppercase">After</span>
                      <p className="text-[10px] text-gray-600 line-clamp-3">{String(entry.after_snapshot?.source_content ?? '').slice(0, 200)}</p>
                    </div>
                  </>
                )}
                {entry.field === 'variant' && (
                  <>
                    <div className="flex-1 rounded border border-red-100 bg-red-50/50 p-1.5">
                      <span className="mb-0.5 block text-[8px] font-bold text-red-400 uppercase">Before</span>
                      <p className="text-[10px] text-gray-600 line-clamp-3">{String(entry.before_snapshot?.text ?? '').slice(0, 200)}</p>
                    </div>
                    <div className="flex-1 rounded border border-green-100 bg-green-50/50 p-1.5">
                      <span className="mb-0.5 block text-[8px] font-bold text-green-400 uppercase">After</span>
                      <p className="text-[10px] text-gray-600 line-clamp-3">{String(entry.after_snapshot?.text ?? '').slice(0, 200)}</p>
                    </div>
                  </>
                )}
                {entry.field === 'composition' && (
                  <p className="text-[10px] text-gray-500">Composition updated for node</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Router ──────────────────────────────────────────────────────────────────

export function WorkflowEditor() {
  return (
    <Routes>
      <Route index element={<WorkflowList />} />
      <Route path=":defId" element={<WorkflowDetailView />} />
      <Route path=":defId/runs/:runId" element={<RunEditorView />} />
    </Routes>
  )
}
