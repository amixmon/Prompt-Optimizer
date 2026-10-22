import { memo } from "react";
import Markdown, { type Components } from "react-markdown";

const components: Components = {
  h1: ({ children }) => <h2>{children}</h2>,
  a: ({ children, href, title }) =>
    href ? (
      <a href={href} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

export const PromptMarkdown = memo(function PromptMarkdown({ text }: { text: string }) {
  return (
    <div className="prompt-markdown">
      {/* Raw HTML stays escaped; model-generated images must not make external requests. */}
      <Markdown components={components} disallowedElements={["img"]}>
        {text}
      </Markdown>
    </div>
  );
});
