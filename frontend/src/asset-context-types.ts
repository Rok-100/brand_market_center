export type TimecodeNote = { id: string; text: string; time_ms: number; actor_name: string; etag: string; created_at: string }
export type TimecodeNotes = { revision: number; items: TimecodeNote[] }
export type AssetContext = {
  asset_id: number; etag: string; can_annotate: boolean; history_note: string;
  notes: TimecodeNotes;
  reviews: { id: string; version: number; status: string; filename: string; submitted_at: string | null }[];
  task_versions: { task_id: string; version: number; asset_id: number; created_at: string }[];
  pushes: { channel: string; id: string; status: string; created_at: string }[];
  returns: { status: string; sha256: string; workstation_type: string; remix_task_id: string; completed_at: string | null }[];
}
