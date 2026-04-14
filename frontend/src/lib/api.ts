import type {
  ChangeItem,
  DiffOp,
  EditRecordEntry,
  Platform,
  PropagateResult,
  RunResponse,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowRun,
} from '../types'

const BASE_URL = 'http://localhost:8000'

export async function createRun(sourceContent: string): Promise<RunResponse> {
  const response = await fetch(`${BASE_URL}/v1/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_content: sourceContent }),
  })
  return (await response.json()) as RunResponse
}

export async function updateVariant(
  runId: string,
  platform: Platform,
  variantId: string,
  payload: Record<string, unknown>,
): Promise<RunResponse> {
  const response = await fetch(
    `${BASE_URL}/v1/runs/${runId}/nodes/${platform}/variants/${variantId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  return (await response.json()) as RunResponse
}

export async function regenerateVariant(
  runId: string,
  platform: Platform,
  variantId: string,
): Promise<RunResponse> {
  const response = await fetch(
    `${BASE_URL}/v1/runs/${runId}/nodes/${platform}/variants/${variantId}/regenerate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: 'Increase platform-native specificity.' }),
    },
  )
  return (await response.json()) as RunResponse
}

export async function listWorkflows(): Promise<WorkflowDefinition[]> {
  const response = await fetch(`${BASE_URL}/v1/workflows`)
  return (await response.json()) as WorkflowDefinition[]
}

export async function createWorkflowDefinition(
  name: string,
  description: string,
  platforms: Platform[],
): Promise<WorkflowDefinition> {
  const response = await fetch(`${BASE_URL}/v1/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, platforms }),
  })
  return (await response.json()) as WorkflowDefinition
}

export async function updateWorkflowDefinition(
  workflowId: string,
  payload: {
    name?: string
    description?: string
    platforms?: string[]
    default_voice_id?: string | null
    default_agent_id?: string | null
    default_audience_ids?: string[]
    default_rule_set_id?: string | null
    per_platform_config?: Record<string, unknown>
  },
): Promise<WorkflowDefinition> {
  const response = await fetch(`${BASE_URL}/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await response.json()) as WorkflowDefinition
}

export async function seedRuleSets(): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${BASE_URL}/v1/rule-sets/seed`, {
    method: 'POST',
  })
  return (await response.json()) as Array<Record<string, unknown>>
}

export async function createWorkflowRun(
  definitionId: string,
  sourceContent: string,
  sourceImages?: string[],
): Promise<WorkflowRun> {
  const response = await fetch(`${BASE_URL}/v1/workflows/${definitionId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_content: sourceContent, source_images: sourceImages ?? [] }),
  })
  return (await response.json()) as WorkflowRun
}

export async function uploadImage(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch(`${BASE_URL}/v1/uploads/image`, {
    method: 'POST',
    body: formData,
  })
  const data = (await response.json()) as { url: string }
  return data.url
}

export async function getRunAudit(runId: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${BASE_URL}/v1/workflows/runs/${runId}/audit`)
  return (await response.json()) as Array<Record<string, unknown>>
}

export type TraceEntry = {
  id: string
  name: string
  run_type: string
  status: string
  agent: string
  step: string
  platform: string
  node_id: string
  start_time: string | null
  end_time: string | null
  elapsed_ms: number | null
  total_tokens: number
  error: string | null
  output_snippet: string
}

export async function getRunTraces(runId: string, platform?: string, since?: string): Promise<TraceEntry[]> {
  const params = new URLSearchParams()
  if (platform) params.set('platform', platform)
  if (since) params.set('since', since)
  const qs = params.toString()
  const url = `${BASE_URL}/v1/workflows/runs/${runId}/traces${qs ? `?${qs}` : ''}`
  const response = await fetch(url)
  return (await response.json()) as TraceEntry[]
}

export async function updateRunSource(
  runId: string,
  sourceContent: string,
  sourceImages: string[],
  reason?: string,
): Promise<WorkflowRun> {
  const response = await fetch(`${BASE_URL}/v1/workflows/runs/${runId}/source`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_content: sourceContent, source_images: sourceImages, reason }),
  })
  return (await response.json()) as WorkflowRun
}

export async function getRunChangelog(runId: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${BASE_URL}/v1/workflows/runs/${runId}/changelog`)
  return (await response.json()) as Array<Record<string, unknown>>
}

export async function submitFeedback(
  runId: string,
  payload: {
    node_id: string
    variant_id: string
    action: string
    final_text?: string
    user_instruction?: string
    time_spent_ms?: number
  },
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/workflows/runs/${runId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await response.json()) as Record<string, unknown>
}

export async function getEditSuggestions(
  runId: string,
  payload: { node_id: string; variant_id: string; selected_text: string; instruction?: string },
): Promise<{ suggestions: string[]; rationale: string }> {
  const response = await fetch(`${BASE_URL}/v1/workflows/runs/${runId}/edit-suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await response.json()) as { suggestions: string[]; rationale: string }
}

