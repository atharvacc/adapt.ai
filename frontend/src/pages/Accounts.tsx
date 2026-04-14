import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Plus,
  X,
  ArrowLeft,
  Calendar,
  TrendingUp,
  Activity,
  ShieldCheck,
  Zap,
  Clock,
  Eye,
  Target,
  RefreshCw,
  AlertTriangle,
  Loader2,
  KeyRound,
  ExternalLink,
  CheckCircle2,
  Globe,
  Image as ImageIcon,
  Palette,
  Users,
} from 'lucide-react'
import { createAccount, listAccounts, scrapeProfile, rescrapeAccount, syncAccount, scrapeFollowers } from '../lib/api'
import { PlatformIcon, PLATFORM_LABELS, PLATFORM_COLORS } from '../components/PlatformIcon'
import type { Platform } from '../types'

const PLATFORM_OPTIONS: Platform[] = ['linkedin', 'x', 'instagram', 'tiktok']

const PLATFORM_URL_HINTS: { platform: Platform; url: string }[] = [
  { platform: 'linkedin', url: 'https://www.linkedin.com/in/username' },
  { platform: 'linkedin', url: 'https://www.linkedin.com/company/company-name' },
  { platform: 'x', url: 'https://x.com/username' },
  { platform: 'instagram', url: 'https://www.instagram.com/username' },
  { platform: 'tiktok', url: 'https://www.tiktok.com/@username' },
]

const TOKEN_HELP: Record<Platform, { label: string; url: string; hint: string }> = {
  x: {
    label: 'X / Twitter Bearer Token',
    url: 'https://developer.x.com/en/portal/dashboard',
    hint: 'Developer Portal → Project → Keys & Tokens → Bearer Token',
  },
  linkedin: {
    label: 'LinkedIn Access Token',
    url: 'https://www.linkedin.com/developers/apps',
    hint: 'Create an app → OAuth 2.0 → Generate access token',
  },
  instagram: {
    label: 'Instagram Graph API Token',
    url: 'https://developers.facebook.com/tools/explorer/',
    hint: 'Graph API Explorer → select your IG app → generate User Token',
  },
  tiktok: {
    label: 'TikTok Access Token',
    url: 'https://developers.tiktok.com/apps/',
    hint: 'Register app → OAuth flow → get access token',
  },
}

type AccountRecord = {
  id?: string
  handle: string
  platform: Platform
  status: string
  post_count?: number
  data_health_percent?: number
  last_sync_at?: string
  profile_data?: {
    name?: string
    bio?: string
    followers?: number
    avatar_url?: string
    error?: string
    sync_error?: string
    source_url?: string
  }
  imported_posts?: Array<{
    id: string
    text: string
    date: string
    type: string
    media?: string[]
    engagement: Record<string, number>
  }>
  inferences?: {
    top_formats?: string[]
    best_times?: string[]
    hook_performance?: string[]
    audience_signals?: string[]
    summary?: string
  }
  follower_data?: {
    followers?: Array<{
      name: string
      handle: string
      headline: string
      about?: string
      profile_url: string
      industry_signals: string[]
      location?: string
      company?: string
      experience_summary?: string
    }>
    top_commenters?: Array<{
      name: string
      handle: string
      comment_count: number
    }>
    status?: string
    error?: string
    scraped_at?: string
  }
}

type DetailTab = 'overview' | 'posts' | 'followers' | 'insights'
type ConnectMode = 'browse' | 'manual'

const TYPE_COLORS: Record<string, string> = {
  carousel: 'bg-blue-100 text-blue-700',
  thread: 'bg-purple-100 text-purple-700',
  video: 'bg-rose-100 text-rose-700',
  text: 'bg-gray-100 text-gray-600',
  image: 'bg-emerald-100 text-emerald-700',
  link: 'bg-amber-100 text-amber-700',
  reel: 'bg-pink-100 text-pink-700',
  post: 'bg-blue-100 text-blue-700',
  status: 'bg-gray-100 text-gray-600',
  retweet: 'bg-cyan-100 text-cyan-700',
}

