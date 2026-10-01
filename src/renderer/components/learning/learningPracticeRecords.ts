import { FAILSAFE_SCHEMA, load as yamlLoad } from 'js-yaml';

export const PRACTICE_FILE_RE = /^\d{4}-\d{2}-\d{2}-practice-[a-z0-9-]+\.md$/;
export const PRACTICE_RECORD_SCAN_LIMIT = 120;
export interface LearningPracticeRecord {
  filePath: string;
  cardPath: string;
  practiceId: string;
  sessionId: string;
  recordedAt: string;
  outcome: 'discussed' | 'practiced' | 'needs-review';
  body: string;
}

/** A record is displayed only after a valid file exists; chat acknowledgements are not receipts. */
export function parseLearningPracticeRecord(raw: string, filePath: string): LearningPracticeRecord | null {
  if (!/^assessments\//.test(filePath) || !PRACTICE_FILE_RE.test(filePath.slice('assessments/'.length))) return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) return null;
  try {
    const fields = yamlLoad(match[1], { schema: FAILSAFE_SCHEMA });
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
    const data = fields as Record<string, unknown>;
    const text = (key: string) => typeof data[key] === 'string' ? data[key].trim() : '';
    const cardPath = text('card');
    const practiceId = text('practice_id');
    const sessionId = text('session_id');
    const recordedAt = text('recorded_at');
    const outcome = text('outcome');
    const body = match[2].trim();
    if (text('type') !== 'practice' || !/^cards\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(cardPath)
      || !practiceId || !sessionId || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(recordedAt) || !Number.isFinite(Date.parse(recordedAt)) || !body
      || !['discussed', 'practiced', 'needs-review'].includes(outcome)) return null;
    return { filePath, cardPath, practiceId, sessionId, recordedAt, outcome: outcome as LearningPracticeRecord['outcome'], body };
  } catch { return null; }
}
