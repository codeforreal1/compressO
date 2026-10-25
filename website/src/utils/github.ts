export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

const REPO_OWNER = "codeforreal1";
const REPO_NAME = "compressO";

/** The latest release's page, which always offers the newest installers */
export const LATEST_RELEASE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

/**
 * Fetches a JSON document from the GitHub API, or `undefined` when GitHub cannot be reached or
 * refuses (e.g. its hourly limit for anonymous requests), so the site still builds.
 */
async function fetchGitHub<T>(path: string): Promise<T | undefined> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}${path}`);
    if (response.ok) return (await response.json()) as T;
    console.warn(`GitHub API ${path || "/"} answered ${response.status}; using the fallback.`);
  } catch (error) {
    console.warn(`GitHub API ${path || "/"} could not be reached; using the fallback.`, error);
  }
  return undefined;
}

/**
 * Fetch the latest release from GitHub
 * This runs at build time, so there's no runtime API call from the client
 */
export async function getLatestRelease(): Promise<GitHubRelease | undefined> {
  return fetchGitHub<GitHubRelease>("/releases/latest");
}

/**
 * Generate download URL for a specific asset
 */
export function getDownloadUrl(version: string, assetName: string): string {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${version}/${assetName}`;
}

/**
 * Download asset types
 */
export interface DownloadAssets {
  version: string;
  mac: {
    aarch64: string;
    x64: string;
  };
  linux: {
    appImage: string;
    deb: string;
  };
  windows: {
    x64: string;
  };
}

/**
 * Get all download URLs for the current version. Without one (GitHub could not be reached), every
 * link opens the latest release's page instead.
 */
export function getDownloadAssets(version: string | undefined): DownloadAssets {
  if (!version) {
    return {
      version: "",
      mac: { aarch64: LATEST_RELEASE_URL, x64: LATEST_RELEASE_URL },
      linux: { appImage: LATEST_RELEASE_URL, deb: LATEST_RELEASE_URL },
      windows: { x64: LATEST_RELEASE_URL },
    };
  }
  const baseUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${version}`;

  return {
    version,
    mac: {
      aarch64: `${baseUrl}/CompressO_${version}_aarch64.dmg`,
      x64: `${baseUrl}/CompressO_${version}_x64.dmg`,
    },
    linux: {
      appImage: `${baseUrl}/CompressO_${version}_amd64.AppImage`,
      deb: `${baseUrl}/CompressO_${version}_amd64.deb`,
    },
    windows: {
      x64: `${baseUrl}/CompressO_${version}_x64.exe`,
    },
  };
}

/** The repository's star count, or `undefined` when GitHub cannot be reached (the count is hidden) */
export async function fetchGitHubStars(): Promise<number | undefined> {
  const repository = await fetchGitHub<{ stargazers_count?: number }>("");
  return repository?.stargazers_count;
}