import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  TrendingUp,
  Zap,
  LayoutGrid,
  Clock,
  Eye,
  Image as ImageIcon,
  Users,
  X,
  ArrowUpRight,
  BarChart3,
} from 'lucide-react'
import { listAccounts } from '../../lib/api'

type AccountRecord = {
  id: string
  platform: string
  handle: string
  inferences: {
    top_formats?: string[]
    best_times?: string[]
    hook_performance?: string[]
    audience_signals?: string[]
    summary?: string
    visual_content_insights?: {
      dominant_visual_style?: string
      top_content_types?: string[]
      visual_themes?: string[]
      brand_consistency_score?: string
      visual_vs_text_performance?: string
      recommendations?: string[]
    }
  } | null
  imported_posts?: Array<{
    type?: string
    media_analysis?: {
      visual_descriptions?: string[]
      content_types?: string[]
      visual_themes?: string[]
      mood?: string
    }
    engagement?: { total?: number }
  }>
  post_count: number
}

type InsightCard = {
  id: string
  title: string
  headline: string
  icon: typeof TrendingUp
  iconBg: string
  iconColor: string
  items: string[]
  detail?: string
}

function InsightDetailModal({
  card,
  onClose,
}: {
  card: InsightCard
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.iconBg}`}>
              <card.icon size={18} className={card.iconColor} />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">{card.title}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100">
            <X size={18} className="text-gray-400" />
          </button>
        </div>
        {card.detail && (
          <p className="mb-4 text-sm text-gray-600 leading-relaxed">{card.detail}</p>
        )}
        <div className="space-y-2">
          {card.items.map((item, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 rounded-lg px-4 py-3 ${
                i === 0 ? 'bg-indigo-50 border border-indigo-200' : 'bg-gray-50'
              }`}
            >
              {i === 0 && <ArrowUpRight size={14} className="text-indigo-500 mt-0.5 shrink-0" />}
              <span className="text-sm text-gray-700">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function Insights() {
  const [expandedCard, setExpandedCard] = useState<InsightCard | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<string>('all')

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: listAccounts,
    select: (data) => data as unknown as AccountRecord[],
  })

  const accountsWithData = accounts.filter(
    (a) => a.inferences && Object.keys(a.inferences).length > 0,
  )

  const filtered =
    selectedAccount === 'all'
      ? accountsWithData
      : accountsWithData.filter((a) => a.id === selectedAccount)

  const cards: InsightCard[] = []

  // Aggregate insights across selected accounts
  const allFormats: string[] = []
  const allTimes: string[] = []
  const allHooks: string[] = []
  const allAudience: string[] = []
  const allSummaries: string[] = []
  const allVisualStyles: string[] = []
  const allVisualTypes: string[] = []
  const allVisualThemes: string[] = []
  const allVisualRecs: string[] = []
  let brandConsistency = ''
  let visualVsText = ''

  for (const acct of filtered) {
    const inf = acct.inferences
    if (!inf) continue
    const tag = filtered.length > 1 ? ` [${acct.platform}/${acct.handle}]` : ''
    allFormats.push(...(inf.top_formats ?? []).map((s) => s + tag))
    allTimes.push(...(inf.best_times ?? []).map((s) => s + tag))
    allHooks.push(...(inf.hook_performance ?? []).map((s) => s + tag))
    allAudience.push(...(inf.audience_signals ?? []).map((s) => s + tag))
    if (inf.summary) allSummaries.push(inf.summary)

    const vis = inf.visual_content_insights
    if (vis) {
      if (vis.dominant_visual_style) allVisualStyles.push(vis.dominant_visual_style + tag)
      allVisualTypes.push(...(vis.top_content_types ?? []).map((s) => s + tag))
      allVisualThemes.push(...(vis.visual_themes ?? []).map((s) => s + tag))
      allVisualRecs.push(...(vis.recommendations ?? []).map((s) => s + tag))
      if (vis.brand_consistency_score) brandConsistency = vis.brand_consistency_score
      if (vis.visual_vs_text_performance) visualVsText = vis.visual_vs_text_performance
    }
  }

  if (allFormats.length > 0)
    cards.push({
      id: 'formats',
      title: 'Top Formats',
      headline: allFormats[0]?.split('(')[0]?.trim() ?? 'Format analysis',
      icon: LayoutGrid,
      iconBg: 'bg-purple-50',
      iconColor: 'text-purple-500',
      items: allFormats,
    })

  if (allHooks.length > 0)
    cards.push({
      id: 'hooks',
      title: 'Hook Performance',
      headline: allHooks[0]?.split(':')[0]?.trim() ?? 'Hook analysis',
      icon: Zap,
      iconBg: 'bg-yellow-50',
      iconColor: 'text-yellow-500',
      items: allHooks,
    })

  if (allTimes.length > 0)
    cards.push({
      id: 'timing',
      title: 'Best Posting Times',
      headline: allTimes[0]?.split('(')[0]?.trim() ?? 'Timing analysis',
      icon: Clock,
      iconBg: 'bg-blue-50',
      iconColor: 'text-blue-500',
      items: allTimes,
    })

  if (allAudience.length > 0)
    cards.push({
      id: 'audience',
      title: 'Audience Signals',
      headline: allAudience[0]?.split('(')[0]?.trim() ?? 'Audience insights',
      icon: Users,
      iconBg: 'bg-green-50',
      iconColor: 'text-green-500',
      items: allAudience,
    })

  if (allVisualTypes.length > 0 || allVisualStyles.length > 0)
    cards.push({
      id: 'visual-types',
      title: 'Visual Content Analysis',
      headline: allVisualStyles[0]?.split('[')[0]?.trim() ?? 'Visual style analysis',
      icon: ImageIcon,
      iconBg: 'bg-pink-50',
      iconColor: 'text-pink-500',
      items: [...allVisualStyles, ...allVisualTypes],
      detail: visualVsText || undefined,
    })

  if (allVisualThemes.length > 0 || brandConsistency)
    cards.push({
      id: 'visual-brand',
      title: 'Brand & Visual Themes',
      headline: brandConsistency
        ? `Brand consistency: ${brandConsistency.split('—')[0]?.trim()}`
        : 'Visual theme analysis',
      icon: Eye,
      iconBg: 'bg-orange-50',
      iconColor: 'text-orange-500',
      items: [
        ...(brandConsistency ? [`Brand consistency: ${brandConsistency}`] : []),
        ...allVisualThemes,
      ],
    })

  if (allVisualRecs.length > 0)
    cards.push({
      id: 'visual-recs',
      title: 'Visual Recommendations',
      headline: allVisualRecs[0]?.split('[')[0]?.trim() ?? 'Content recommendations',
      icon: TrendingUp,
      iconBg: 'bg-indigo-50',
      iconColor: 'text-indigo-500',
      items: allVisualRecs,
    })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Content Insights</h2>
          <p className="text-sm text-gray-500">
            AI-powered performance and visual content analysis from imported accounts
          </p>
        </div>
        {accountsWithData.length > 1 && (
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All accounts ({accountsWithData.length})</option>
            {accountsWithData.map((a) => (
              <option key={a.id} value={a.id}>
                {a.platform}/{a.handle}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Summary banner */}
      {allSummaries.length > 0 && (
        <div className="mb-6 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-purple-50 p-5">
          <div className="flex items-start gap-3">
            <BarChart3 size={20} className="text-indigo-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-indigo-900 mb-1">Intelligence Summary</h3>
              {allSummaries.map((s, i) => (
                <p key={i} className="text-sm text-indigo-700 leading-relaxed">
                  {s}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
            <BarChart3 size={28} className="text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">No insights yet</h3>
          <p className="mt-1 max-w-md text-sm text-gray-500">
            Import social accounts in the Accounts tab to generate AI-powered content and visual
            insights.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => setExpandedCard(card)}
              className="group flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:shadow-md hover:border-indigo-200"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.iconBg}`}
                >
                  <card.icon size={20} className={card.iconColor} />
                </div>
                <h3 className="font-semibold text-gray-900">{card.title}</h3>
              </div>
              <p className="text-sm text-gray-600 line-clamp-2">{card.headline}</p>
              <div className="mt-auto flex items-center justify-between">
                <span className="text-xs text-gray-400">{card.items.length} insights</span>
                <span className="text-xs font-medium text-indigo-500 opacity-0 transition-opacity group-hover:opacity-100">
                  Click to explore →
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {expandedCard && (
        <InsightDetailModal card={expandedCard} onClose={() => setExpandedCard(null)} />
      )}
    </div>
  )
}
