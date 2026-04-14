import { useEffect, useState, useMemo } from 'react'
import { Search, Copy, ChevronDown, ChevronRight, Database, RefreshCw } from 'lucide-react'
import { getDevToolsStats, getDevToolsTable } from '../lib/api'

const TABLES = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'voices', label: 'Voices' },
  { key: 'personas', label: 'Personas' },
  { key: 'rule_sets', label: 'Rule Sets' },
  { key: 'workflow_definitions', label: 'Workflow Defs' },
  { key: 'workflow_runs', label: 'Workflow Runs' },
  { key: 'workflow_node_states', label: 'Node States' },
  { key: 'workflow_audit_logs', label: 'Audit Logs' },
  { key: 'content_feedback', label: 'Feedback' },
  { key: 'run_change_logs', label: 'Change Logs' },
  { key: 'document_embeddings', label: 'Embeddings' },
  { key: 'config', label: 'Config' },
  { key: 'record_versions', label: 'Versions' },
  { key: 'runs', label: 'Runs (Legacy)' },
  { key: 'variant_edits', label: 'Variant Edits' },
] as const

type TableKey = (typeof TABLES)[number]['key']

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

function RowDetail({ row }: { row: Record<string, unknown> }) {
  const json = JSON.stringify(row, null, 2)
  return (
    <div className="relative bg-gray-950 rounded-lg p-4 text-xs font-mono text-gray-300 overflow-auto max-h-96">
      <button
        onClick={() => copyToClipboard(json)}
        className="absolute top-2 right-2 p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
        title="Copy JSON"
      >
        <Copy size={13} />
      </button>
      <pre className="whitespace-pre-wrap break-all">{json}</pre>
    </div>
  )
}

function TableView({
  tableKey,
  stats,
}: {
  tableKey: TableKey
  stats: Record<string, number>
}) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [page, setPage] = useState(0)
  const pageSize = 50

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setExpandedIds(new Set())
    setSearch('')
    setPage(0)
    setError(null)
    getDevToolsTable(tableKey, pageSize, 0)
      .then((res) => {
        setRows(res.rows)
        setTotal(res.total)
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [tableKey])

  const loadPage = (p: number) => {
    setLoading(true)
    setPage(p)
    setExpandedIds(new Set())
    setError(null)
    getDevToolsTable(tableKey, pageSize, p * pageSize)
      .then((res) => {
        setRows(res.rows)
        setTotal(res.total)
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false))
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
  }, [rows, search])

  const toggleRow = (idx: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const columns = useMemo(() => {
    if (filtered.length === 0) return []
    const priorityCols = ['id', 'name', 'handle', 'key', 'platform', 'status', 'created_at']
    const allKeys = Object.keys(filtered[0])
    const ordered = priorityCols.filter((c) => allKeys.includes(c))
    const rest = allKeys.filter((c) => !ordered.includes(c)).slice(0, 3)
    return [...ordered, ...rest]
  }, [filtered])

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={`Search ${stats[tableKey] ?? 0} records…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>
        <button
          onClick={() => loadPage(page)}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center py-20 text-red-500 text-sm">
          <Database size={32} className="mb-2 opacity-40" />
          <span>Failed to load: {error}</span>
          <button
            onClick={() => loadPage(page)}
            className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-1.5 text-red-600 text-sm hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 text-sm">
          <Database size={32} className="mb-2 opacity-40" />
          {search ? 'No matching records' : 'Table is empty'}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80">
                  <th className="w-8 px-3 py-2.5" />
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2.5 text-left font-semibold text-gray-600 text-xs uppercase tracking-wider"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => {
                  const expanded = expandedIds.has(idx)
                  return (
                    <RowEntry
                      key={idx}
                      row={row}
                      columns={columns}
                      expanded={expanded}
                      onToggle={() => toggleRow(idx)}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>
                Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page === 0}
                  onClick={() => loadPage(page - 1)}
                  className="rounded-md border border-gray-200 bg-white px-3 py-1 disabled:opacity-40 hover:bg-gray-50"
                >
                  Prev
                </button>
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => loadPage(page + 1)}
                  className="rounded-md border border-gray-200 bg-white px-3 py-1 disabled:opacity-40 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function RowEntry({
  row,
  columns,
  expanded,
  onToggle,
}: {
  row: Record<string, unknown>
  columns: string[]
  expanded: boolean
  onToggle: () => void
}) {
  const renderCell = (val: unknown) => {
    if (val === null || val === undefined) return <span className="text-gray-300">null</span>
    if (typeof val === 'object') return <span className="text-indigo-500 italic">{'{…}'}</span>
    const s = String(val)
    if (s.length > 60) return <span title={s}>{s.slice(0, 57)}…</span>
    return <>{s}</>
  }

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-gray-50 hover:bg-indigo-50/40 cursor-pointer transition-colors"
      >
        <td className="px-3 py-2 text-gray-400">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        {columns.map((col) => (
          <td key={col} className="px-3 py-2 text-gray-700 max-w-[200px] truncate">
            {renderCell(row[col])}
          </td>
        ))}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length + 1} className="px-4 py-3 bg-gray-50/60">
            <RowDetail row={row} />
          </td>
        </tr>
      )}
    </>
  )
}

export function DevTools() {
  const [activeTable, setActiveTable] = useState<TableKey>('accounts')
  const [stats, setStats] = useState<Record<string, number>>({})
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    setStatsLoading(true)
    getDevToolsStats()
      .then(setStats)
      .finally(() => setStatsLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Developer Tools</h1>
        <p className="mt-1 text-sm text-gray-500">
          Explore all application data stored in the database
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABLES.map(({ key, label }) => {
          const count = stats[key]
          const isActive = activeTable === key
          return (
            <button
              key={key}
              onClick={() => setActiveTable(key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-gray-300'
              }`}
            >
              {label}
              {!statsLoading && count !== undefined && (
                <span
                  className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                    isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <TableView key={activeTable} tableKey={activeTable} stats={stats} />
    </div>
  )
}
