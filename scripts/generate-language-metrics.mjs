import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import linguist from "linguist-js";

const username = process.env.METRICS_USERNAME || "kairui1012";
const token = process.env.METRICS_TOKEN;
const outputPath = process.env.METRICS_OUTPUT || "github-metrics.svg";

if (!token) {
  throw new Error("METRICS_TOKEN is required.");
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "User-Agent": `${username}-profile-language-metrics`,
  "X-GitHub-Api-Version": "2022-11-28",
};

const response = await fetch(
  `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&type=owner`,
  { headers },
);

if (!response.ok) {
  throw new Error(`GitHub API returned ${response.status} while listing repositories.`);
}

const repositories = (await response.json()).filter(
  (repository) =>
    !repository.fork &&
    !repository.archived &&
    repository.name.toLowerCase() !== username.toLowerCase(),
);

if (repositories.length === 0) {
  throw new Error("No public source repositories were found.");
}

const workspace = mkdtempSync(join(tmpdir(), "profile-languages-"));
const repositoryRoot = join(workspace, "repositories");
mkdirSync(repositoryRoot);

try {
  const folders = [];

  for (const repository of repositories) {
    const destination = join(repositoryRoot, repository.name);
    try {
      execFileSync(
        "git",
        [
          "clone",
          "--depth",
          "1",
          "--single-branch",
          "--branch",
          repository.default_branch,
          repository.clone_url,
          destination,
        ],
        { stdio: "ignore", timeout: 180_000 },
      );
      folders.push(destination);
      console.log(`Analysing ${repository.name}`);
    } catch {
      console.warn(`Skipping ${repository.name}: clone failed.`);
    }
  }

  if (folders.length === 0) {
    throw new Error("None of the public repositories could be cloned.");
  }

  const analysis = await linguist.analyseFolders(folders, {
    categories: ["markup", "programming"],
    calculateLines: false,
    keepBinary: false,
    keepVendored: false,
    relativePaths: true,
  });

  const languages = Object.entries(analysis.languages.results)
    .map(([name, details]) => ({
      name,
      bytes: details.bytes,
      color: analysis.repository[name]?.color || "#8b949e",
    }))
    .filter((language) => language.bytes > 0)
    .sort((left, right) => right.bytes - left.bytes);

  const totalBytes = languages.reduce((total, language) => total + language.bytes, 0);

  if (totalBytes === 0) {
    throw new Error("LinguistJS did not detect any language data.");
  }

  writeFileSync(outputPath, renderSvg({ username, languages, totalBytes }));
  console.log(`Generated ${outputPath} with ${languages.length} languages.`);
} finally {
  rmSync(workspace, { force: true, recursive: true });
}

function renderSvg({ username, languages, totalBytes }) {
  const width = 1200;
  const padding = 38;
  const columnCount = 4;
  const columnGap = 26;
  const rowHeight = 88;
  const gridTop = 164;
  const columnWidth = (width - padding * 2 - columnGap * (columnCount - 1)) / columnCount;
  const rowCount = Math.ceil(languages.length / columnCount);
  const height = gridTop + rowCount * rowHeight + 24;
  const formattedTotal = new Intl.NumberFormat("en-US").format(totalBytes);
  const languageWord = languages.length === 1 ? "language" : "languages";

  const items = languages
    .map((language, index) => {
      const percentage = (language.bytes / totalBytes) * 100;
      const column = index % columnCount;
      const row = Math.floor(index / columnCount);
      const x = padding + column * (columnWidth + columnGap);
      const y = gridTop + row * rowHeight;
      const barWidth = Math.max(4, Math.min(columnWidth - 26, percentage * 4.4));

      return `
    <g transform="translate(${x} ${y})">
      <rect width="${barWidth.toFixed(2)}" height="10" rx="5" fill="${escapeXml(language.color)}" />
      <text y="40" fill="${escapeXml(language.color)}" font-size="20" font-weight="600">
        ${escapeXml(language.name)} <tspan font-size="16">(${formatPercentage(percentage)})</tspan>
      </text>
      <text y="67" fill="#8b949e" font-size="16">${formatBytes(language.bytes)}</text>
    </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">Used languages for ${escapeXml(username)}</title>
  <desc id="description">LinguistJS analysis of ${languages.length} languages across public repositories owned by ${escapeXml(username)}.</desc>
  <rect width="${width}" height="${height}" rx="14" fill="#0d1117" />

  <g transform="translate(${padding} 34)" fill="none" stroke="#c9d1d9" stroke-linecap="round" stroke-linejoin="round" stroke-width="3">
    <rect x="0" y="0" width="31" height="23" rx="3" />
    <path d="M8 8l-4 4 4 4M23 8l4 4-4 4M17 6l-4 12M10 23v7l7-7" />
  </g>
  <text x="${padding + 45}" y="58" fill="#c9d1d9" font-size="31" font-weight="600">Used languages</text>

  <text x="${padding}" y="105" fill="#c9d1d9" font-size="18">
    <tspan font-weight="700">${escapeXml(username)}</tspan> has used ${languages.length} different ${languageWord} for a total of ${formattedTotal} bytes.
  </text>
  <text x="${padding}" y="132" fill="#8b949e" font-size="15" font-style="italic">
    Results are produced by LinguistJS from public repositories owned by ${escapeXml(username)} and may not be entirely accurate.
  </text>${items}
</svg>
`;
}

function formatPercentage(value) {
  if (value > 0 && value < 0.01) {
    return "&lt;0.01%";
  }
  return `${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%`;
}

function formatBytes(bytes) {
  return `${new Intl.NumberFormat("en-US").format(bytes)} bytes`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
