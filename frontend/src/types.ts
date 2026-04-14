export type Platform = 'linkedin' | 'x' | 'instagram' | 'facebook'

export type RationaleStruct = {
  strategy?: string
  audience_fit?: string
  voice_alignment?: string
  rules_alignment?: string
  evidence_links?: string[]
  open_questions?: string[]
}

export type Variant = {
  id: string
  label: 'A' | 'B' | 'C'
  text: string
  rationale: string
  rationale_struct?: RationaleStruct
  status: 'generated' | 'accepted' | 'edited' | 'rejected'
  hook_type?: string
  consistency_score?: number
  image_prompt?: string
  image_url?: string
}

export type FeedbackAction = 'accept' | 'edit' | 'reject' | 'regenerate'

export type EditSuggestion = {
  suggestions: string[]
  rationale: string
}

export type EditChatMessage = {
  reply: string
  suggested_text?: string | null
  diff_ranges?: Array<{ start: number; end: number; replacement: string }>
}

export type PlatformOutput = {
  platform: Platform
  variants: Variant[]
}

export type RunResponse = {
  run_id: string
  outputs: PlatformOutput[]
}

export type StepStatus = 'done' | 'in_progress' | 'pending'

export type RunProgress = {
  source: StepStatus
  adapt: StepStatus
  review: StepStatus
  publish: StepStatus
  complete: StepStatus
}

export type WorkflowRunSummary = {
  id: string
  source_content: string
  status: 'active' | 'done' | 'failed'
  created_at: string
  progress?: RunProgress
}

export type WorkflowDefinition = {
  id: string
  name: string
  description?: string
  platforms?: Platform[]
  default_voice_id?: string | null
  default_agent_id?: string | null
  default_audience_id?: string | null
  default_audience_ids?: string[]
  default_rule_set_id?: string | null
  per_platform_config?: Record<string, unknown>
  agent_name?: string
  voice_name?: string
  runs?: WorkflowRunSummary[]
}

export type CompositionSlot = {
  type: 'voice' | 'agent' | 'audience' | 'rules'
  name: string
  id?: string
}

export type AppliedRule = {
  id: string
  name: string
  type: string
  enforcement: 'required' | 'suggested' | 'optional'
  description?: string
}

export type ValidationResult = {
  variant_label?: string
  rule_name: string
  rule_type: string
  enforcement: 'required' | 'suggested' | 'optional'
  status: 'pass' | 'warn' | 'fail'
  message?: string
}

export type WorkflowNode = {
  id: string
  node_type: 'source' | 'platform' | 'review' | 'publish'
  platform: Platform | null
  status: string
  composition: Record<string, unknown>
  variants: Variant[]
  applied_rules?: AppliedRule[]
  validation_results?: ValidationResult[]
  started_at?: string | null
}

export type AuditEntry = {
  id: string
  run_id: string
  node_id?: string
  step: string
  agent_name: string
  platform?: string
  input_summary: string
  output_summary: string
  token_usage: { input: number; output: number }
  latency_ms: number
  status: string
  created_at: string
}

export type WorkflowRun = {
  id: string
  definition_id: string
  source_content: string
  source_images?: string[]
  status: string
  created_at?: string
  dag_state: Record<string, unknown>
  nodes: WorkflowNode[]
}

export type DiffOp = {
  op: 'equal' | 'insert' | 'delete'
  lines: string[]
}

export type EditRecordEntry = {
  id: string
  run_id: string
  node_id: string
  variant_id: string
  edit_type: 'inline' | 'ai_chat' | 'ai_suggest' | 'propagated'
  before_text: string
  after_text: string
  diff_ops: DiffOp[]
  summary?: string | null
  user_instruction?: string | null
  chat_session_id?: string | null
  propagated_from?: string | null
  created_at?: string | null
}

export type ChangeItem = {
  id: string
  description: string
  category: string
  edit_directive: string
  cross_platform_applicable?: boolean
}

export type ChatSessionMessage = {
  role: 'user' | 'ai'
  text: string
  suggested_text?: string | null
  diff_ops?: DiffOp[]
}

export type PropagateResult = {
  propagated_count: number
  updated_variants: Array<{
    variant_id: string
    new_text: string
    edit_record_id: string
  }>
  updated_nodes?: Array<{
    node_id: string
    platform: string
    updated_variants: Array<{
      variant_id: string
      new_text: string
      edit_record_id: string
    }>
  }>
}
