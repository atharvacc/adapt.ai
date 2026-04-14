import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Users,
  PenTool,
  X,
  Tag,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Check,
  Loader2,
  Pencil,
  Trash2,
  History,
  RotateCcw,
  FileText,
  Globe,
  Zap,
} from 'lucide-react'
import {
  listPersonas,
  createPersona,
  updatePersona,
  deletePersona,
  listAccounts,
  discoverPersonas,
  listVersions,
  restoreVersion,
} from '../../lib/api'
import type { Version } from '../../lib/api'
import { PlatformIcon, PLATFORM_LABELS } from '../../components/PlatformIcon'
import type { Platform } from '../../types'

type Persona = Record<string, unknown>

const TONE_DIMENSION_PRESETS: Record<string, string> = {
  formality: 'Formality',
  confidence: 'Confidence',
  warmth: 'Warmth',
  humor: 'Humor',
  technical_depth: 'Technical Depth',
  urgency: 'Urgency',
  empathy: 'Empathy',
}

const ACTIVITY_PRESETS = [
  { key: 'audience_platform', label: 'Audience & Platform Intelligence', description: 'Audience demographics, algorithm signals, optimal formats, timing, and visual best practices' },
  { key: 'trends_listening', label: 'Trends & Social Listening', description: 'Trending topics, hashtags, hook benchmarking, engagement triggers, and live conversations' },
  { key: 'competitor_industry', label: 'Competitor & Industry Analysis', description: 'Competitor content patterns, industry news, supporting data/stats, and gaps to exploit' },
  { key: 'brand_knowledge', label: 'Brand & Internal Knowledge', description: 'Brand voice guidelines, internal rules, personal stories, and customer proof points' },
] as const

const OLD_TO_NEW_ACTIVITY: Record<string, string> = {
  competitor_analysis: 'competitor_industry',
  industry_news: 'competitor_industry',
  data_research: 'competitor_industry',
  audience_signals: 'audience_platform',
  platform_trends: 'audience_platform',
  social_listening: 'trends_listening',
  internal_knowledge: 'brand_knowledge',
  personal_experience: 'brand_knowledge',
  customer_stories: 'brand_knowledge',
}

function migrateActivities(raw: string[]): string[] {
  const migrated = new Set<string>()
  for (const a of raw) {
    migrated.add(OLD_TO_NEW_ACTIVITY[a] ?? a)
  }
  return Array.from(migrated).filter((k) => ACTIVITY_PRESETS.some((p) => p.key === k))
}

const PLATFORM_KEYS: Platform[] = ['linkedin', 'x', 'instagram', 'facebook']

const TONE_OPTIONS = ['casual', 'professional', 'inspirational', 'educational'] as const
const FORMAT_OPTIONS = ['how-to', 'case-study', 'opinion', 'listicle', 'story', 'data-driven'] as const
const LENGTH_OPTIONS = ['short', 'medium', 'long'] as const

