import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Shield, X, ChevronLeft, ToggleLeft, ToggleRight } from 'lucide-react'
import { listRuleSets, createRuleSet } from '../../lib/api'

type RuleSet = Record<string, unknown>

const PLATFORMS = ['LinkedIn', 'X (Twitter)', 'Instagram', 'TikTok', 'All'] as const

const RULE_TYPES = [
  { type: 'Platform', color: 'bg-blue-500' },
  { type: 'Learned', color: 'bg-green-500' },
  { type: 'Custom', color: 'bg-amber-500' },
  { type: 'Compliance', color: 'bg-red-500' },
] as const

const MOCK_RULES = [
  { name: 'Use first person only', type: 'Platform' as const, enabled: true },
  { name: 'No hashtag stacking', type: 'Platform' as const, enabled: true },
  { name: 'Hook in first 2 lines', type: 'Learned' as const, enabled: true },
  { name: 'Include CTA at end', type: 'Custom' as const, enabled: false },
  { name: 'No medical claims', type: 'Compliance' as const, enabled: true },
  { name: 'Avoid competitor mentions', type: 'Compliance' as const, enabled: true },
  { name: 'Use data in assertions', type: 'Learned' as const, enabled: false },
]

function getRuleColor(type: string) {
  return (
    RULE_TYPES.find((r) => r.type === type)?.color ?? 'bg-gray-400'
  )
}

function RuleSetCard({
  ruleSet,
  onClick,
}: {
  ruleSet: RuleSet
  onClick: () => void
}) {
  const name = (ruleSet.name as string) ?? 'Untitled'
  const rules = (ruleSet.rules as unknown[]) ?? []
  const platform = (ruleSet.default_platform as string) ?? 'All'
  const workflowUsage = (ruleSet.workflow_usage as number) ?? 0

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:shadow-md hover:border-gray-300"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100">
            <Shield size={18} className="text-gray-500" />
          </div>
          <h3 className="font-semibold text-gray-900">{name}</h3>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
          {rules.length} rules
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 font-medium">
          {platform}
        </span>
        <span>{workflowUsage} workflows</span>
      </div>
    </button>
  )
}

function CreateRuleSetModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [platform, setPlatform] = useState('All')

  const mutation = useMutation({
    mutationFn: () => createRuleSet(name.trim(), description.trim() || 'Rule set', platform),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rule-sets'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-900">New Rule Set</h3>
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
              placeholder="e.g. LinkedIn Posting Rules"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:ring-2 focus:ring-gray-100 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What is this rule set for?"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:ring-2 focus:ring-gray-100 focus:outline-none resize-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Default Platform
            </label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:ring-2 focus:ring-gray-100 focus:outline-none"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!name.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="mt-1 w-full rounded-lg bg-gray-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RuleSetDetail({ ruleSet, onBack }: { ruleSet: RuleSet; onBack: () => void }) {
  const name = (ruleSet.name as string) ?? 'Untitled'
  const [rules, setRules] = useState(MOCK_RULES)

  function toggleRule(idx: number) {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, enabled: !r.enabled } : r)))
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ChevronLeft size={16} /> Back to rule sets
      </button>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
              <Shield size={20} className="text-gray-500" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">{name}</h2>
          </div>
        </div>
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Rules</h3>
            <div className="flex items-center gap-3">
              {RULE_TYPES.map((rt) => (
                <span key={rt.type} className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className={`inline-block h-2 w-2 rounded-full ${rt.color}`} />
                  {rt.type}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            {rules.map((rule, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${getRuleColor(rule.type)}`} />
                  <span
                    className={`text-sm ${rule.enabled ? 'text-gray-700' : 'text-gray-400 line-through'}`}
                  >
                    {rule.name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleRule(i)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {rule.enabled ? (
                    <ToggleRight size={22} className="text-indigo-500" />
                  ) : (
                    <ToggleLeft size={22} />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Rules() {
  const [showCreate, setShowCreate] = useState(false)
  const [selectedRuleSet, setSelectedRuleSet] = useState<RuleSet | null>(null)

  const { data: ruleSets = [], isLoading } = useQuery({
    queryKey: ['rule-sets'],
    queryFn: listRuleSets,
  })

  if (selectedRuleSet) {
    return <RuleSetDetail ruleSet={selectedRuleSet} onBack={() => setSelectedRuleSet(null)} />
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Rule Sets</h2>
          <p className="text-sm text-gray-500">
            Manage content guardrails, compliance rules, and platform guidelines
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-900"
        >
          <Plus size={16} /> New Rule Set
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : ruleSets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-16">
          <Shield size={36} className="mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No rule sets yet</p>
          <p className="text-xs text-gray-400 mt-1">Create your first rule set to define content guardrails</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ruleSets.map((rs, i) => (
            <RuleSetCard
              key={(rs.id as string) ?? i}
              ruleSet={rs}
              onClick={() => setSelectedRuleSet(rs)}
            />
          ))}
        </div>
      )}

      {showCreate && <CreateRuleSetModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}
