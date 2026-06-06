-- Per-event override of the gear-tracker's event type. Leaders set this on
-- the dashboard to override (or supply) what the summary-keyword heuristic
-- inferred from the calendar event. event_id is a foreign reference into
-- calendar-db (not enforced; cross-DB).

CREATE TABLE event_gear_types (
  event_id  TEXT PRIMARY KEY,
  gear_type TEXT NOT NULL CHECK (gear_type IN
    ('summer_camp','car_camping','backpacking','day_hike')),
  set_by    TEXT NOT NULL,
  set_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