export function Accounts() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [showModal, setShowModal] = useState(false)
  const [connectMode, setConnectMode] = useState<ConnectMode>('browse')
  const [profileUrl, setProfileUrl] = useState('')
  const [handle, setHandle] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [platform, setPlatform] = useState<Platform>('x')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [selected, setSelected] = useState<AccountRecord | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [syncing, setSyncing] = useState(false)
  const [capturingFollowers, setCapturingFollowers] = useState(false)
  const [justConnected, setJustConnected] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await listAccounts()
      setAccounts(data as AccountRecord[])
    } catch {
      /* backend offline */
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const connected = searchParams.get('connected')
    if (connected) {
      setJustConnected(connected)
      refresh()
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('connected')
      newParams.delete('account_id')
      setSearchParams(newParams, { replace: true })
      setTimeout(() => setJustConnected(null), 5000)
    }
  }, [searchParams, setSearchParams, refresh])

  function detectPlatformFromUrl(url: string): Platform | null {
    if (/linkedin\.com\/(in|company)\//i.test(url)) return 'linkedin'
    if (/(x\.com|twitter\.com)\//i.test(url)) return 'x'
    if (/instagram\.com\//i.test(url)) return 'instagram'
    if (/tiktok\.com\//i.test(url)) return 'tiktok'
    return null
  }

  const detectedPlatform = detectPlatformFromUrl(profileUrl)

  async function connectViaBrowser() {
    if (!profileUrl.trim()) return
    setConnecting(true)
    setConnectError('')
    try {
      const result = await scrapeProfile(profileUrl.trim())
      const acct = result as AccountRecord
      if (acct.status === 'error') {
        setConnectError(
          acct.profile_data?.error || 'Failed to scrape profile. Check the URL and try again.'
        )
      } else {
        setProfileUrl('')
        setShowModal(false)
        setJustConnected(acct.platform)
        setTimeout(() => setJustConnected(null), 5000)
        await refresh()
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Scrape failed'
      setConnectError(msg)
    } finally {
      setConnecting(false)
    }
  }

  async function connectManual() {
    if (!handle.trim() || !apiToken.trim()) return
    setConnecting(true)
    setConnectError('')
    try {
      const result = await createAccount(handle.trim(), platform, apiToken.trim())
      const acct = result as AccountRecord
      if (acct.status === 'error') {
        setConnectError(
          acct.profile_data?.error || 'Failed to connect. Check your token and handle.'
        )
      } else {
        setHandle('')
        setApiToken('')
        setPlatform('x')
        setShowModal(false)
        await refresh()
      }
    } catch {
      setConnectError('Network error — is the backend running?')
    } finally {
      setConnecting(false)
    }
  }

  async function handleSync() {
    if (!selected?.id) return
    setSyncing(true)
    try {
      const hasSourceUrl = !!selected.profile_data?.source_url
      let updated: AccountRecord
      if (hasSourceUrl) {
        updated = (await rescrapeAccount(selected.id)) as AccountRecord
      } else {
        updated = (await syncAccount(selected.id)) as AccountRecord
      }
      setSelected(updated)
      await refresh()
    } catch {
      /* sync failed */
    } finally {
      setSyncing(false)
    }
  }

  async function handleCaptureFollowers() {
    if (!selected?.id) return
    setCapturingFollowers(true)
    try {
      const updated = (await scrapeFollowers(selected.id)) as AccountRecord
      setSelected(updated)
      await refresh()
    } catch {
      /* capture failed */
    } finally {
      setCapturingFollowers(false)
    }
  }

  // ---------- Detail view ----------
  if (selected) {
    const profile = selected.profile_data || {}
    const posts = selected.imported_posts || []
    const inferences = selected.inferences || {}
    const hasInferences = !!(
      inferences.top_formats?.length ||
      inferences.best_times?.length ||
      inferences.hook_performance?.length ||
      inferences.audience_signals?.length
    )

    const vis = (inferences as Record<string, unknown>).visual_content_insights as Record<string, unknown> | undefined
    const inferenceCards = [
      { title: 'Top Formats', icon: Zap, items: inferences.top_formats || [] },
      { title: 'Best Times', icon: Clock, items: inferences.best_times || [] },
      { title: 'Hook Performance', icon: Eye, items: inferences.hook_performance || [] },
      { title: 'Audience Signals', icon: Target, items: inferences.audience_signals || [] },
      ...(vis ? [
        { title: 'Visual Content', icon: ImageIcon, items: [
          ...(vis.dominant_visual_style ? [`Style: ${vis.dominant_visual_style}`] : []),
          ...((vis.top_content_types as string[]) ?? []),
          ...(vis.visual_vs_text_performance ? [`Visual vs text: ${vis.visual_vs_text_performance}`] : []),
        ]},
        { title: 'Visual Themes & Brand', icon: Palette, items: [
          ...(vis.brand_consistency_score ? [`Brand consistency: ${vis.brand_consistency_score}`] : []),
          ...((vis.visual_themes as string[]) ?? []),
          ...((vis.recommendations as string[]) ?? []),
        ]},
      ] : []),
    ]

    return (
      <div className="space-y-6">
        <button
          onClick={() => { setSelected(null); setDetailTab('overview') }}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={16} />
          Accounts / {selected.handle} {PLATFORM_LABELS[selected.platform]}
        </button>

        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.name || selected.handle}
              className="h-12 w-12 rounded-xl object-cover"
            />
          ) : (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${PLATFORM_COLORS[selected.platform]}15` }}
            >
              <PlatformIcon platform={selected.platform} size={24} />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-semibold text-gray-900">
                {profile.name || selected.handle}
              </h2>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                style={{
                  backgroundColor: `${PLATFORM_COLORS[selected.platform]}12`,
                  color: PLATFORM_COLORS[selected.platform],
                }}
              >
                <PlatformIcon platform={selected.platform} size={14} />
                {PLATFORM_LABELS[selected.platform]}
              </span>
            </div>
            <p className="text-sm text-gray-500">
              {selected.handle}
              {profile.followers ? ` · ${profile.followers.toLocaleString()} followers` : ''}
            </p>
            {profile.bio && (
              <p className="mt-1 max-w-xl text-xs text-gray-400 line-clamp-2">{profile.bio}</p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={handleCaptureFollowers}
              disabled={capturingFollowers || selected.status !== 'connected'}
              className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50"
            >
              <Users size={14} className={capturingFollowers ? 'animate-pulse' : ''} />
              {capturingFollowers ? 'Capturing…' : 'Capture Followers'}
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Re-sync'}
            </button>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${
              selected.status === 'connected'
                ? 'bg-emerald-50 text-emerald-700'
                : selected.status === 'syncing'
                ? 'bg-amber-50 text-amber-700'
                : selected.status === 'error'
                ? 'bg-red-50 text-red-700'
                : 'bg-gray-100 text-gray-500'
            }`}>
              {selected.status === 'connected' ? 'Connected' :
               selected.status === 'syncing' ? 'Syncing…' :
               selected.status === 'error' ? 'Error' : 'Pending'}
            </span>
          </div>
        </div>

        {(profile.error || profile.sync_error) && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-800">Connection issue</p>
              <p className="mt-0.5 text-xs text-red-600">
                {profile.sync_error || profile.error}
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-1 border-b border-gray-200">
          {(['overview', 'posts', 'followers', 'insights'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
                detailTab === tab
                  ? 'border-b-2 border-indigo-500 text-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
              {tab === 'posts' && posts.length > 0 && (
                <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                  {posts.length}
                </span>
              )}
              {tab === 'followers' && (selected.follower_data?.followers?.length ?? 0) > 0 && (
                <span className="ml-1.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
                  {selected.follower_data!.followers!.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {detailTab === 'overview' && (
          <div className="space-y-4">
            {/* Source platform banner */}
            <div
              className="flex items-center gap-4 rounded-xl border p-4"
              style={{
                borderColor: `${PLATFORM_COLORS[selected.platform]}30`,
                backgroundColor: `${PLATFORM_COLORS[selected.platform]}06`,
              }}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${PLATFORM_COLORS[selected.platform]}15` }}
              >
                <PlatformIcon platform={selected.platform} size={22} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">
                  Imported from {PLATFORM_LABELS[selected.platform]}
                </p>
                <p className="text-xs text-gray-500">
                  {selected.post_count ?? 0} posts captured · Data health {selected.data_health_percent ?? 0}%
                  {profile.source_url && (
                    <> · <a href={profile.source_url} target="_blank" rel="noreferrer" className="text-indigo-500 hover:text-indigo-600">View profile</a></>
                  )}
                </p>
              </div>
              <div className="text-right text-xs text-gray-400">
                {selected.last_sync_at
                  ? `Synced ${new Date(selected.last_sync_at).toLocaleDateString()}`
                  : 'Not synced yet'}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Total Posts', value: String(selected.post_count ?? 0), icon: Activity },
                { label: 'Followers', value: profile.followers ? profile.followers.toLocaleString() : '—', icon: TrendingUp },
                { label: 'Data Health', value: `${selected.data_health_percent ?? 0}%`, icon: ShieldCheck },
                {
                  label: 'Last Synced',
                  value: selected.last_sync_at
                    ? new Date(selected.last_sync_at).toLocaleDateString()
                    : 'Never',
                  icon: Calendar,
                },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gray-50">
                    <stat.icon size={18} className="text-gray-500" />
                  </div>
                  <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
                  <p className="mt-1 text-xs text-gray-500">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {detailTab === 'posts' && (
          posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center">
              <Activity size={24} className="mb-2 text-gray-300" />
              <p className="text-sm text-gray-500">No posts imported yet</p>
              <p className="mt-1 text-xs text-gray-400">
                {selected.status === 'error'
                  ? 'Check your API token and try re-syncing'
                  : 'Posts will appear after a successful sync'}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/60">
                  <tr>
                    <th className="px-5 py-3 font-medium text-gray-500">Date</th>
                    <th className="px-5 py-3 font-medium text-gray-500">Content</th>
                    <th className="px-5 py-3 font-medium text-gray-500">Media</th>
                    <th className="px-5 py-3 font-medium text-gray-500">Type</th>
                    <th className="px-5 py-3 font-medium text-gray-500 text-right">Engagement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {posts.map((post, i) => (
                    <tr key={post.id || i} className="hover:bg-gray-50/50 transition-colors">
                      <td className="whitespace-nowrap px-5 py-3.5 text-gray-600">
                        {post.date ? new Date(post.date).toLocaleDateString() : '—'}
                      </td>
                      <td className="max-w-md px-5 py-3.5 text-gray-800">
                        <p className="truncate">{post.text || '(no text)'}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        {post.media && post.media.length > 0 ? (
                          <div className="space-y-1">
                            <div className="flex gap-1.5">
                              {post.media.slice(0, 3).map((src: string, mi: number) => (
                                <img
                                  key={mi}
                                  src={src}
                                  alt=""
                                  className="h-10 w-10 rounded-md object-cover border border-gray-200"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                />
                              ))}
                              {post.media.length > 3 && (
                                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-gray-100 text-xs font-medium text-gray-500">
                                  +{post.media.length - 3}
                                </span>
                              )}
                            </div>
                            {'media_analysis' in post && (post as Record<string, unknown>).media_analysis ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">
                                <Eye size={9} /> Analyzed
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                          TYPE_COLORS[post.type] ?? 'bg-gray-100 text-gray-600'
                        }`}>
                          {post.type}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-medium text-gray-800">
                        {post.engagement?.total?.toLocaleString() ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {detailTab === 'insights' && (
          hasInferences ? (
            <div className="space-y-4">
              {inferences.summary && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                  <p className="text-sm text-indigo-800">{inferences.summary}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                {inferenceCards.map((card) => (
                  <div key={card.title} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
                        <card.icon size={16} className="text-indigo-500" />
                      </div>
                      <h4 className="font-semibold text-gray-900">{card.title}</h4>
                    </div>
                    {card.items.length > 0 ? (
                      <ul className="space-y-1.5">
                        {card.items.map((item, i) => (
                          <li key={i} className="text-sm text-gray-600">{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-400 italic">Not enough data</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center">
              <Zap size={24} className="mb-2 text-gray-300" />
              <p className="text-sm text-gray-500">No insights yet</p>
              <p className="mt-1 text-xs text-gray-400">
                Insights are generated by Claude after importing posts.
              </p>
            </div>
          )
        )}

        {detailTab === 'followers' && (() => {
          const fd = selected.follower_data
          const followers = fd?.followers ?? []
          const followerStatus = fd?.status

          if (followerStatus === 'scraping') {
            return (
              <div className="flex flex-col items-center justify-center rounded-xl border border-amber-200 bg-amber-50 py-12 text-center">
                <Loader2 size={24} className="mb-2 animate-spin text-amber-500" />
                <p className="text-sm font-medium text-amber-800">Capturing followers…</p>
                <p className="mt-1 text-xs text-amber-600">A browser window has opened. Sign in if needed and click Start Capture.</p>
              </div>
            )
          }

          if (followerStatus === 'error') {
            return (
              <div className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 py-12 text-center">
                <AlertTriangle size={24} className="mb-2 text-red-400" />
                <p className="text-sm font-medium text-red-800">Follower capture failed</p>
                <p className="mt-1 text-xs text-red-600">{fd?.error || 'Unknown error'}</p>
              </div>
            )
          }

          if (followers.length === 0) {
            return (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center">
                <Users size={24} className="mb-2 text-gray-300" />
                <p className="text-sm text-gray-500">No follower data yet</p>
                <p className="mt-1 text-xs text-gray-400">
                  Click "Capture Followers" above to scrape a sample of followers for audience discovery.
                </p>
              </div>
            )
          }

          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  {followers.length} follower{followers.length !== 1 ? 's' : ''} captured
                  {fd?.scraped_at && (
                    <span className="ml-1 text-gray-400">
                      · {new Date(fd.scraped_at).toLocaleDateString()}
                    </span>
                  )}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {followers.map((f, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors shadow-sm">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-gray-900">
                          {f.profile_url ? (
                            <a href={f.profile_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-700">
                              {f.name}
                            </a>
                          ) : f.name}
                        </p>
                        <p className="text-xs text-gray-400">@{f.handle}</p>
                      </div>
                      {f.company && (
                        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                          {f.company}
                        </span>
                      )}
                    </div>
                    {f.headline && (
                      <p className="text-sm font-medium text-gray-700 mb-1">{f.headline}</p>
                    )}
                    {f.about && (
                      <p className="text-xs text-gray-500 mb-2 line-clamp-3">{f.about}</p>
                    )}
                    {f.experience_summary && !f.about && (
                      <p className="text-xs text-gray-500 mb-2 italic">{f.experience_summary}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {f.location && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {f.location}
                        </span>
                      )}
                      {(f.industry_signals ?? []).map((sig) => (
                        <span key={sig} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
                          {sig}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}
      </div>
    )
  }

  // ---------- List view ----------
  return (
    <div className="space-y-6">
      {/* Success banner from OAuth redirect */}
      {justConnected && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 animate-in fade-in">
          <CheckCircle2 size={18} className="text-emerald-600" />
          <p className="text-sm font-medium text-emerald-800">
            {PLATFORM_LABELS[justConnected as Platform] ?? justConnected} account connected successfully! Data is being imported.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Accounts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Import public social profiles to capture posts and generate AI-powered insights
          </p>
        </div>
        <button
          onClick={() => { setShowModal(true); setConnectError(''); setConnectMode('browse'); setProfileUrl('') }}
          className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-600"
        >
          <Plus size={16} />
          Import Profile
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <Globe size={20} className="text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-600">No profiles imported yet</p>
          <p className="mt-1 max-w-sm text-xs text-gray-400">
            Paste a public profile URL and our browser agent will capture posts, profile data, and generate AI-powered content insights
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {accounts.map((acct, idx) => {
            const profile = acct.profile_data || {}
            const isConnected = acct.status === 'connected'
            const isError = acct.status === 'error'
            const isSyncing = acct.status === 'syncing'
            return (
              <button
                key={acct.id ?? idx}
                onClick={() => setSelected(acct)}
                className="group flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
              >
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.name || acct.handle}
                    className="h-11 w-11 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${PLATFORM_COLORS[acct.platform]}15` }}
                  >
                    <PlatformIcon platform={acct.platform} size={22} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
                      {profile.name || PLATFORM_LABELS[acct.platform]}
                    </p>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      isConnected
                        ? 'bg-emerald-50 text-emerald-700'
                        : isError
                        ? 'bg-red-50 text-red-600'
                        : isSyncing
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {isConnected ? 'Connected' :
                       isError ? 'Error' :
                       isSyncing ? 'Syncing…' : 'Pending'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-gray-500">{acct.handle}</p>
                  <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
                    <span>{acct.post_count ?? 0} posts imported</span>
                    <span>Health: {acct.data_health_percent ?? 0}%</span>
                    {acct.last_sync_at && (
                      <span>Synced {new Date(acct.last_sync_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Import Profile Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Import Profile</h3>
              <button
                onClick={() => { setShowModal(false); setConnecting(false) }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Mode tabs */}
            <div className="mb-5 flex gap-1 rounded-lg bg-gray-100 p-1">
              <button
                onClick={() => setConnectMode('browse')}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  connectMode === 'browse'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Globe size={14} className="mr-1.5 inline-block" />
                Browse Profile
              </button>
              <button
                onClick={() => setConnectMode('manual')}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  connectMode === 'manual'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <KeyRound size={14} className="mr-1.5 inline-block" />
                API Token
              </button>
            </div>

            {/* Browse Profile mode */}
            {connectMode === 'browse' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  Paste a public profile URL. A browser will open to capture the profile data and recent posts, then Claude will extract structured insights.
                </p>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Profile URL</label>
                  <input
                    value={profileUrl}
                    onChange={(e) => setProfileUrl(e.target.value)}
                    placeholder="https://www.linkedin.com/in/username"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && connectViaBrowser()}
                  />
                </div>

                {/* Platform detection indicator */}
                {profileUrl.trim() && (
                  <div className={`flex items-center gap-2.5 rounded-lg border p-3 ${
                    detectedPlatform
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-amber-200 bg-amber-50'
                  }`}>
                    {detectedPlatform ? (
                      <>
                        <PlatformIcon platform={detectedPlatform} size={20} />
                        <span className="text-sm font-medium text-emerald-800">
                          Detected: {PLATFORM_LABELS[detectedPlatform]}
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={16} className="text-amber-600" />
                        <span className="text-sm text-amber-700">
                          Could not detect platform. Supported: LinkedIn, X, Instagram, TikTok
                        </span>
                      </>
                    )}
                  </div>
                )}


                {/* Example URLs */}
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="mb-2 text-xs font-medium text-gray-500">Supported URL formats</p>
                  <div className="space-y-1.5">
                    {PLATFORM_URL_HINTS.map((hint, i) => (
                      <button
                        key={i}
                        onClick={() => setProfileUrl(hint.url)}
                        className="flex w-full items-center gap-2 text-left text-xs text-gray-400 hover:text-indigo-500 transition-colors"
                      >
                        <PlatformIcon platform={hint.platform} size={14} />
                        <span className="font-mono">{hint.url}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {connecting && (
                  <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                    <Loader2 size={18} className="animate-spin text-indigo-500" />
                    <div>
                      <p className="text-sm font-medium text-indigo-800">Browser opened — waiting for you…</p>
                      <p className="text-xs text-indigo-600">
                        Two browser tabs have opened: the profile page and a helper tab.
                        Sign in on the profile tab if needed, then switch to the <strong>"Adapt AI — Capture"</strong> tab
                        and click <strong>"Start Capture"</strong>.
                      </p>
                    </div>
                  </div>
                )}

                {connectError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />
                    <p className="text-xs text-red-600">{connectError}</p>
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowModal(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={connectViaBrowser}
                    disabled={connecting || !profileUrl.trim() || !detectedPlatform}
                    className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {connecting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Browsing…
                      </>
                    ) : (
                      <>
                        <Globe size={14} />
                        Import Profile
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Manual token mode */}
            {connectMode === 'manual' && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Platform</label>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value as Platform)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  >
                    {PLATFORM_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {PLATFORM_LABELS[opt]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Handle / Username</label>
                  <input
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="@username"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {TOKEN_HELP[platform].label}
                  </label>
                  <textarea
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                    placeholder="Paste your API token here..."
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono text-xs"
                  />
                  <div className="mt-1.5 flex items-start gap-2 rounded-lg bg-gray-50 p-2.5">
                    <KeyRound size={14} className="mt-0.5 shrink-0 text-gray-400" />
                    <div className="text-xs text-gray-500">
                      <p>{TOKEN_HELP[platform].hint}</p>
                      <a
                        href={TOKEN_HELP[platform].url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-indigo-500 hover:text-indigo-600"
                      >
                        Open developer portal <ExternalLink size={10} />
                      </a>
                    </div>
                  </div>
                </div>

                {connectError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />
                    <p className="text-xs text-red-600">{connectError}</p>
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowModal(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={connectManual}
                    disabled={connecting || !handle.trim() || !apiToken.trim()}
                    className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {connecting && <Loader2 size={14} className="animate-spin" />}
                    {connecting ? 'Connecting…' : 'Connect & Import'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
