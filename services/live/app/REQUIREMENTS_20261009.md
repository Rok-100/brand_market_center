# 2026-10-09 integrated requirements

Includes training attendance editing (requirement 1), assistant rankings (requirement 2), and contribution synchronization (requirement 4).

Training attendance is stored in local anchor profiles. Unchecking an attendee remains a draft until saved; only the checkbox cancels attendance. Profile details retain course progress.

Assistant rankings read Feishu Bitable sources and persist local snapshots. Enable ASSISTANT_RANKINGS_ENABLED and ASSISTANT_RANKINGS_SCHEDULER_ENABLED for daily 16:00 Asia/Shanghai updates. Never deploy LOCAL_SIMULATION or ASSISTANT_RANKINGS_FIXTURE_FILE production settings.

Contribution synchronization requires CONTRIBUTION_SYNC_ENABLED=true and edit access to the target Feishu sheet. The 10:00 Asia/Shanghai task updates existing named rows only, preserves formula columns, and stops on detected source or target inconsistencies. Keep a single scheduler instance. Prepare missing anchor rows with formulas before enabling synchronization.

Back up persistent application data before deployment; preserve existing environment credentials. Deployment and write permissions must be verified separately. Feature acceptance does not enable production schedules automatically.

Validation: 31 backend tests passed under Node 22, including captured read-only assistant records. Captured records and credentials are excluded from this repository.
