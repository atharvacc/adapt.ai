import { BarChart3 } from 'lucide-react'

export function Analytics() {
  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col items-center justify-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 mb-4">
        <BarChart3 size={28} className="text-indigo-400" />
      </div>
      <h1 className="text-xl font-semibold text-gray-900">Analytics</h1>
      <p className="mt-2 text-sm text-gray-500">Coming soon</p>
      <p className="mt-1 max-w-sm text-center text-xs text-gray-400">
        Track engagement, performance metrics, and content insights across all your connected platforms.
      </p>
    </div>
  )
}
