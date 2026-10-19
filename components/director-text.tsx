import { Fragment } from "react";

// Render emphasis as React elements, keeping model output escaped as text.
// Code spans are left literal so examples such as `**bold**` remain intact.
const inlineTokens = /(`+[^`]*`+|\*\*[^*]+\*\*)/g;

export function DirectorText({ text }: { text: string }) {
  return text.split(inlineTokens).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
