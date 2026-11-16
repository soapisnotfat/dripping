export type Locale = 'zh' | 'en';
export type TrackRole = 'backing' | 'demo' | 'recording';
export type Anchor = {q: number; seconds: number};
export type ScoreNote = {
  id: string; part: string; measure: number; onset: number; duration: number;
  midi: number | null; writtenMidi: number | null; voice: string; staff: number;
  grace: boolean; tieStart: boolean; tieStop: boolean;
};
export type ScoreMeasure = {
  index: number; number: string; q: number; duration: number; beats: number; beatType: number;
  notes: ScoreNote[]; repeatStart: boolean; repeatEnd: number;
  endings: number[]; tempo: {offset: number; bpm: number}[];
  segno?: string; coda?: string; jump?: 'dc' | 'ds'; jumpLabel?: string; toCoda?: string; fine?: boolean;
};
export type ScorePart = {id: string; name: string; measures: ScoreMeasure[]};
export type ScoreOccurrence = {id: string; measure: number; number: string; q: number; duration: number; pass: number};
export type ScoreEvent = ScoreNote & {q: number; occurrence: string};
export type Score = {
  title: string; composer: string; partId: string; parts: {id: string; name: string}[];
  measures: ScoreMeasure[]; route: ScoreOccurrence[]; events: ScoreEvent[];
  tempo: {q: number; bpm: number}[]; totalQ: number; warnings: string[]; tempoMissing?: boolean;
};
export type Alignment = {
  anchors: Anchor[]; status: 'estimated' | 'candidate' | 'accepted';
  method: 'score-tempo' | 'chroma-dtw' | 'manual' | 'reference';
  cost?: number; coverage?: number; warnings: string[];
  manualAnchors?: number[];
  reference?: {kind:'score-part'|'score-parts'|'demo'|'manual';scoreSignature:string;partIds:string[];pitch:'xml'|'concert'|'unspecified';sampleRate:number;demoTrackId?:string;demoMapSignature?:string};
  assessment?: {basis:'score-notes'|'shared-accompaniment';decision:'supported'|'review'|'insufficient'|'ambiguous';supportedFraction:number;reasons:string[];points:{q:number;sourceSample:number;midi:number[];support:number;attack:number}[]};
};
export type Clip = {
  id: string; assetId: string; label: string; start: number; end: number;
  sourceStart: number; rate: number; gain: number; fadeIn: number; fadeOut: number;
  timeMap?: {time:number;source:number}[];
};
export type Track = {
  id: string; name: string; role: TrackRole; sourceAssetId?: string;
  volume: number; pan: number; mute: boolean; solo: boolean; offset: number;
  clips: Clip[]; alignment?: Alignment; color: number;
};
export type Take = {
  id: string; name: string; assetId: string; trackId: string; start: number; end: number;
  speed: number; sampleRate: number; channels: number; createdAt: string;
  inputLabel: string; latencyMs: number; interrupted: boolean;
};
export type EditState = {tracks: Track[]; selection: Selection | null; scoreMap?: Anchor[]; referenceTrackId?: string;scoreXml?:string;partId?:string;position?:number};
export type EditCommand = {label: string; before: EditState; after: EditState};
export type Selection = {start: number; end: number; trackId?: string; clipId?: string};
export type Project = {
  id: string; schemaVersion: 1; name: string; createdAt: string; updatedAt: string;
  scoreXml?: string; scoreAssetId?: string; score?: Score; referenceTrackId?: string;
  scoreMap: Anchor[]; tracks: Track[]; takes: Take[]; assetIds: string[];
  speed: number; position: number; selection: Selection | null; loop: boolean;
  masterGainDb?: number;
  undo: EditCommand[]; redo: EditCommand[]; revision: number;
};
export type Asset = {
  id: string; projectId: string; name: string; type: string; blob: Blob;
  sampleRate?: number; frames?: number; channels?: number;
};
export type PCM = {channels: Float32Array[]; sampleRate: number};
export type RecordingSession = {
  id: string; projectId: string; trackId: string; name: string; start: number;
  speed: number; sampleRate: number; channels: number; createdAt: string;
  inputLabel: string; latencyMs: number; chunks: number; frames: number;
};
export type RecordingChunk = {id: string; sessionId: string; sequence: number; data: Float32Array[]};
export const uid = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