export async function chatWithDraft(
  runId: string,
  payload: { node_id: string; variant_id: string; message: string; current_text: string },
): Promise<{ reply: string; suggested_text?: string | null; diff_ranges?: Array<Record<string, unknown>> }> {
  const response = await fetch(`${BASE_URL}/v1/workflows/runs/${runId}/edit-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await response.json()) as { reply: string; suggested_text?: string | null; diff_ranges?: Array<Record<string, unknown>> }
}

export async function createWorkflow(sourceContent: string): Promise<WorkflowRun> {
  const wf = await createWorkflowDefinition(
    'Default Workflow',
    'Local DAG workflow',
    ['linkedin', 'x', 'instagram', 'facebook'],
  )
  return createWorkflowRun(wf.id, sourceContent)
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRun> {
  const response = await fetch(`${BASE_URL}/v1/workflows/runs/${runId}`)
  return (await response.json()) as WorkflowRun
}

export async function updateWorkflowNode(
  runId: string,
  node: WorkflowNode,
  composition?: Record<string, unknown>,
  context?: string,
): Promise<WorkflowRun> {
  const response = await fetch(`${BASE_URL}/v1/workflows/runs/${runId}/nodes/${node.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      composition: composition ?? { ...node.composition, strategy: 'stronger_hook' },
      context: context ?? 'Use stronger platform-native hook patterns.',
    }),
  })
  return (await response.json()) as WorkflowRun
}

export async function getWorkflow(workflowId: string): Promise<WorkflowDefinition> {
  const response = await fetch(`${BASE_URL}/v1/workflows/${workflowId}`)
  return (await response.json()) as WorkflowDefinition
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  await fetch(`${BASE_URL}/v1/workflows/${workflowId}`, { method: 'DELETE' })
}

export async function listWorkflowRuns(workflowId: string): Promise<WorkflowRun[]> {
  const response = await fetch(`${BASE_URL}/v1/workflows/${workflowId}/runs`)
  return (await response.json()) as WorkflowRun[]
}

export async function createAccount(
  handle: string,
  platform: Platform,
  apiToken: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, platform, api_token: apiToken }),
  })
  return (await response.json()) as Record<string, unknown>
}

export async function scrapeProfile(
  url: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/accounts/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Scrape failed' }))
    throw new Error(err.detail || 'Scrape failed')
  }
  return (await response.json()) as Record<string, unknown>
}

export async function rescrapeAccount(
  accountId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/accounts/${accountId}/rescrape`, {
    method: 'POST',
  })
  return (await response.json()) as Record<string, unknown>
}

export async function getOAuthPlatforms(): Promise<Record<Platform, boolean>> {
  const response = await fetch(`${BASE_URL}/v1/oauth/platforms`)
  return (await response.json()) as Record<Platform, boolean>
}

export async function getOAuthUrl(platform: Platform): Promise<string> {
  const response = await fetch(`${BASE_URL}/v1/oauth/${platform}/authorize`)
  const data = (await response.json()) as { url: string }
  return data.url
}

export async function syncAccount(
  accountId: string,
  apiToken?: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/accounts/${accountId}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_token: apiToken }),
  })
  return (await response.json()) as Record<string, unknown>
}

export async function getAccount(
  accountId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/accounts/${accountId}`)
  return (await response.json()) as Record<string, unknown>
}

export async function listAccounts(): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${BASE_URL}/v1/accounts`)
  return (await response.json()) as Array<Record<string, unknown>>
}

export async function listVoices(): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${BASE_URL}/v1/voices`)
  return (await response.json()) as Array<Record<string, unknown>>
}

export async function createVoice(
  name: string,
  purpose: string,
  source_account_ids: string[],
  training_period: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/voices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, purpose, source_account_ids, training_period }),
  })
  return (await response.json()) as Record<string, unknown>
}

export async function getVoice(
  voiceId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/voices/${voiceId}`)
  return (await response.json()) as Record<string, unknown>
}

export async function updateVoice(
  voiceId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/voices/${voiceId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await response.json()) as Record<string, unknown>
}

export async function listPersonas(): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${BASE_URL}/v1/personas`)
  return (await response.json()) as Array<Record<string, unknown>>
}

export async function createPersona(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/personas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await response.json()) as Record<string, unknown>
}

export async function updatePersona(
  personaId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/personas/${personaId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await response.json()) as Record<string, unknown>
}

export async function deletePersona(
  personaId: string,
): Promise<void> {
  await fetch(`${BASE_URL}/v1/personas/${personaId}`, { method: 'DELETE' })
}

