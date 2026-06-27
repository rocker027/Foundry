import {
  mkdirSync, readFileSync, writeFileSync, existsSync, cpSync, readdirSync, copyFileSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { validateSlug, assertPathWithinRoot } from './security.mjs';
import { insertSkillVersion } from './db.mjs';
import { isLegacySkillSlug, isExcludedSkill, isOmxPluginSkill } from './skill-filter.mjs';
import { gitDiffInSkillsRoot, isGitRepo } from './git.mjs';

export const FOUNDRY_DIR = '.foundry';
export const MANIFEST_FILE = 'manifest.json';

/** skill 目錄下的 .foundry 路徑 */
export function skillFoundryDir(skillDir) {
  return join(skillDir, FOUNDRY_DIR);
}

/** 版本目錄路徑 */
export function versionDir(skillDir, version) {
  return join(skillFoundryDir(skillDir), 'versions', `v${version}`);
}

/** manifest 檔案路徑 */
export function manifestPath(skillDir) {
  return join(skillFoundryDir(skillDir), MANIFEST_FILE);
}

/** 讀取 manifest，不存在則回傳 null */
export function readManifest(skillDir) {
  const path = manifestPath(skillDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** 寫入 manifest */
export function writeManifest(skillDir, manifest) {
  const dir = skillFoundryDir(skillDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(manifestPath(skillDir), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** 建立初始 manifest */
export function createInitialManifest(slug, { evolutionType = 'ADOPTED', sessionId = null } = {}) {
  const now = new Date().toISOString();
  return {
    slug,
    current_version: 1,
    adopted_at: now,
    locked: false,
    evolution_policy: 'human_gated',
    versions: [{
      version: 1,
      created_at: now,
      evolution_type: evolutionType,
      session_id: sessionId,
      confidence: 1.0,
    }],
  };
}

/** 是否鎖定不可演化 */
export function isSkillLocked(manifest, force = false) {
  if (force) return false;
  return Boolean(manifest?.locked);
}

/** 複製當前 skill 內容到版本目錄 */
export function copySkillToVersionDir(skillDir, targetVersionDir) {
  mkdirSync(targetVersionDir, { recursive: true });
  const skillMd = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    throw new Error(`SKILL.md not found in ${skillDir}`);
  }
  copyFileSync(skillMd, join(targetVersionDir, 'SKILL.md'));

  const provenanceSrc = join(skillDir, '.provenance.json');
  if (existsSync(provenanceSrc)) {
    copyFileSync(provenanceSrc, join(targetVersionDir, '.provenance.json'));
  }

  const manifest = readManifest(skillDir);
  if (manifest) {
    writeFileSync(
      join(targetVersionDir, '.manifest-snapshot.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
  }
}

/**
 * 封存當前版本至 .foundry/versions/v{N}/
 * @returns {{ version: number, snapshotPath: string, manifest: object }}
 */
export function snapshotCurrentVersion(slug, skillsRoot, {
  evolutionType = 'FIX',
  sessionId = null,
  experienceId = null,
  summary = null,
  db = null,
} = {}) {
  validateSlug(slug);
  const skillDir = join(skillsRoot, slug);
  assertPathWithinRoot(skillDir, skillsRoot);

  if (!existsSync(join(skillDir, 'SKILL.md'))) {
    throw new Error(`Cannot snapshot: SKILL.md missing for ${slug}`);
  }

  let manifest = readManifest(skillDir);
  if (!manifest) {
    manifest = createInitialManifest(slug, { evolutionType: 'ADOPTED' });
    const v1Dir = versionDir(skillDir, 1);
    copySkillToVersionDir(skillDir, v1Dir);
    manifest.versions = [{
      version: 1,
      created_at: manifest.adopted_at,
      evolution_type: 'ADOPTED',
      session_id: null,
      confidence: 1.0,
    }];
    manifest.current_version = 1;
    writeManifest(skillDir, manifest);
    if (db) {
      insertSkillVersion(db, {
        slug,
        version: 1,
        evolutionType: 'ADOPTED',
        sessionId: null,
        experienceId: null,
        snapshotPath: v1Dir,
        summary: 'Baseline snapshot',
      });
    }
  }

  const nextVersion = manifest.current_version + 1;
  const snapDir = versionDir(skillDir, nextVersion);
  copySkillToVersionDir(skillDir, snapDir);

  const now = new Date().toISOString();
  manifest.versions.push({
    version: nextVersion,
    created_at: now,
    evolution_type: evolutionType,
    session_id: sessionId,
    experience_id: experienceId,
    confidence: evolutionType === 'ROLLBACK' ? 1.0 : 0.7,
    summary,
  });
  manifest.current_version = nextVersion;
  writeManifest(skillDir, manifest);

  if (db) {
    insertSkillVersion(db, {
      slug,
      version: nextVersion,
      evolutionType,
      sessionId,
      experienceId,
      snapshotPath: snapDir,
      summary,
    });
  }

  return { version: nextVersion, snapshotPath: snapDir, manifest };
}

/** 將版本目錄內容還原為 current SKILL.md */
export function restoreVersionToCurrent(slug, skillsRoot, version) {
  validateSlug(slug);
  const skillDir = join(skillsRoot, slug);
  const srcDir = versionDir(skillDir, version);
  const skillMd = join(srcDir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    throw new Error(`Version v${version} SKILL.md not found for ${slug}`);
  }
  copyFileSync(skillMd, join(skillDir, 'SKILL.md'));
  const provSrc = join(srcDir, '.provenance.json');
  if (existsSync(provSrc)) {
    copyFileSync(provSrc, join(skillDir, '.provenance.json'));
  }
}

/** 寫入 git diff 到版本目錄 */
export function writeVersionDiff(skillsRoot, slug, versionNum, diff) {
  const skillDir = join(skillsRoot, slug);
  const diffPath = join(versionDir(skillDir, versionNum), 'PROMOTE.diff');
  writeFileSync(diffPath, diff || '# No diff\n', 'utf8');
}

/** 掃描 skills root 取得可 adopt 的 slug 列表 */
export function discoverSkillSlugs(skillsRoot, { excludeDeprecated = true } = {}) {
  const slugs = [];
  if (!existsSync(skillsRoot)) return slugs;

  function walk(dir, depth = 0) {
    if (depth > 4) return;
    if (excludeDeprecated && dir.includes(`${FOUNDRY_DIR}`)) return;
    if (excludeDeprecated && /[/\\]_deprecated[/\\]/.test(dir)) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const full = join(dir, ent.name);
      if (excludeDeprecated && ent.name === '_deprecated') continue;
      if (excludeDeprecated && ent.name === FOUNDRY_DIR) continue;

      const skillMd = join(full, 'SKILL.md');
      if (existsSync(skillMd)) {
        const slug = basename(full);
        if (isExcludedSkill(slug)) continue;
        try {
          validateSlug(slug);
          slugs.push({ slug, dir: full, skillMd });
        } catch {
          // 略過無效 slug
        }
      } else {
        walk(full, depth + 1);
      }
    }
  }

  walk(skillsRoot);
  return slugs;
}

/** 單一 skill adopt：建立 v1 baseline */
export function adoptSkill(slug, skillsRoot, { db = null, dryRun = false } = {}) {
  validateSlug(slug);
  const skillDir = join(skillsRoot, slug);
  const skillMd = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    throw new Error(`SKILL.md not found: ${skillMd}`);
  }

  const existing = readManifest(skillDir);
  if (existing?.current_version >= 1) {
    return { slug, status: 'skipped', reason: 'already adopted', version: existing.current_version };
  }

  if (dryRun) {
    return { slug, status: 'would_adopt', version: 1 };
  }

  const manifest = createInitialManifest(slug);
  const v1Dir = versionDir(skillDir, 1);
  copySkillToVersionDir(skillDir, v1Dir);
  writeManifest(skillDir, manifest);

  if (db) {
    insertSkillVersion(db, {
      slug,
      version: 1,
      evolutionType: 'ADOPTED',
      sessionId: null,
      experienceId: null,
      snapshotPath: v1Dir,
      summary: 'Initial adopt baseline',
    });
  }

  let diff = '';
  if (isGitRepo(skillsRoot)) {
    diff = gitDiffInSkillsRoot(skillsRoot, slug);
    writeVersionDiff(skillsRoot, slug, 1, diff);
  }

  return { slug, status: 'adopted', version: 1, snapshotPath: v1Dir };
}

/** 讀取版本 SKILL.md 內容 */
export function readVersionSkillContent(slug, skillsRoot, versionLabel) {
  validateSlug(slug);
  const skillDir = join(skillsRoot, slug);
  if (versionLabel === 'current') {
    return readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  }
  const match = /^v(\d+)$/.exec(versionLabel);
  if (!match) throw new Error(`Invalid version label: ${versionLabel}`);
  const vPath = join(versionDir(skillDir, Number(match[1])), 'SKILL.md');
  if (!existsSync(vPath)) throw new Error(`Version not found: ${versionLabel}`);
  return readFileSync(vPath, 'utf8');
}

/** 簡易行級 diff */
export function diffSkillContent(fromText, toText) {
  const fromLines = fromText.split('\n');
  const toLines = toText.split('\n');
  const lines = ['--- from', '+++ to', ''];
  const max = Math.max(fromLines.length, toLines.length);
  for (let i = 0; i < max; i += 1) {
    const a = fromLines[i];
    const b = toLines[i];
    if (a === b) continue;
    if (a !== undefined) lines.push(`- ${a}`);
    if (b !== undefined) lines.push(`+ ${b}`);
  }
  return lines.join('\n');
}

/** 將草稿目錄複製/合併到 skill 目錄 */
export function applyDraftToSkill(slug, skillsRoot, draftDir, evolutionType) {
  validateSlug(slug);
  const destDir = join(skillsRoot, slug);
  assertPathWithinRoot(destDir, skillsRoot);

  if (evolutionType === 'CAPTURED' || evolutionType === 'DERIVED') {
    mkdirSync(destDir, { recursive: true });
    cpSync(draftDir, destDir, { recursive: true, force: true });
    return destDir;
  }

  if (evolutionType === 'FIX') {
    mkdirSync(destDir, { recursive: true });
    const draftSkill = join(draftDir, 'SKILL.md');
    if (!existsSync(draftSkill)) {
      throw new Error(`Draft SKILL.md not found: ${draftSkill}`);
    }
    copyFileSync(draftSkill, join(destDir, 'SKILL.md'));
    const draftProv = join(draftDir, '.provenance.json');
    if (existsSync(draftProv)) {
      copyFileSync(draftProv, join(destDir, '.provenance.json'));
    }
    const changelog = join(draftDir, 'CHANGELOG.md');
    if (existsSync(changelog)) {
      copyFileSync(changelog, join(destDir, 'CHANGELOG.md'));
    }
    return destDir;
  }

  throw new Error(`Unknown evolution type: ${evolutionType}`);
}
