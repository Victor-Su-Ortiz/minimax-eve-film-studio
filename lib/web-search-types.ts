export type WebResearchResult = {
  url: string;
  title: string;
  excerpt: string;
  platform: "x" | "tiktok" | "instagram" | "youtube" | "web";
  publishedAt?: string;
};
export type WebResearchSearch = {
  id: string;
  query: string;
  scope: "social" | "web";
  days: number;
  since: string;
  checkedAt: string;
  status: "searching" | "complete" | "failed";
  results: WebResearchResult[];
  error?: string;
};
