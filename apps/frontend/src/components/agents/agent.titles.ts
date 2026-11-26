export type ThreadSummary = { id: string; title?: string | null };

export const TITLE_POLL_INTERVAL_MS = 5000;
export const TITLE_POLL_WINDOW_MS = 30_000;

const hasUntitledThreads = (threads: ThreadSummary[] | undefined) =>
  !!threads?.some((p) => !p.title?.trim());

export const shouldPollTitles = (
  threads: ThreadSummary[] | undefined,
  deadline: number,
  now: number
) => hasUntitledThreads(threads) && now < deadline;
