import type { Asset, Project } from './types';
import { clone, uid } from './types';
import { getAsset } from './storage';
import { parseScore } from './score';
import { tempoMap } from './time';
import { scoreTempoProject } from './score-time';
import type { PreparedScore } from './pdf-import';
export async function pdfFiles(project: Project): Promise<File[]> {
  const ids = project.pdfSource?.assetIds || project.scoreConversion?.originalAssetIds || [];
  return Promise.all(
    ids.map(async (id) => {
      const asset = await getAsset(id);
      if (asset.projectId !== project.id) throw Error('PDF project mismatch');
      return new File([asset.blob], asset.name, { type: 'application/pdf' });
    }),
  );
}
export async function unrecognizedPdfPages(
  projectId: string,
  auditAssetId: string,
): Promise<number[]> {
  const asset = await getAsset(auditAssetId);
  if (asset.projectId !== projectId) throw Error('PDF conversion audit project mismatch');
  const audit: { pages?: unknown[]; recognition?: { metadata?: unknown[] } } | null = JSON.parse(
    await asset.blob.text(),
  );
  if (!Array.isArray(audit?.pages) || !Array.isArray(audit.recognition?.metadata)) return [];
  const unread = new Set<number>();
  for (const record of audit.recognition.metadata) {
    const item = record as { kind?: string; source?: string; page?: number } | null;
    // SheetScan records this fallback only when the Worker returned no staff layout for the page.
    if (
      item?.kind === 'staff-evidence' &&
      item.source === 'horizontal-five-line-image' &&
      typeof item.page === 'number' &&
      Number.isInteger(item.page) &&
      item.page >= 0 &&
      item.page < audit.pages.length
    )
      unread.add(item.page + 1);
  }
  return [...unread].sort((a, b) => a - b);
}

export function attachPdfScore(
  project: Project,
  sourceId: string,
  result: PreparedScore,
): { project: Project; assets: Asset[] } | null {
  const source = project.pdfSource;
  if (!source || source.id !== sourceId || source.state !== 'pending' || project.scoreXml)
    return null;
  const p = clone(project),
    score = parseScore(result.xml),
    xmlId = uid(),
    auditId = uid();
  p.scoreXml = result.xml;
  p.score = score;
  p.scoreMap = tempoMap(score);
  p.scoreAssetId = xmlId;
  p.pdfSource = { ...source, state: 'complete', error: undefined };
  p.scoreConversion = {
    ...result.provenance,
    originalAssetIds: [...source.assetIds],
    musicxmlAssetId: xmlId,
    auditAssetId: auditId,
  };
  p.assetIds = [...new Set([...p.assetIds, xmlId, auditId])];
  return {
    project: scoreTempoProject(p),
    assets: [
      {
        id: xmlId,
        projectId: p.id,
        name: result.musicxml.name,
        type: result.musicxml.type,
        blob: result.musicxml,
      },
      {
        id: auditId,
        projectId: p.id,
        name: 'score-conversion.json',
        type: 'application/json',
        blob: result.audit,
      },
    ],
  };
}
export function pdfFailure(
  error: unknown,
): NonNullable<NonNullable<Project['pdfSource']>['error']> {
  const detail = error as {
    message?: string;
    code?: string;
    resourceURL?: string;
    attempts?: number;
  };
  return {
    message: String(detail?.message || error).slice(0, 4000),
    code: typeof detail?.code === 'string' ? detail.code : undefined,
    resourceURL: typeof detail?.resourceURL === 'string' ? detail.resourceURL : undefined,
    attempts: Number.isInteger(detail?.attempts) ? detail.attempts : undefined,
  };
}
