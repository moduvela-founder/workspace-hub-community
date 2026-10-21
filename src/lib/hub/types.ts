export type AssetKind = 'product' | 'tool' | 'framework' | 'workflow' | 'skill' | 'ai' | 'reference';
export type Stage = 'intention' | 'research' | 'design' | 'implementation' | 'validation' | 'delivered' | 'unknown';
export type Activity = 'active' | 'blocked' | 'paused' | 'maintenance' | 'archived' | 'unknown';
export type Readiness = 'unimplemented' | 'unverified' | 'partial' | 'verified' | 'unknown';
export interface HubAsset {
  id: string;
  kind: AssetKind;
  title: string;
  workspace: string;
  summary: string;
  goal?: string;
  stage: Stage;
  activity?: Activity;
  readiness?: Readiness;
  priority?: 'high' | 'normal' | 'low';
  ownerPath: string | null;
  entrypoint: string | null;
  statusFile: string | null;
  manualStepsFile: string | null;
  tags: string[];
  repositoryIds: string[];
  uses: string[];
  sources: { path?: string; note: string; checkedAt?: string }[];
  confirmedAt: string | null;
  startedAt: string | null;
  documentState: 'confirmed' | 'missing' | 'unregistered' | 'invalid';
  manualSteps: { pending: number; completed: number; items: string[]; available: boolean };
  warnings: string[];
}
export interface HubRepository {
  id: string;
  title: string;
  path: string;
  remoteHint?: string;
  checkouts: { path: string; role: string }[];
}
export interface HubCatalog {
  hubRoot?: string;
  assets: HubAsset[];
  repositories: HubRepository[];
  discoveries: { path: string; title: string; workspace: string }[];
  generatedAt: string;
  rulesFingerprint: string;
  warnings: string[];
}
