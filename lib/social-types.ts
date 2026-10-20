export type SocialPost = {
  id: string;
  platform: "tiktok" | "x";
  provider?: "official" | "twitterapi-io";
  url: string;
  author: string;
  text: string;
  publishedAt?: string;
  checkedAt: string;
  metrics: {
    views: number | null;
    likes: number | null;
    reposts: number | null;
    comments: number | null;
  };
  thumbnailUrl?: string;
  videoUrl?: string;
  duration?: number;
  assetId?: string;
  discoveryOnly?: boolean;
  importStatus: "discovered" | "fetching" | "imported" | "unavailable";
  error?: string;
};

export type TrendSearch = {
  id: string;
  query: string;
  visualTarget?: string;
  days: number;
  requestedDays?: number;
  provider?: "official" | "twitterapi-io";
  until?: string;
  since: string;
  checkedAt: string;
  status: "searching" | "complete" | "failed";
  postIds: string[];
  selectedPostIds?: string[];
  selectionNote?: string;
  pagesScanned?: number;
  warning?: string;
  error?: string;
  visualChecks?: TrendVisualCheck[];
};

export type TrendVisualCheck = {
  postId: string;
  inspectionId: string;
  status: "inspected" | "matched" | "rejected" | "uncertain" | "failed";
  checkedAt: string;
  assetId?: string;
  sha256?: string;
  seconds: number[];
  reason?: string;
  evidence?: { seconds: number; observation: string }[];
};
