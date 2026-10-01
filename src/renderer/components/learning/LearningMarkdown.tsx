import { Children, cloneElement, isValidElement, useContext, type ComponentProps, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { Columns2, Lightbulb, NotebookPen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Markdown from '@/components/Markdown';
import { LearningChatContext } from '@/context/learningChatState';
import './learning-cards.css';

const marker = /^\[!(CORE|COMPARE|EXAMPLE)\](?:\s*\n|\s*$)/;

const LearningBlockquote: Components['blockquote'] = ({ children, node }) => {
  const { t } = useTranslation('task');
  const paragraph = node?.children.find(child => child.type === 'element' && child.tagName === 'p');
  const first = paragraph?.type === 'element' ? paragraph.children[0] : undefined;
  const kind = first?.type === 'text' ? marker.exec(first.value)?.[1] : undefined;
  if (!kind) return <blockquote className="markdown-blockquote">{children}</blockquote>;

  const nodes = Children.toArray(children);
  const paragraphIndex = nodes.findIndex(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return false;
    const text = Children.toArray(child.props.children)[0];
    return typeof text === 'string' && marker.test(text);
  });
  const content = nodes.map((child, index) => {
    if (index !== paragraphIndex || !isValidElement<{ children?: ReactNode }>(child)) return child;
    return cloneElement(child, undefined, Children.map(child.props.children, (text, textIndex) =>
      textIndex === 0 && typeof text === 'string' ? text.replace(marker, '') : text));
  });
  const Icon = kind === 'CORE' ? Lightbulb : kind === 'COMPARE' ? Columns2 : NotebookPen;
  return <aside className={`learning-callout learning-callout--${kind.toLowerCase()}`}>
    <div className="learning-callout-label"><Icon aria-hidden="true" className="size-4" />{t(`learning.callout${kind}`)}</div>
    {content}
  </aside>;
};

const learningComponents: Pick<Components, 'blockquote' | 'strong'> = {
  blockquote: LearningBlockquote,
  strong: ({ children }) => <strong className="learning-emphasis">{children}</strong>,
};

/** Same sanitized Markdown pipeline; only Learning Chat receives semantic styling. */
export default function LearningMarkdown(props: ComponentProps<typeof Markdown>) {
  const learning = useContext(LearningChatContext);
  if (!learning) return <Markdown {...props} />;
  return <div className="learning-prose"><Markdown {...props} presentationComponents={learningComponents} /></div>;
}