export async function discoverPersonas(
  accountIds: string[],
): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${BASE_URL}/v1/personas/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_ids: accountIds }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Discovery failed' }))
    throw new Error(err.detail || 'Discovery failed')
  }
  return (await response.json()) as Array<Record<string, unknown>>
}

export async function scrapeFollowers(
  accountId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/accounts/${accountId}/scrape-followers`, {
    method: 'POST',
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Follower scrape failed' }))
    throw new Error(err.detail || 'Follower scrape failed')
  }
  return (await response.json()) as Record<string, unknown>
}

export type Version = {
  id: string
  version: number
  snapshot: Record<string, unknown>
  created_at: string
}

export async function listVersions(
  entityType: string,
  entityId: string,
): Promise<Version[]> {
  const response = await fetch(`${BASE_URL}/v1/versions/${entityType}/${entityId}`)
  return (await response.json()) as Version[]
}

export async function restoreVersion(
  entityType: string,
  entityId: string,
  version: number,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${BASE_URL}/v1/versions/${entityType}/${entityId}/${version}/restore`,
    { method: 'POST' },
  )
  return (await response.json()) as Record<string, unknown>
}

export async function listRuleSets(): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${BASE_URL}/v1/rule-sets`)
  return (await response.json()) as Array<Record<string, unknown>>
}

export async function createRuleSet(
  name: string,
  description: string,
  default_platform?: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/rule-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, default_platform, rules: [] }),
  })
  return (await response.json()) as Record<string, unknown>
}

export async function getAnalyticsSummary(): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v1/analytics/summary`)
  return (await response.json()) as Record<string, unknown>
}

export async function getSettings(): Promise<{
  values: Record<string, string>
  configured: Record<string, boolean>
}> {
  const response = await fetch(`${BASE_URL}/v1/settings`)
  return (await response.json()) as {
    values: Record<string, string>
    configured: Record<string, boolean>
  }
}

export async function updateSettings(
  values: Record<string, string>,
): Promise<{
  values: Record<string, string>
  configured: Record<string, boolean>
}> {
  const response = await fetch(`${BASE_URL}/v1/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  })
  return (await response.json()) as {
    values: Record<string, string>
    configured: Record<string, boolean>
  }
}

export async function getDevToolsStats(): Promise<Record<string, number>> {
  const response = await fetch(`${BASE_URL}/v1/devtools/stats`)
  return (await response.json()) as Record<string, number>
}

export async function getDevToolsTable(
  table: string,
  limit = 200,
  offset = 0,
): Promise<{
  table: string
  total: number
  offset: number
  limit: number
  rows: Array<Record<string, unknown>>
}> {
  const response = await fetch(
    `${BASE_URL}/v1/devtools/${table}?limit=${limit}&offset=${offset}`,
  )
  return (await response.json()) as {
    table: string
    total: number
    offset: number
    limit: number
    rows: Array<Record<string, unknown>>
  }
}

export async function chatWithDraftSession(
  runId: string,
  payload: {
    node_id: string
    variant_id: string
    message: string
    current_text: string
    session_id?: string
    history?: Array<{ role: string; text: string }>
  },
): Promise<{
  reply: string
  suggested_text?: string | null
  diff_ops: DiffOp[]
  session_id: string
}> {
  const response = await fetch(`${BASE_URL}/v1/workflows/runs/${runId}/edit-chat-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await response.json()) as {
    reply: string
    suggested_text?: string | null
    diff_ops: DiffOp[]
    session_id: string
  }
}

export async function summarizeChanges(
  runId: string,
  payload: { node_id: string; variant_id: string },
): Promise<{ summary: string; change_items: ChangeItem[] }> {
  const response = await fetch(`${BASE_URL}/v1/workflows/runs/${runId}/summarize-changes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await response.json()) as { summary: string; change_items: ChangeItem[] }
}

export async function propagateChanges(
  runId: string,
  payload: {
    node_id: string
    source_variant_id: string
    target_variant_ids?: string[]
    target_node_ids?: string[]
    change_item_ids?: string[]
    edit_directives?: string[]
    mode?: string
  },
): Promise<PropagateResult> {
  const response = await fetch(`${BASE_URL}/v1/workflows/runs/${runId}/propagate-changes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await response.json()) as PropagateResult
}

export async function getEditHistory(
  runId: string,
  nodeId: string,
  variantId?: string,
): Promise<EditRecordEntry[]> {
  const params = new URLSearchParams()
  if (variantId) params.set('variant_id', variantId)
  const qs = params.toString()
  const url = `${BASE_URL}/v1/workflows/runs/${runId}/nodes/${nodeId}/edit-history${qs ? `?${qs}` : ''}`
  const response = await fetch(url)
  return (await response.json()) as EditRecordEntry[]
}
