import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotebookPen } from 'lucide-react';
import type { LearningChatState } from '@/context/learningChatState';
import { useNotifyRowLayoutChanged } from '@/context/ChatRowLayoutContext';
import LearningMarkdown from './LearningMarkdown';
import { parseLearningPracticeRecord, PRACTICE_FILE_RE, PRACTICE_RECORD_SCAN_LIMIT, type LearningPracticeRecord } from './learningPracticeRecords';

/** One projection per displayed card; no duplicate persistent store or new watcher. */
export default function LearningPracticeHistory({ context, cardPath }: { context: LearningChatState; cardPath: string }) {
  const { t } = useTranslation('task');
  const { workspacePath, fileService, isActive, changeSignal } = context;
  const [records, setRecords] = useState<LearningPracticeRecord[]>([]);
  const [failed, setFailed] = useState(false);
  const notifyLayout = useNotifyRowLayoutChanged();
  useEffect(() => {
    if (!isActive || !fileService.isAvailable) return;
    let cancelled = false;
    void (async () => {
      try {
        const directory = await fileService.dirExpand({ path: 'assessments' });
        const files = directory.children.filter(file => file.type === 'file' && PRACTICE_FILE_RE.test(file.name))
          .sort((a, b) => b.name.localeCompare(a.name)).slice(0, PRACTICE_RECORD_SCAN_LIMIT);
        const result = await Promise.all(files.map(async file => {
          const path = `assessments/${file.name}`;
          const preview = await fileService.readPreview({ path });
          return parseLearningPracticeRecord(preview.content, path);
        }));
        if (cancelled) return;
        const unique = new Map<string, LearningPracticeRecord>();
        for (const record of result) {
          if (!record || record.cardPath !== cardPath) continue;
          const previous = unique.get(record.practiceId);
          if (!previous || Date.parse(record.recordedAt) > Date.parse(previous.recordedAt)) unique.set(record.practiceId, record);
        }
        setRecords([...unique.values()].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)));
        setFailed(false);
      } catch {
        if (!cancelled) { setRecords([]); setFailed(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [cardPath, changeSignal, fileService, isActive]);
  useEffect(() => { notifyLayout('widget-resize'); }, [records, failed, notifyLayout]);
  if (!records.length && !failed) return null;
  return <section className="mt-5 border-t border-[var(--line)] pt-4" aria-label={t('learning.practiceHistory')}>
    <h4 className="learning-card-section-title mb-3 flex items-center gap-2 text-sm font-semibold"><NotebookPen aria-hidden="true" className="size-4" />{t('learning.practiceHistory')}</h4>
    {failed && <p role="status" className="text-sm text-[var(--ink-muted)]">{t('learning.practiceReadFailed')}</p>}
    {records.map(record => <details key={record.practiceId} onToggle={() => notifyLayout('widget-resize')} className="mb-2 rounded-lg border border-[var(--line)] p-3">
      <summary className="cursor-pointer text-sm text-[var(--ink)]">{new Date(record.recordedAt).toLocaleString()} · {t(`learning.outcome.${record.outcome}`)}</summary>
      <div className="ai-message-content mt-3 text-base"><LearningMarkdown basePath="assessments" workspacePath={workspacePath}>{record.body}</LearningMarkdown></div>
      <LearningMarkdown basePath="assessments" workspacePath={workspacePath}>{`[${t('learning.openPracticeRecord')}](./${record.filePath.slice('assessments/'.length)})`}</LearningMarkdown>
    </details>)}
  </section>;
}
