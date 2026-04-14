import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { Users, Brain, GitBranch, BarChart3, Settings as SettingsIcon, Code } from 'lucide-react'
import { Accounts } from './pages/Accounts'
import { IntelligenceHub } from './pages/IntelligenceHub'
import { WorkflowEditor } from './pages/WorkflowEditor'
import { Analytics } from './pages/Analytics'
import { Settings } from './pages/Settings'
import { DevTools } from './pages/DevTools'

const NAV_ITEMS = [
  { to: '/accounts', label: 'Accounts', icon: Users },
  { to: '/intelligence', label: 'Intelligence Hub', icon: Brain },
  { to: '/workflows', label: 'Workflows', icon: GitBranch },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/devtools', label: 'Developer Tools', icon: Code },
] as const

function App() {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Top Bar */}
      <header className="fixed top-0 left-0 right-0 z-30 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
        <span className="text-lg font-bold tracking-tight text-gray-900">
          Adapt AI
        </span>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-xs font-semibold text-white">
          A
        </div>
      </header>

      {/* Sidebar */}
      <aside className="fixed left-0 top-14 bottom-0 z-20 flex w-[var(--sidebar-w)] flex-col bg-[var(--sidebar-bg)] px-3 pt-5">
        <div className="flex flex-col gap-1 flex-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-l-2 border-indigo-400 bg-white/10 text-white'
                    : 'border-l-2 border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </div>
        <div className="pb-4">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-l-2 border-indigo-400 bg-white/10 text-white'
                  : 'border-l-2 border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200'
              }`
            }
          >
            <SettingsIcon size={18} />
            Settings
          </NavLink>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-[var(--sidebar-w)] pt-14">
        <div className="p-6">
          <Routes>
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/intelligence/*" element={<IntelligenceHub />} />
            <Route path="/workflows/*" element={<WorkflowEditor />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/devtools" element={<DevTools />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/" element={<Navigate to="/accounts" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default App
