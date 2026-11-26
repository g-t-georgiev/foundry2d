/**
 * A template a tool starts new work from (a sprite size, a level preset, a
 * pack set up for an engine). Each tool lists its own in `src/templates.ts`,
 * plain data the tool and the studio's hub both read.
 */
export interface ToolTemplate {
  /** What `?new=` and `createFromTemplate` take. */
  id: string;
  label: string;
  description: string;
}
