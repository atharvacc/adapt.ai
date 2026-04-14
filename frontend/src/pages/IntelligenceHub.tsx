import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { Mic, Users, Shield, TrendingUp } from 'lucide-react'
import { BrandVoice } from './intelligence/BrandVoice'
import { Personas } from './intelligence/Personas'
import { Rules } from './intelligence/Rules'
import { Insights } from './intelligence/Insights'

const TABS = [
  { to: '/intelligence/voice', label: 'Brand Voice', icon: Mic },
  { to: '/intelligence/personas', label: 'Personas', icon: Users },
  { to: '/intelligence/rules', label: 'Rules', icon: Shield },
  { to: '/intelligence/insights', label: 'Insights', icon: TrendingUp },
] as const

export function IntelligenceHub() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Intelligence Hub</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage voices, personas, rules, and insights that power your content engine
        </p>
      </div>

      <nav className="mb-8 flex gap-0 border-b border-gray-200">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                isActive
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<Navigate to="voice" replace />} />
        <Route path="voice" element={<BrandVoice />} />
        <Route path="personas" element={<Personas />} />
        <Route path="rules" element={<Rules />} />
        <Route path="insights" element={<Insights />} />
      </Routes>
    </div>
  )
}