function PersonaCard({ persona, onEdit }: { persona: Persona; onEdit: (p: Persona) => void }) {
  const name = (persona.name as string) ?? 'Untitled'
  const type = (persona.persona_type as string) ?? 'audience'
  const description = (persona.description as string) ?? ''
  const demographics = (persona.demographics as Record<string, unknown>) ?? {}
  const interests = (persona.interests as string[]) ?? []
  const rawActivities = (persona.enabled_tools as string[]) ?? []
  const activities = migrateActivities(rawActivities)
  const writingApproach = (persona.writing_approach as string) ?? ''
  const isWriter = type === 'agent'
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-300">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              isWriter ? 'bg-amber-50' : 'bg-green-50'
            }`}
          >
            {isWriter ? (
              <PenTool size={18} className="text-amber-500" />
            ) : (
              <Users size={18} className="text-green-500" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-gray-900">{name}</h3>
            <p className="text-sm text-gray-500 line-clamp-2">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit(persona)}
            className="rounded-lg p-1.5 text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-600 transition-all"
            title="Edit persona"
          >
            <Pencil size={14} />
          </button>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              isWriter
              ? 'bg-amber-100 text-amber-700'
              : 'bg-green-100 text-green-700'
          }`}
        >
            {isWriter ? 'Writing' : 'Audience'}
        </span>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="rounded-lg p-1 hover:bg-gray-100"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
      </div>
      </div>
      {expanded && isWriter && (
        <div className="mt-1 space-y-2.5 border-t border-gray-100 pt-3 text-xs text-gray-600">
          {writingApproach && (
            <p><span className="font-medium text-gray-700">Approach:</span> {writingApproach}</p>
          )}
          {activities.length > 0 && (
            <div>
              <span className="font-medium text-gray-700">Researches:</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {activities.map((a) => {
                  const preset = ACTIVITY_PRESETS.find((p) => p.key === a)
                  return (
                    <span key={a} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                      {preset ? preset.label : a}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {expanded && !isWriter && (
        <div className="mt-1 space-y-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
          {demographics.age_range ? (
            <p><span className="font-medium text-gray-700">Age:</span> {String(demographics.age_range)}</p>
          ) : null}
          {demographics.industries ? (
            <p><span className="font-medium text-gray-700">Industries:</span> {(demographics.industries as string[]).join(', ')}</p>
          ) : null}
          {interests.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {interests.map((i) => (
                <span key={i} className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                  {i}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TagInput({
  label,
  tags,
  onAdd,
  onRemove,
  placeholder,
  color = 'green',
}: {
  label: string
  tags: string[]
  onAdd: (t: string) => void
  onRemove: (t: string) => void
  placeholder?: string
  color?: 'green' | 'red'
}) {
  const [input, setInput] = useState('')
  const colorMap = {
    green: { bg: 'bg-green-50', text: 'text-green-700', hover: 'hover:text-green-900' },
    red: { bg: 'bg-red-50', text: 'text-red-700', hover: 'hover:text-red-900' },
  }
  const c = colorMap[color]

  function add() {
    const t = input.trim()
    if (t && !tags.includes(t)) {
      onAdd(t)
      setInput('')
    }
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className={`inline-flex items-center gap-1 rounded-full ${c.bg} px-2.5 py-0.5 text-xs font-medium ${c.text}`}>
              <Tag size={10} />
              {t}
              <button type="button" onClick={() => onRemove(t)} className={`ml-0.5 ${c.hover}`}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateAudienceModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [ageRange, setAgeRange] = useState('')
  const [seniorityLevel, setSeniorityLevel] = useState('')
  const [companySize, setCompanySize] = useState('')
  const [industries, setIndustries] = useState<string[]>([])
  const [interests, setInterests] = useState<string[]>([])
  const [selectedFormats, setSelectedFormats] = useState<string[]>([])
  const [contentLength, setContentLength] = useState<string>('medium')
  const [contentTone, setContentTone] = useState<string>('professional')
  const [goals, setGoals] = useState<string[]>([])
  const [painPoints, setPainPoints] = useState<string[]>([])
  const [triggers, setTriggers] = useState<string[]>([])
  const [tagsPositive, setTagsPositive] = useState<string[]>([])
  const [tagsNegative, setTagsNegative] = useState<string[]>([])

  const [activeSection, setActiveSection] = useState(0)

  const sections = ['Basics', 'Demographics', 'Interests & Content', 'Goals & Triggers', 'Tags']

  const mutation = useMutation({
    mutationFn: () =>
      createPersona({
        name: name.trim(),
        persona_type: 'audience',
        description: description.trim(),
        demographics: {
          age_range: ageRange,
          seniority_level: seniorityLevel,
          company_size: companySize,
          industries,
        },
        interests,
        content_preferences: {
          format: selectedFormats,
          length: contentLength,
          tone: contentTone,
        },
        goals_and_triggers: {
          goals,
          pain_points: painPoints,
          triggers,
        },
        tags_positive: tagsPositive,
        tags_negative: tagsNegative,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] })
      onClose()
    },
  })

  function toggleFormat(f: string) {
    setSelectedFormats((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-8 pt-7 pb-2">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Create Audience Persona</h3>
            <p className="text-sm text-gray-400 mt-0.5">Define a target audience segment for content optimization</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-gray-100 transition-colors">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Step nav */}
        <div className="px-8 pt-4 pb-2">
          <div className="flex items-center gap-1">
            {sections.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setActiveSection(i)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                  activeSection === i
                    ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
                    : i < activeSection
                    ? 'text-green-600 hover:bg-green-50/50'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  activeSection === i
                    ? 'bg-green-600 text-white'
                    : i < activeSection
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-400'
                }`}>
                  {i < activeSection ? '✓' : i + 1}
                </span>
                <span className="hidden sm:inline">{s}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="flex flex-col gap-5">
            {/* Section 0: Basics */}
            {activeSection === 0 && (
              <>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Early-Stage Founders"
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    placeholder="Describe this audience segment and why they follow you..."
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none resize-none"
                  />
                </div>
              </>
            )}

          {/* Section 1: Demographics */}
          {activeSection === 1 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Age Range</label>
                  <input
                    value={ageRange}
                    onChange={(e) => setAgeRange(e.target.value)}
                    placeholder="e.g. 25-40"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Seniority</label>
                  <input
                    value={seniorityLevel}
                    onChange={(e) => setSeniorityLevel(e.target.value)}
                    placeholder="e.g. Mid-Level, VP"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Company Size</label>
                <input
                  value={companySize}
                  onChange={(e) => setCompanySize(e.target.value)}
                  placeholder="e.g. 10-50, Enterprise (1000+)"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none"
                />
              </div>
              <TagInput
                label="Industries"
                tags={industries}
                onAdd={(t) => setIndustries([...industries, t])}
                onRemove={(t) => setIndustries(industries.filter((x) => x !== t))}
                placeholder="e.g. SaaS, FinTech"
              />
            </>
          )}

          {/* Section 2: Interests & Content Preferences */}
          {activeSection === 2 && (
            <>
              <TagInput
                label="Interests"
                tags={interests}
                onAdd={(t) => setInterests([...interests, t])}
                onRemove={(t) => setInterests(interests.filter((x) => x !== t))}
                placeholder="e.g. AI, growth hacking, leadership"
              />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Preferred Formats</label>
                <div className="flex flex-wrap gap-2">
                  {FORMAT_OPTIONS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => toggleFormat(f)}
                      className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                        selectedFormats.includes(f)
                          ? 'bg-green-50 border-green-300 text-green-700'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {selectedFormats.includes(f) && <Check size={10} className="inline mr-1" />}
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Content Length</label>
                  <select
                    value={contentLength}
                    onChange={(e) => setContentLength(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none"
                  >
                    {LENGTH_OPTIONS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Content Tone</label>
                  <select
                    value={contentTone}
                    onChange={(e) => setContentTone(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none"
                  >
                    {TONE_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Section 3: Goals & Triggers */}
          {activeSection === 3 && (
            <>
              <TagInput
                label="Goals"
                tags={goals}
                onAdd={(t) => setGoals([...goals, t])}
                onRemove={(t) => setGoals(goals.filter((x) => x !== t))}
                placeholder="e.g. Scale their startup, hire better"
              />
              <TagInput
                label="Pain Points"
                tags={painPoints}
                onAdd={(t) => setPainPoints([...painPoints, t])}
                onRemove={(t) => setPainPoints(painPoints.filter((x) => x !== t))}
                placeholder="e.g. Limited budget, no team"
                color="red"
              />
              <TagInput
                label="Engagement Triggers"
                tags={triggers}
                onAdd={(t) => setTriggers([...triggers, t])}
                onRemove={(t) => setTriggers(triggers.filter((x) => x !== t))}
                placeholder="e.g. Contrarian takes, actionable tips"
              />
            </>
          )}

          {/* Section 4: Tags */}
          {activeSection === 4 && (
            <>
              <TagInput
                label="Positive Tags (content they love)"
                tags={tagsPositive}
                onAdd={(t) => setTagsPositive([...tagsPositive, t])}
                onRemove={(t) => setTagsPositive(tagsPositive.filter((x) => x !== t))}
                placeholder="e.g. founder stories, product launches"
              />
              <TagInput
                label="Negative Tags (content to avoid)"
                tags={tagsNegative}
                onAdd={(t) => setTagsNegative([...tagsNegative, t])}
                onRemove={(t) => setTagsNegative(tagsNegative.filter((x) => x !== t))}
                placeholder="e.g. generic motivation, clickbait"
                color="red"
              />
            </>
          )}

          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-8 py-5">
          <button
            type="button"
            onClick={() => setActiveSection(Math.max(0, activeSection - 1))}
            disabled={activeSection === 0}
            className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Back
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">Step {activeSection + 1} of {sections.length}</span>
            {activeSection < sections.length - 1 ? (
              <button
                type="button"
                onClick={() => setActiveSection(activeSection + 1)}
                className="rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                disabled={!name.trim() || mutation.isPending}
                onClick={() => mutation.mutate()}
                className="rounded-xl bg-green-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mutation.isPending ? 'Creating...' : 'Create Persona'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DiscoverModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: listAccounts,
  })

  const connectedAccounts = accounts.filter(
    (a) => (a.status as string) === 'connected',
  )

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<Record<string, unknown>[] | null>(null)

  const discoverMutation = useMutation({
    mutationFn: () => discoverPersonas(selectedIds),
    onSuccess: (data) => setSuggestions(data),
  })

  const saveMutation = useMutation({
    mutationFn: (persona: Record<string, unknown>) =>
      createPersona({
        name: persona.name,
        persona_type: 'audience',
        description: persona.description,
        demographics: persona.demographics ?? {},
        interests: persona.interests ?? [],
        content_preferences: persona.content_preferences ?? {},
        goals_and_triggers: persona.goals_and_triggers ?? {},
        tags_positive: persona.tags_positive ?? [],
        tags_negative: persona.tags_negative ?? [],
        source_account_ids: selectedIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] })
    },
  })

  function toggleAccount(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-violet-500" />
            <h3 className="text-lg font-semibold text-gray-900">Discover Audiences with AI</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {!suggestions ? (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Select connected accounts to analyze. AI will identify distinct audience segments
              from your posts, engagement patterns, and follower data.
            </p>

            {connectedAccounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-8">
                <Users size={24} className="mb-2 text-gray-300" />
                <p className="text-sm text-gray-500">No connected accounts. Import accounts first.</p>
              </div>
            ) : (
              <div className="space-y-2 mb-5">
                {connectedAccounts.map((a) => {
                  const id = a.id as string
                  const selected = selectedIds.includes(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleAccount(id)}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? 'border-violet-300 bg-violet-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div
                        className={`flex h-5 w-5 items-center justify-center rounded border ${
                          selected
                            ? 'border-violet-500 bg-violet-500'
                            : 'border-gray-300'
                        }`}
                      >
                        {selected && <Check size={12} className="text-white" />}
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-900">
                          @{a.handle as string}
                        </span>
                        <span className="ml-2 text-xs text-gray-400">
                          {(a.platform as string).toUpperCase()} · {a.post_count as number} posts
                        </span>
                      </div>
                      {((a.follower_data as Record<string, unknown>)?.status as string) === 'done' && (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-600">
                          Followers captured
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            <button
              type="button"
              disabled={selectedIds.length === 0 || discoverMutation.isPending}
              onClick={() => discoverMutation.mutate()}
              className="w-full rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {discoverMutation.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Analyzing accounts...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Discover Audiences ({selectedIds.length} account{selectedIds.length !== 1 ? 's' : ''})
                </>
              )}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4">
              AI discovered {suggestions.length} audience segments. Click to save them as personas.
            </p>

            <div className="space-y-3 mb-5">
              {suggestions.map((s, i) => {
                const demographics = (s.demographics as Record<string, unknown>) ?? {}
                const interests = (s.interests as string[]) ?? []
                return (
                  <div
                    key={i}
                    className="rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
          <div>
                        <h4 className="font-semibold text-gray-900">{s.name as string}</h4>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {s.description as string}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={saveMutation.isPending}
                        onClick={() => saveMutation.mutate(s)}
                        className="shrink-0 rounded-lg bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {demographics.age_range ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                          Age: {String(demographics.age_range)}
                        </span>
                      ) : null}
                      {demographics.seniority_level ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                          {String(demographics.seniority_level)}
                        </span>
                      ) : null}
                      {interests.slice(0, 4).map((int) => (
                        <span key={int} className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-600">
                          {int}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setSuggestions(null)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CreateWritingModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [activeSection, setActiveSection] = useState(0)

  // Step 1: Identity
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [writingApproach, setWritingApproach] = useState('')

  // Step 2: Voice & Tone
  const [toneSliders, setToneSliders] = useState<Record<string, number>>({
    formality: 50, confidence: 50, warmth: 50,
  })
  const [toneLabels, setToneLabels] = useState<Record<string, string>>({})
  const [structureGuidance, setStructureGuidance] = useState('')

  // Step 3: Style Examples
  const [styleSamples, setStyleSamples] = useState<string[]>([])
  const [sampleInput, setSampleInput] = useState('')
  const [refPostIds, setRefPostIds] = useState<string[]>([])

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: listAccounts,
  })
  const connectedAccounts = accounts.filter((a) => (a.status as string) === 'connected')

  // Step 4: Platform Rules
  const [platformBehavior, setPlatformBehavior] = useState<Record<string, string>>({})

  // Step 5: Activities
  const [selectedActivities, setSelectedActivities] = useState<string[]>([])

  const sections = ['Identity', 'Voice & Tone', 'Style Examples', 'Platform Rules', 'Research']

  function toggleActivity(key: string) {
    setSelectedActivities((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    )
  }

  function addSample() {
    const t = sampleInput.trim()
    if (t) {
      setStyleSamples([...styleSamples, t])
      setSampleInput('')
    }
  }

  function toggleRefPost(postId: string) {
    setRefPostIds((prev) =>
      prev.includes(postId) ? prev.filter((x) => x !== postId) : [...prev, postId],
    )
  }

  const mutation = useMutation({
    mutationFn: () => {
      const remappedTone: Record<string, number> = {}
      for (const [key, val] of Object.entries(toneSliders)) {
        const newLabel = toneLabels[key]
        if (newLabel && newLabel !== (TONE_DIMENSION_PRESETS[key] ?? key)) {
          remappedTone[newLabel.toLowerCase().replace(/\s+/g, '_')] = val
        } else {
          remappedTone[key] = val
        }
      }
      return createPersona({
        name: name.trim(),
        persona_type: 'agent',
        description: description.trim(),
        writing_approach: writingApproach.trim(),
        structure_preference: structureGuidance.trim(),
        tone: remappedTone,
        platform_behavior: platformBehavior,
        enabled_tools: selectedActivities,
        per_platform_config: {
          samples: styleSamples,
          reference_post_ids: refPostIds,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-8 pt-7 pb-2">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Create Writing Persona</h3>
            <p className="text-sm text-gray-400 mt-0.5">Define how this AI writer thinks, writes, and operates</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-gray-100 transition-colors">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Step nav */}
        <div className="px-8 pt-4 pb-2">
          <div className="flex items-center gap-1">
            {sections.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setActiveSection(i)}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${
                  activeSection === i
                    ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                    : i < activeSection
                    ? 'text-amber-600 hover:bg-amber-50/50'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  activeSection === i
                    ? 'bg-amber-600 text-white'
                    : i < activeSection
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-400'
                }`}>
                  {i < activeSection ? '✓' : i + 1}
                </span>
                <span className="hidden sm:inline">{s}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="flex flex-col gap-5">

            {/* Step 1: Identity */}
            {activeSection === 0 && (
              <>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Founder Storyteller, Technical Explainer"
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none"
            />
          </div>
          <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Who is this writer?</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="Describe this writer's background, perspective, and what makes their voice unique..."
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none resize-none"
            />
          </div>
          <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Writing Approach</label>
            <textarea
                    value={writingApproach}
                    onChange={(e) => setWritingApproach(e.target.value)}
                    rows={3}
                    placeholder="e.g. Writes from firsthand founder experience, uses real numbers and specific examples. Avoids generic advice. Opens with a contrarian hook."
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none resize-none"
            />
          </div>
              </>
            )}

            {/* Step 2: Voice & Tone */}
            {activeSection === 1 && (
              <>
          <div>
                  <label className="mb-3 block text-sm font-medium text-gray-700">Tone Dimensions</label>
                  <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                    {Object.keys(toneSliders).length > 0 && (
                      <div className="space-y-3">
                        {Object.entries(toneSliders).map(([key, val]) => (
                          <div key={key} className="flex items-center gap-3">
              <input
                              value={toneLabels[key] ?? (TONE_DIMENSION_PRESETS[key] ?? key)}
                              onChange={(e) => setToneLabels({ ...toneLabels, [key]: e.target.value })}
                              className="w-36 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 focus:border-amber-400 focus:ring-1 focus:ring-amber-100 focus:outline-none"
                            />
                            <input
                              type="range" min={0} max={100} value={val}
                              onChange={(e) => setToneSliders({ ...toneSliders, [key]: Number(e.target.value) })}
                              className="flex-1 accent-amber-500"
                            />
                            <span className="w-10 text-right text-xs font-semibold text-gray-500">{val}</span>
                            <button type="button" onClick={() => {
                              const next = { ...toneSliders }; delete next[key]
                              const nextL = { ...toneLabels }; delete nextL[key]
                              setToneSliders(next); setToneLabels(nextL)
                            }} className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors">
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {(() => {
                      const usedKeys = new Set(Object.keys(toneSliders))
                      const available = Object.entries(TONE_DIMENSION_PRESETS).filter(([k]) => !usedKeys.has(k))
                      return (
                        <div className={`flex items-center gap-2 ${Object.keys(toneSliders).length > 0 ? 'mt-4 pt-4 border-t border-gray-200' : ''}`}>
                          <select
                            id="new-tone-select"
                            defaultValue=""
                            className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none bg-white"
                          >
                            <option value="" disabled>Add a tone dimension...</option>
                            {available.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                            <option value="__custom">Custom dimension...</option>
                          </select>
                          <button type="button" onClick={() => {
                            const sel = document.getElementById('new-tone-select') as HTMLSelectElement
                            const v = sel.value; if (!v) return
                            if (v === '__custom') {
                              const custom = prompt('Enter custom dimension name:')
                              if (custom) {
                                const key = custom.toLowerCase().replace(/\s+/g, '_')
                                if (!toneSliders[key]) setToneSliders({ ...toneSliders, [key]: 50 })
                              }
                            } else if (!toneSliders[v]) { setToneSliders({ ...toneSliders, [v]: 50 }) }
                            sel.value = ''
                          }} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-600 transition-colors">
                            <Plus size={16} />
                          </button>
                        </div>
                      )
                    })()}
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Structure Guidance</label>
                  <textarea
                    value={structureGuidance}
                    onChange={(e) => setStructureGuidance(e.target.value)}
                    rows={3}
                    placeholder="How should this persona typically structure content? e.g. Always open with a hook, use short paragraphs, end with a question..."
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none resize-none"
                  />
                </div>
              </>
            )}

            {/* Step 3: Style Examples */}
            {activeSection === 2 && (
              <>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    <FileText size={14} className="inline mr-1.5 text-gray-400" />
                    Paste Sample Text
                  </label>
                  <p className="text-xs text-gray-400 mb-2">Add text snippets that capture the desired writing style</p>
                  <div className="flex gap-2">
                    <textarea
                      value={sampleInput}
                      onChange={(e) => setSampleInput(e.target.value)}
                      rows={3}
                      placeholder="Paste a sample of the writing style you want..."
                      className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none resize-none"
                    />
                  </div>
                  <button type="button" onClick={addSample} disabled={!sampleInput.trim()} className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40 transition-colors">
                    Add Sample
                  </button>
                  {styleSamples.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {styleSamples.map((s, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <p className="flex-1 text-xs text-gray-600 line-clamp-3">{s}</p>
                          <button type="button" onClick={() => setStyleSamples(styleSamples.filter((_, j) => j !== i))} className="shrink-0 text-gray-300 hover:text-red-500">
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    <Globe size={14} className="inline mr-1.5 text-gray-400" />
                    Reference Posts from Accounts
                  </label>
                  <p className="text-xs text-gray-400 mb-2">Select posts that exemplify the desired style</p>
                  {connectedAccounts.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No connected accounts with posts available.</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200 p-3">
                      {connectedAccounts.flatMap((acct) => {
                        const posts = (acct.imported_posts as Array<Record<string, unknown>>) ?? []
                        const handle = acct.handle as string
                        const platform = acct.platform as string
                        return posts.slice(0, 10).map((post, pi) => {
                          const postId = `${acct.id}:${pi}`
                          const text = (post.text as string) ?? (post.content as string) ?? ''
                          const selected = refPostIds.includes(postId)
                          return (
              <button
                              key={postId}
                type="button"
                              onClick={() => toggleRefPost(postId)}
                              className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                                selected ? 'bg-amber-50 border border-amber-200' : 'hover:bg-gray-50 border border-transparent'
                              }`}
                            >
                              <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-amber-500 bg-amber-500' : 'border-gray-300'}`}>
                                {selected && <Check size={10} className="text-white" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="text-[10px] text-gray-400">@{handle} · {platform}</span>
                                <p className="text-xs text-gray-600 line-clamp-2">{text}</p>
                              </div>
              </button>
                          )
                        })
                      })}
            </div>
                  )}
                  {refPostIds.length > 0 && (
                    <p className="mt-1.5 text-xs text-amber-600">{refPostIds.length} post{refPostIds.length !== 1 ? 's' : ''} selected</p>
                  )}
                </div>
              </>
            )}

            {/* Step 4: Platform Rules */}
            {activeSection === 3 && (
              <>
                <p className="text-sm text-gray-500">Define how this persona should adapt its writing for each platform.</p>
                <div className="space-y-4">
                  {PLATFORM_KEYS.map((platform) => (
                    <div key={platform} className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50 border border-gray-200 mt-1">
                        <PlatformIcon platform={platform} size={18} />
                      </div>
                      <div className="flex-1">
                        <label className="mb-1 block text-xs font-medium text-gray-500">{PLATFORM_LABELS[platform]}</label>
                        <textarea
                          value={platformBehavior[platform] ?? ''}
                          onChange={(e) => setPlatformBehavior({ ...platformBehavior, [platform]: e.target.value })}
                          rows={2}
                          placeholder={`How should this persona write on ${PLATFORM_LABELS[platform]}?`}
                          className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none resize-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Step 5: Activities */}
            {activeSection === 4 && (
              <>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    <Zap size={14} className="inline mr-1.5 text-gray-400" />
                    Research Activities
                  </label>
                  <p className="text-xs text-gray-400 mb-3">What does this persona look at while writing? These inform how content is researched and can be overridden per-workflow.</p>
                  <div className="space-y-2">
                    {ACTIVITY_PRESETS.map((act) => {
                      const selected = selectedActivities.includes(act.key)
                      return (
                    <button
                          key={act.key}
                      type="button"
                          onClick={() => toggleActivity(act.key)}
                          className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors border ${
                            selected ? 'bg-amber-50 border-amber-200' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? 'border-amber-500 bg-amber-500' : 'border-gray-300'}`}>
                            {selected && <Check size={12} className="text-white" />}
                          </div>
                          <div>
                            <span className="text-sm font-medium text-gray-900">{act.label}</span>
                            <p className="text-xs text-gray-400">{act.description}</p>
                          </div>
                    </button>
                      )
                    })}
                  </div>
          </div>
              </>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-8 py-5">
          <button
            type="button"
            onClick={() => setActiveSection(Math.max(0, activeSection - 1))}
            disabled={activeSection === 0}
            className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Back
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">Step {activeSection + 1} of {sections.length}</span>
            {activeSection < sections.length - 1 ? (
              <button
                type="button"
                onClick={() => setActiveSection(activeSection + 1)}
                className="rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
              >
                Continue
              </button>
            ) : (
          <button
            type="button"
            disabled={!name.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
                className="rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
                {mutation.isPending ? 'Creating...' : 'Create Writing Persona'}
          </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PersonaVersionHistory({ personaId, onRestore }: { personaId: string; onRestore: () => void }) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [previewVersion, setPreviewVersion] = useState<Version | null>(null)

  const { data: versions = [] } = useQuery({
    queryKey: ['versions', 'personas', personaId],
    queryFn: () => listVersions('personas', personaId),
    enabled: expanded,
  })

  const restoreMut = useMutation({
    mutationFn: (version: number) => restoreVersion('personas', personaId, version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] })
      queryClient.invalidateQueries({ queryKey: ['versions', 'personas', personaId] })
      setPreviewVersion(null)
      onRestore()
    },
  })

  function formatDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-200">
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
            <p className="text-xs text-gray-400 text-center py-2">No previous versions yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {versions.map((v) => (
                <div key={v.id} className={`flex items-center justify-between rounded-lg px-3 py-2 transition-colors ${previewVersion?.id === v.id ? 'bg-green-50 border border-green-200' : 'bg-gray-50 hover:bg-gray-100'}`}>
                  <div>
                    <span className="text-sm font-medium text-gray-700">v{v.version}</span>
                    {v.snapshot.name ? <span className="ml-2 text-xs text-gray-400">{String(v.snapshot.name)}</span> : null}
                    <p className="text-xs text-gray-400">{v.created_at ? formatDate(v.created_at) : ''}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewVersion(previewVersion?.id === v.id ? null : v)}
                      className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-white transition-colors"
                    >
                      {previewVersion?.id === v.id ? 'Hide' : 'Preview'}
                    </button>
                    <button
                      type="button"
                      onClick={() => restoreMut.mutate(v.version)}
                      disabled={restoreMut.isPending}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-green-600 hover:bg-green-50 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={10} /> Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {previewVersion && (
            <div className="mt-3 rounded-lg border border-green-100 bg-green-50/50 p-3">
              <p className="text-xs font-medium text-green-600 mb-2">Preview — v{previewVersion.version}</p>
              <div className="space-y-1.5 text-xs text-gray-600 max-h-32 overflow-y-auto">
                {previewVersion.snapshot.name ? <p><span className="font-medium">Name:</span> {String(previewVersion.snapshot.name)}</p> : null}
                {previewVersion.snapshot.description ? <p><span className="font-medium">Description:</span> {String(previewVersion.snapshot.description).slice(0, 150)}...</p> : null}
                {previewVersion.snapshot.interests && (previewVersion.snapshot.interests as string[]).length > 0 ? (
                  <p><span className="font-medium">Interests:</span> {(previewVersion.snapshot.interests as string[]).join(', ')}</p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EditPersonaModal({ persona, onClose }: { persona: Persona; onClose: () => void }) {
  const queryClient = useQueryClient()
  const id = persona.id as string
  const isAgent = (persona.persona_type as string) === 'agent'

  const [name, setName] = useState((persona.name as string) ?? '')
  const [description, setDescription] = useState((persona.description as string) ?? '')

  // Audience fields
  const initDemo = (persona.demographics as Record<string, unknown>) ?? {}
  const [ageRange, setAgeRange] = useState(String(initDemo.age_range ?? ''))
  const [seniorityLevel, setSeniorityLevel] = useState(String(initDemo.seniority_level ?? ''))
  const [companySize, setCompanySize] = useState(String(initDemo.company_size ?? ''))
  const [industries, setIndustries] = useState<string[]>((initDemo.industries as string[]) ?? [])
  const [interests, setInterests] = useState<string[]>((persona.interests as string[]) ?? [])
  const initPrefs = (persona.content_preferences as Record<string, unknown>) ?? {}
  const [selectedFormats, setSelectedFormats] = useState<string[]>((initPrefs.format as string[]) ?? [])
  const [contentLength, setContentLength] = useState<string>(String(initPrefs.length ?? 'medium'))
  const [contentTone, setContentTone] = useState<string>(String(initPrefs.tone ?? 'professional'))
  const initGoals = (persona.goals_and_triggers as Record<string, unknown>) ?? {}
  const [goals, setGoals] = useState<string[]>((initGoals.goals as string[]) ?? [])
  const [painPoints, setPainPoints] = useState<string[]>((initGoals.pain_points as string[]) ?? [])
  const [triggers, setTriggers] = useState<string[]>((initGoals.triggers as string[]) ?? [])
  const [tagsPositive, setTagsPositive] = useState<string[]>((persona.tags_positive as string[]) ?? [])
  const [tagsNegative, setTagsNegative] = useState<string[]>((persona.tags_negative as string[]) ?? [])

  // Writing persona fields
  const [writingApproach, setWritingApproach] = useState((persona.writing_approach as string) ?? '')
  const [structureGuidance, setStructureGuidance] = useState((persona.structure_preference as string) ?? '')
  const initTone = (persona.tone as Record<string, number>) ?? { formality: 50, confidence: 50, warmth: 50 }
  const [toneSliders, setToneSliders] = useState(initTone)
  const [toneLabels, setToneLabels] = useState<Record<string, string>>({})
  const initPlatformBehavior = (persona.platform_behavior as Record<string, string>) ?? {}
  const [platformBehavior, setPlatformBehavior] = useState(initPlatformBehavior)
  const [selectedActivities, setSelectedActivities] = useState<string[]>(migrateActivities((persona.enabled_tools as string[]) ?? []))
  const initStyleExamples = (persona.per_platform_config as Record<string, unknown>) ?? {}
  const [styleSamples, setStyleSamples] = useState<string[]>((initStyleExamples.samples as string[]) ?? [])
  const [sampleInput, setSampleInput] = useState('')
  const [refPostIds, setRefPostIds] = useState<string[]>((initStyleExamples.reference_post_ids as string[]) ?? [])

  const { data: editAccounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: listAccounts,
    enabled: isAgent,
  })
  const editConnectedAccounts = editAccounts.filter((a) => (a.status as string) === 'connected')

  const [activeSection, setActiveSection] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const audienceSections = ['Basics', 'Demographics', 'Interests & Content', 'Goals & Triggers', 'Tags']
  const writerSections = ['Identity', 'Voice & Tone', 'Style Examples', 'Platform Rules', 'Research']
  const sections = isAgent ? writerSections : audienceSections

  function toggleActivity(key: string) {
    setSelectedActivities((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    )
  }

  function addSample() {
    const t = sampleInput.trim()
    if (t) { setStyleSamples([...styleSamples, t]); setSampleInput('') }
  }

  function toggleRefPost(postId: string) {
    setRefPostIds((prev) => prev.includes(postId) ? prev.filter((x) => x !== postId) : [...prev, postId])
  }

  const updateMut = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
      }
      if (isAgent) {
        const remappedTone: Record<string, number> = {}
        for (const [key, val] of Object.entries(toneSliders)) {
          const newLabel = toneLabels[key]
          if (newLabel && newLabel !== (TONE_DIMENSION_PRESETS[key] ?? key)) {
            remappedTone[newLabel.toLowerCase().replace(/\s+/g, '_')] = val
          } else { remappedTone[key] = val }
        }
        payload.writing_approach = writingApproach.trim()
        payload.structure_preference = structureGuidance.trim()
        payload.tone = remappedTone
        payload.platform_behavior = platformBehavior
        payload.enabled_tools = selectedActivities
        payload.per_platform_config = { samples: styleSamples, reference_post_ids: refPostIds }
      } else {
        payload.demographics = { age_range: ageRange, seniority_level: seniorityLevel, company_size: companySize, industries }
        payload.interests = interests
        payload.content_preferences = { format: selectedFormats, length: contentLength, tone: contentTone }
        payload.goals_and_triggers = { goals, pain_points: painPoints, triggers }
        payload.tags_positive = tagsPositive
        payload.tags_negative = tagsNegative
      }
      return updatePersona(id, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] })
      onClose()
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => deletePersona(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] })
      onClose()
    },
  })

  function toggleFormat(f: string) {
    setSelectedFormats((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-8 pt-7 pb-2">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Edit Persona</h3>
            <p className="text-sm text-gray-400 mt-0.5">{name || 'Untitled'} &middot; {isAgent ? 'Writing' : 'Audience'}</p>
          </div>
          <div className="flex items-center gap-2">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-xl p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                title="Delete persona"
              >
                <Trash2 size={18} />
              </button>
            ) : (
              <div className="flex items-center gap-2 mr-2">
                <span className="text-sm text-red-600 font-medium">Delete this persona?</span>
                <button
                  type="button"
                  onClick={() => deleteMut.mutate()}
                  disabled={deleteMut.isPending}
                  className="rounded-lg bg-red-500 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
          </button>
        </div>
            )}
            <button type="button" onClick={onClose} className="rounded-xl p-2 hover:bg-gray-100 transition-colors">
              <X size={20} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* Step nav */}
        <div className="px-8 pt-4 pb-2">
          <div className="flex items-center gap-1">
            {sections.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setActiveSection(i)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                  activeSection === i
                    ? isAgent ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-green-50 text-green-700 ring-1 ring-green-200'
                    : i < activeSection
                    ? isAgent ? 'text-amber-600 hover:bg-amber-50/50' : 'text-green-600 hover:bg-green-50/50'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  activeSection === i
                    ? isAgent ? 'bg-amber-600 text-white' : 'bg-green-600 text-white'
                    : i < activeSection
                    ? isAgent ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-400'
                }`}>
                  {i < activeSection ? '✓' : i + 1}
                </span>
                <span className="hidden sm:inline">{s}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="flex flex-col gap-5">
            {/* Basics — shared */}
            {activeSection === 0 && (
              <>
          <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
                    className={`w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:outline-none ${isAgent ? 'focus:border-amber-400 focus:ring-amber-100' : 'focus:border-green-400 focus:ring-green-100'}`}
            />
          </div>
          <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    className={`w-full rounded-xl border border-gray-300 px-4 py-3 text-sm resize-none focus:ring-2 focus:outline-none ${isAgent ? 'focus:border-amber-400 focus:ring-amber-100' : 'focus:border-green-400 focus:ring-green-100'}`}
            />
          </div>
              </>
            )}

          {/* Writing: Identity extras (approach) */}
          {isAgent && activeSection === 0 && (
          <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Writing Approach</label>
              <textarea
              value={writingApproach}
              onChange={(e) => setWritingApproach(e.target.value)}
                rows={3}
                placeholder="e.g. Writes from firsthand founder experience, uses real numbers..."
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none resize-none"
              />
          </div>
          )}

          {/* Writing: Voice & Tone */}
          {isAgent && activeSection === 1 && (
            <>
          <div>
                <label className="mb-3 block text-sm font-medium text-gray-700">Tone Dimensions</label>
                <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                  {Object.keys(toneSliders).length > 0 && (
            <div className="space-y-3">
              {Object.entries(toneSliders).map(([key, val]) => (
                <div key={key} className="flex items-center gap-3">
                  <input
                            value={toneLabels[key] ?? (TONE_DIMENSION_PRESETS[key] ?? key)}
                            onChange={(e) => setToneLabels({ ...toneLabels, [key]: e.target.value })}
                            className="w-36 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 focus:border-amber-400 focus:ring-1 focus:ring-amber-100 focus:outline-none"
                          />
                          <input type="range" min={0} max={100} value={val} onChange={(e) => setToneSliders({ ...toneSliders, [key]: Number(e.target.value) })} className="flex-1 accent-amber-500" />
                          <span className="w-10 text-right text-xs font-semibold text-gray-500">{val}</span>
                          <button type="button" onClick={() => {
                            const next = { ...toneSliders }; delete next[key]
                            const nextL = { ...toneLabels }; delete nextL[key]
                            setToneSliders(next); setToneLabels(nextL)
                          }} className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors">
                            <X size={14} />
                          </button>
                </div>
              ))}
                    </div>
                  )}
                  {(() => {
                    const usedKeys = new Set(Object.keys(toneSliders))
                    const available = Object.entries(TONE_DIMENSION_PRESETS).filter(([k]) => !usedKeys.has(k))
                    return (
                      <div className={`flex items-center gap-2 ${Object.keys(toneSliders).length > 0 ? 'mt-4 pt-4 border-t border-gray-200' : ''}`}>
                        <select id="edit-tone-select" defaultValue="" className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none bg-white">
                          <option value="" disabled>Add a tone dimension...</option>
                          {available.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                          <option value="__custom">Custom dimension...</option>
                        </select>
                        <button type="button" onClick={() => {
                          const sel = document.getElementById('edit-tone-select') as HTMLSelectElement
                          const v = sel.value; if (!v) return
                          if (v === '__custom') {
                            const custom = prompt('Enter custom dimension name:')
                            if (custom) { const key = custom.toLowerCase().replace(/\s+/g, '_'); if (!toneSliders[key]) setToneSliders({ ...toneSliders, [key]: 50 }) }
                          } else if (!toneSliders[v]) { setToneSliders({ ...toneSliders, [v]: 50 }) }
                          sel.value = ''
                        }} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-600 transition-colors">
                          <Plus size={16} />
                        </button>
                      </div>
                    )
                  })()}
            </div>
          </div>
          <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Structure Guidance</label>
                <textarea
                  value={structureGuidance}
                  onChange={(e) => setStructureGuidance(e.target.value)}
                  rows={3}
                  placeholder="How should this persona typically structure content?"
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none resize-none"
                />
              </div>
            </>
          )}

          {/* Writing: Style Examples */}
          {isAgent && activeSection === 2 && (
            <>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Paste Sample Text</label>
                <div className="flex gap-2">
                  <textarea value={sampleInput} onChange={(e) => setSampleInput(e.target.value)} rows={3} placeholder="Paste a sample of the writing style..."
                    className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none resize-none" />
                </div>
                <button type="button" onClick={addSample} disabled={!sampleInput.trim()} className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40 transition-colors">Add Sample</button>
                {styleSamples.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {styleSamples.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <p className="flex-1 text-xs text-gray-600 line-clamp-3">{s}</p>
                        <button type="button" onClick={() => setStyleSamples(styleSamples.filter((_, j) => j !== i))} className="shrink-0 text-gray-300 hover:text-red-500"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Reference Posts</label>
                {editConnectedAccounts.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No connected accounts.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200 p-3">
                    {editConnectedAccounts.flatMap((acct) => {
                      const posts = (acct.imported_posts as Array<Record<string, unknown>>) ?? []
                      return posts.slice(0, 10).map((post, pi) => {
                        const postId = `${acct.id}:${pi}`
                        const text = (post.text as string) ?? (post.content as string) ?? ''
                        const selected = refPostIds.includes(postId)
                        return (
                          <button key={postId} type="button" onClick={() => toggleRefPost(postId)}
                            className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors ${selected ? 'bg-amber-50 border border-amber-200' : 'hover:bg-gray-50 border border-transparent'}`}>
                            <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-amber-500 bg-amber-500' : 'border-gray-300'}`}>
                              {selected && <Check size={10} className="text-white" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-[10px] text-gray-400">@{acct.handle as string} · {acct.platform as string}</span>
                              <p className="text-xs text-gray-600 line-clamp-2">{text}</p>
                            </div>
                          </button>
                        )
                      })
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Writing: Platform Rules */}
          {isAgent && activeSection === 3 && (
            <div className="space-y-4">
              {PLATFORM_KEYS.map((platform) => (
                <div key={platform} className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50 border border-gray-200 mt-1">
                    <PlatformIcon platform={platform} size={18} />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-medium text-gray-500">{PLATFORM_LABELS[platform]}</label>
                    <textarea
                      value={platformBehavior[platform] ?? ''}
                      onChange={(e) => setPlatformBehavior({ ...platformBehavior, [platform]: e.target.value })}
                      rows={2}
                      placeholder={`Writing rules for ${PLATFORM_LABELS[platform]}...`}
                      className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none resize-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Writing: Activities */}
          {isAgent && activeSection === 4 && (
            <>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Research Activities</label>
                <p className="text-xs text-gray-400 mb-3">What does this persona look at while writing? These inform how content is researched and can be overridden per-workflow.</p>
                <div className="space-y-2">
                  {ACTIVITY_PRESETS.map((act) => {
                    const selected = selectedActivities.includes(act.key)
                    return (
                      <button key={act.key} type="button" onClick={() => toggleActivity(act.key)}
                        className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors border ${selected ? 'bg-amber-50 border-amber-200' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
                        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? 'border-amber-500 bg-amber-500' : 'border-gray-300'}`}>
                          {selected && <Check size={12} className="text-white" />}
                        </div>
                        <div>
                          <span className="text-sm font-medium text-gray-900">{act.label}</span>
                          <p className="text-xs text-gray-400">{act.description}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {/* Audience: Demographics */}
          {!isAgent && activeSection === 1 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Age Range</label>
                  <input value={ageRange} onChange={(e) => setAgeRange(e.target.value)} placeholder="e.g. 25-40" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Seniority</label>
                  <input value={seniorityLevel} onChange={(e) => setSeniorityLevel(e.target.value)} placeholder="e.g. Mid-Level" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Company Size</label>
                <input value={companySize} onChange={(e) => setCompanySize(e.target.value)} placeholder="e.g. 10-50" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none" />
              </div>
              <TagInput label="Industries" tags={industries} onAdd={(t) => setIndustries([...industries, t])} onRemove={(t) => setIndustries(industries.filter((x) => x !== t))} placeholder="e.g. SaaS, FinTech" />
            </>
          )}

          {/* Audience: Interests & Content */}
          {!isAgent && activeSection === 2 && (
            <>
              <TagInput label="Interests" tags={interests} onAdd={(t) => setInterests([...interests, t])} onRemove={(t) => setInterests(interests.filter((x) => x !== t))} placeholder="e.g. AI, growth hacking" />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Preferred Formats</label>
                <div className="flex flex-wrap gap-2">
                  {FORMAT_OPTIONS.map((f) => (
                    <button key={f} type="button" onClick={() => toggleFormat(f)} className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${selectedFormats.includes(f) ? 'bg-green-50 border-green-300 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      {selectedFormats.includes(f) && <Check size={10} className="inline mr-1" />}{f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Content Length</label>
                  <select value={contentLength} onChange={(e) => setContentLength(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none">
                    {LENGTH_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Content Tone</label>
                  <select value={contentTone} onChange={(e) => setContentTone(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:outline-none">
                    {TONE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Audience: Goals & Triggers */}
          {!isAgent && activeSection === 3 && (
            <>
              <TagInput label="Goals" tags={goals} onAdd={(t) => setGoals([...goals, t])} onRemove={(t) => setGoals(goals.filter((x) => x !== t))} placeholder="e.g. Scale their startup" />
              <TagInput label="Pain Points" tags={painPoints} onAdd={(t) => setPainPoints([...painPoints, t])} onRemove={(t) => setPainPoints(painPoints.filter((x) => x !== t))} placeholder="e.g. Limited budget" color="red" />
              <TagInput label="Engagement Triggers" tags={triggers} onAdd={(t) => setTriggers([...triggers, t])} onRemove={(t) => setTriggers(triggers.filter((x) => x !== t))} placeholder="e.g. Contrarian takes" />
            </>
          )}

          {/* Audience: Tags */}
          {!isAgent && activeSection === 4 && (
            <>
              <TagInput label="Positive Tags" tags={tagsPositive} onAdd={(t) => setTagsPositive([...tagsPositive, t])} onRemove={(t) => setTagsPositive(tagsPositive.filter((x) => x !== t))} placeholder="e.g. founder stories" />
              <TagInput label="Negative Tags" tags={tagsNegative} onAdd={(t) => setTagsNegative([...tagsNegative, t])} onRemove={(t) => setTagsNegative(tagsNegative.filter((x) => x !== t))} placeholder="e.g. clickbait" color="red" />
            </>
          )}

          </div>

          {/* Version History */}
          <PersonaVersionHistory personaId={id} onRestore={() => { queryClient.invalidateQueries({ queryKey: ['personas'] }); onClose() }} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-8 py-5">
          <button
            type="button"
            onClick={() => setActiveSection(Math.max(0, activeSection - 1))}
            disabled={activeSection === 0}
            className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Back
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">Step {activeSection + 1} of {sections.length}</span>
            {activeSection < sections.length - 1 ? (
              <button
                type="button"
                onClick={() => setActiveSection(activeSection + 1)}
                className="rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                disabled={!name.trim() || updateMut.isPending}
                onClick={() => updateMut.mutate()}
                className={`rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isAgent ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-500 hover:bg-green-600'}`}
              >
                {updateMut.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Personas() {
  const [showAudienceCreate, setShowAudienceCreate] = useState(false)
  const [showAgentCreate, setShowAgentCreate] = useState(false)
  const [showDiscover, setShowDiscover] = useState(false)
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null)

  const { data: personas = [], isLoading } = useQuery({
    queryKey: ['personas'],
    queryFn: listPersonas,
  })

  const audiencePersonas = personas.filter(
    (p) => (p.persona_type as string) === 'audience',
  )
  const agentPersonas = personas.filter(
    (p) => (p.persona_type as string) === 'agent',
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Audience Personas */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Audience Personas</h2>
            <p className="text-sm text-gray-500">
              Target audience segments for content optimization
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDiscover(true)}
              className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 shadow-sm transition-colors hover:bg-violet-100"
            >
              <Sparkles size={16} /> Discover
            </button>
          <button
            type="button"
            onClick={() => setShowAudienceCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-600"
          >
            <Plus size={16} /> Audience
          </button>
          </div>
        </div>
        {audiencePersonas.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-12">
            <Users size={32} className="mb-2 text-gray-300" />
            <p className="text-sm text-gray-500">No audience personas yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Create manually or use AI to discover from your accounts
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {audiencePersonas.map((p, i) => (
              <PersonaCard key={(p.id as string) ?? i} persona={p} onEdit={setEditingPersona} />
            ))}
          </div>
        )}
      </section>

      {/* Writing Personas */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Writing Personas</h2>
            <p className="text-sm text-gray-500">
              AI writers with distinct voices, styles, and workflow capabilities
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAgentCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600"
          >
            <Plus size={16} /> Writing
          </button>
        </div>
        {agentPersonas.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-12">
            <PenTool size={32} className="mb-2 text-gray-300" />
            <p className="text-sm text-gray-500">No writing personas yet</p>
            <p className="text-xs text-gray-400 mt-1">Create a writing persona to define your AI writer's voice and activities</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {agentPersonas.map((p, i) => (
              <PersonaCard key={(p.id as string) ?? i} persona={p} onEdit={setEditingPersona} />
            ))}
          </div>
        )}
      </section>

      {showAudienceCreate && (
        <CreateAudienceModal onClose={() => setShowAudienceCreate(false)} />
      )}
      {showAgentCreate && (
        <CreateWritingModal onClose={() => setShowAgentCreate(false)} />
      )}
      {showDiscover && <DiscoverModal onClose={() => setShowDiscover(false)} />}
      {editingPersona && (
        <EditPersonaModal
          persona={editingPersona}
          onClose={() => setEditingPersona(null)}
        />
      )}
    </div>
  )
}
