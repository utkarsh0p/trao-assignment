'use client';

import Card from '@/components/ui/Card';
import Section from './Section';

function Paragraph({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 max-w-[68ch] text-[15px] leading-relaxed text-text">{children}</p>
    </div>
  );
}

export default function Brief({ kit, actions, renderField }) {
  const { company_brief: brief, source } = kit;
  const field = renderField || ((_path, value) => value);

  return (
    <Section id="brief" title="Company brief" actions={actions}>
      <Card className="flex flex-col gap-6">
        <Paragraph label="Summary">{field('company_brief.summary', brief.summary)}</Paragraph>
        <Paragraph label="What they do">
          {field('company_brief.what_they_do', brief.what_they_do)}
        </Paragraph>

        <div>
          <p className="text-xs font-medium text-text-muted">How they interview</p>
          {brief.hiring_process ? (
            <p className="mt-1 max-w-[68ch] text-[15px] leading-relaxed text-text">
              {brief.hiring_process}
            </p>
          ) : (
            // Not a blank. The absence is the finding.
            <p className="mt-1 max-w-[68ch] text-[15px] leading-relaxed text-text-muted">
              This company publishes nothing about how it interviews, so the questions below come
              from the posting rather than from a described process.
            </p>
          )}
        </div>

        {source.pages_used?.length ? (
          <div>
            <p className="text-xs font-medium text-text-muted">
              Read from {source.pages_used.length === 1 ? 'one page' : `${source.pages_used.length} pages`}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {source.pages_used.map((url) => (
                <li key={url} className="truncate">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-lg text-xs text-accent hover:text-accent-hover"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-text-muted">
            No pages from the company site could be read. Everything here comes from the posting.
          </p>
        )}
      </Card>
    </Section>
  );
}
