/**
 * Post Bridge API client for posting to social platforms
 * Uses the same API as PostRelay app
 */

const BASE_URL = "https://api.post-bridge.com/v1";

export class PostBridgeClient {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error("Post Bridge API key is required");
    }
    this.apiKey = apiKey;
  }

  async request(path, options = {}) {
    const url = `${BASE_URL}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Post Bridge API error (${response.status}): ${error.message || error.error?.join(", ") || "Unknown error"}`
      );
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) return {};
    return JSON.parse(text);
  }

  /**
   * List all connected social accounts
   */
  async listAccounts() {
    const response = await this.request("/social-accounts?limit=100");
    return response.data || [];
  }

  /**
   * Create and publish a post
   * @param {Object} options
   * @param {string} options.caption - The post text
   * @param {number[]} options.accountIds - Array of social account IDs to post to
   * @param {string[]} [options.mediaIds] - Optional array of media IDs
   * @param {Date} [options.scheduledAt] - Optional scheduled time (posts immediately if not set)
   * @param {boolean} [options.isDraft] - Save as draft instead of publishing
   */
  async createPost({ caption, accountIds, mediaIds, scheduledAt, isDraft }) {
    const body = {
      caption,
      social_accounts: accountIds,
    };

    if (mediaIds?.length) {
      body.media = mediaIds;
    }

    if (scheduledAt) {
      body.scheduled_at = scheduledAt.toISOString();
    }

    if (isDraft !== undefined) {
      body.is_draft = isDraft;
    }

    return this.request("/posts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * Get post status and results
   */
  async getPost(postId) {
    return this.request(`/posts/${postId}`);
  }

  /**
   * Get results for a post (success/failure per platform)
   */
  async getPostResults(postId) {
    const response = await this.request(
      `/post-results?post_id=${postId}&limit=100`
    );
    return response.data || [];
  }
}

/**
 * Format account info for display
 */
export function formatAccount(account) {
  const platformEmojis = {
    twitter: "𝕏",
    bluesky: "🦋",
    threads: "🧵",
    mastodon: "🐘",
    linkedin: "💼",
    facebook: "📘",
    instagram: "📷",
    tiktok: "🎵",
    youtube: "▶️",
    pinterest: "📌",
  };

  const emoji = platformEmojis[account.platform] || "📱";
  return `${emoji} ${account.platform}: @${account.username} (ID: ${account.id})`;
}
