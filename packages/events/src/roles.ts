import type { PipelineId, RoleId, ToolId } from './schema';

export type DeptId = 'ad' | 'eng' | 'comms';

export interface DeptDef {
  label: string;
  color: string;
}

export interface RoleDef {
  label: string;
  dept: DeptId;
  /** Work room the role's desks live in. */
  room: string;
  pipeline: PipelineId;
}

export const DEPTS: Record<DeptId, DeptDef> = {
  ad: { label: 'Ad Studio', color: '#ff8a5b' },
  eng: { label: 'Engineering', color: '#4f9dff' },
  comms: { label: 'Communications', color: '#3ecf8e' },
};

export const ROLES: Record<RoleId, RoleDef> = {
  creative: { label: 'Creative', dept: 'ad', room: 'creative', pipeline: 'ad' },
  content: { label: 'Content', dept: 'ad', room: 'content', pipeline: 'ad' },
  adqa: { label: 'Ad QA', dept: 'ad', room: 'adqa', pipeline: 'ad' },
  codegen: { label: 'Code Gen', dept: 'eng', room: 'codegen', pipeline: 'code' },
  codereview: { label: 'Code Review', dept: 'eng', room: 'codereview', pipeline: 'code' },
  testing: { label: 'Testing', dept: 'eng', room: 'testing', pipeline: 'code' },
  prreview: { label: 'PR Review', dept: 'eng', room: 'prreview', pipeline: 'code' },
  comms: { label: 'Comms', dept: 'comms', room: 'comms', pipeline: 'comms' },
  statusmonitor: { label: 'Status Monitor', dept: 'eng', room: 'server', pipeline: 'ops' },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

/** Stage order per pipeline; finishing a stage hands the task to the next role. */
export const PIPELINES: Record<PipelineId, RoleId[]> = {
  ad: ['creative', 'content', 'adqa'],
  code: ['codegen', 'codereview', 'testing', 'prreview'],
  comms: ['comms'],
  ops: ['statusmonitor'],
};

/** Which shared room an agent physically visits for a (longer) tool call. */
export const TOOL_ROOMS: Record<ToolId, 'library' | 'server' | 'studio' | 'media'> = {
  web_search: 'library',
  docs: 'library',
  api: 'server',
  database: 'server',
  ci: 'server',
  deploy: 'server',
  image_gen: 'studio',
  brainstorm: 'studio',
  moodboard: 'studio',
  photo_shoot: 'studio',
  video_edit: 'studio',
  podcast: 'media',
  broadcast: 'media',
};

export const TOOL_LABELS: Record<ToolId, string> = {
  web_search: 'Web search',
  docs: 'Reading docs',
  api: 'API call',
  database: 'Database query',
  ci: 'CI pipeline',
  image_gen: 'Image generation',
  deploy: 'Deploy',
  brainstorm: 'Brainstorming',
  moodboard: 'Moodboarding',
  photo_shoot: 'Photo shoot',
  video_edit: 'Video editing',
  podcast: 'Recording a podcast',
  broadcast: 'On air (TV)',
};
