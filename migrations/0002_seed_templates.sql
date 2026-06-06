-- Seed initial active templates for all four event types. Leaders edit from
-- here. Backpacking list is roughly the lighterpack reference from r/2ysfob.
-- Idempotent-ish: only inserts when no active template exists for that type.

-- ---------- Backpacking ----------
INSERT INTO templates (id, event_type, name, is_active, updated_by)
SELECT 'tpl-bp-seed', 'backpacking', 'Backpacking — standard', 1, 'seed@scoutpack'
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE event_type = 'backpacking' AND is_active = 1);

INSERT INTO template_items (id, template_id, name, category, default_qty, is_worn, is_consumable, match_key, sort_order)
SELECT * FROM (VALUES
  ('ti-bp-01','tpl-bp-seed','Backpack (50L+)',           'Hiking Gear',   1, 0, 0, 'backpack',         10),
  ('ti-bp-02','tpl-bp-seed','Trekking poles',            'Hiking Gear',   1, 0, 0, 'trekking_poles',   20),
  ('ti-bp-03','tpl-bp-seed','Headlamp',                  'Hiking Gear',   1, 0, 0, 'headlamp',         30),
  ('ti-bp-04','tpl-bp-seed','Water bladder / bottles',   'Hiking Gear',   1, 0, 0, 'water_bladder',    40),
  ('ti-bp-05','tpl-bp-seed','Compass',                   'Hiking Gear',   1, 0, 0, 'compass',          50),
  ('ti-bp-06','tpl-bp-seed','Water filter',              'Mess Kit',      1, 0, 0, 'water_filter',     60),
  ('ti-bp-07','tpl-bp-seed','Stove',                     'Mess Kit',      1, 0, 0, 'stove',            70),
  ('ti-bp-08','tpl-bp-seed','Pot',                       'Mess Kit',      1, 0, 0, 'pot',              80),
  ('ti-bp-09','tpl-bp-seed','Spork',                     'Mess Kit',      1, 0, 0, 'spork',            90),
  ('ti-bp-10','tpl-bp-seed','Tent / shelter',            'Sleep System',  1, 0, 0, 'tent',            100),
  ('ti-bp-11','tpl-bp-seed','Sleeping bag',              'Sleep System',  1, 0, 0, 'sleeping_bag',    110),
  ('ti-bp-12','tpl-bp-seed','Sleeping pad',              'Sleep System',  1, 0, 0, 'sleeping_pad',    120),
  ('ti-bp-13','tpl-bp-seed','Rain jacket',               'Clothing',      1, 0, 0, 'rain_jacket',     130),
  ('ti-bp-14','tpl-bp-seed','Insulating layer',          'Clothing',      1, 0, 0, 'insulating_layer',140),
  ('ti-bp-15','tpl-bp-seed','Base layers',               'Clothing',      1, 0, 0, 'base_layers',     150),
  ('ti-bp-16','tpl-bp-seed','Hiking socks',              'Clothing',      2, 0, 0, 'hiking_socks',    160),
  ('ti-bp-17','tpl-bp-seed','Hiking boots',              'Clothing',      1, 1, 0, 'hiking_boots',    170),
  ('ti-bp-18','tpl-bp-seed','First aid kit',             'Personal',      1, 0, 0, 'first_aid_kit',   180),
  ('ti-bp-19','tpl-bp-seed','Toiletries',                'Personal',      1, 0, 0, 'toiletries',      190),
  ('ti-bp-20','tpl-bp-seed','Food (per day)',            'Personal',      1, 0, 1, 'food',            200)
);

-- ---------- Car Camping ----------
INSERT INTO templates (id, event_type, name, is_active, updated_by)
SELECT 'tpl-cc-seed', 'car_camping', 'Car Camping — standard', 1, 'seed@scoutpack'
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE event_type = 'car_camping' AND is_active = 1);

INSERT INTO template_items (id, template_id, name, category, default_qty, is_worn, is_consumable, match_key, sort_order)
SELECT * FROM (VALUES
  ('ti-cc-01','tpl-cc-seed','Tent',                  'Sleep System',  1, 0, 0, 'tent',          10),
  ('ti-cc-02','tpl-cc-seed','Sleeping bag',          'Sleep System',  1, 0, 0, 'sleeping_bag',  20),
  ('ti-cc-03','tpl-cc-seed','Sleeping pad / cot',    'Sleep System',  1, 0, 0, 'sleeping_pad',  30),
  ('ti-cc-04','tpl-cc-seed','Pillow',                'Sleep System',  1, 0, 0, 'pillow',        40),
  ('ti-cc-05','tpl-cc-seed','Camp chair',            'Camp',          1, 0, 0, 'camp_chair',    50),
  ('ti-cc-06','tpl-cc-seed','Headlamp / flashlight', 'Camp',          1, 0, 0, 'headlamp',      60),
  ('ti-cc-07','tpl-cc-seed','Mess kit',              'Mess Kit',      1, 0, 0, 'mess_kit',      70),
  ('ti-cc-08','tpl-cc-seed','Water bottle',          'Hiking Gear',   1, 0, 0, 'water_bottle',  80),
  ('ti-cc-09','tpl-cc-seed','Class B uniform',       'Clothing',      1, 0, 0, 'class_b',       90),
  ('ti-cc-10','tpl-cc-seed','Rain jacket',           'Clothing',      1, 0, 0, 'rain_jacket',  100),
  ('ti-cc-11','tpl-cc-seed','Warm layer',            'Clothing',      1, 0, 0, 'warm_layer',   110),
  ('ti-cc-12','tpl-cc-seed','Toiletries',            'Personal',      1, 0, 0, 'toiletries',   120),
  ('ti-cc-13','tpl-cc-seed','Scout handbook',        'Personal',      1, 0, 0, 'scout_handbook',130)
);

-- ---------- Summer Camp ----------
INSERT INTO templates (id, event_type, name, is_active, updated_by)
SELECT 'tpl-sc-seed', 'summer_camp', 'Summer Camp — standard', 1, 'seed@scoutpack'
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE event_type = 'summer_camp' AND is_active = 1);

INSERT INTO template_items (id, template_id, name, category, default_qty, is_worn, is_consumable, match_key, sort_order)
SELECT * FROM (VALUES
  ('ti-sc-01','tpl-sc-seed','Duffel bag',           'Pack',          1, 0, 0, 'duffel',         10),
  ('ti-sc-02','tpl-sc-seed','Sleeping bag',         'Sleep System',  1, 0, 0, 'sleeping_bag',   20),
  ('ti-sc-03','tpl-sc-seed','Sleeping pad',         'Sleep System',  1, 0, 0, 'sleeping_pad',   30),
  ('ti-sc-04','tpl-sc-seed','Pillow',               'Sleep System',  1, 0, 0, 'pillow',         40),
  ('ti-sc-05','tpl-sc-seed','Class A uniform',      'Clothing',      1, 0, 0, 'class_a',        50),
  ('ti-sc-06','tpl-sc-seed','Class B shirts',       'Clothing',      5, 0, 0, 'class_b',        60),
  ('ti-sc-07','tpl-sc-seed','Shorts / pants',       'Clothing',      5, 0, 0, 'pants',          70),
  ('ti-sc-08','tpl-sc-seed','Underwear',            'Clothing',      7, 0, 0, 'underwear',      80),
  ('ti-sc-09','tpl-sc-seed','Socks',                'Clothing',      7, 0, 0, 'socks',          90),
  ('ti-sc-10','tpl-sc-seed','Swim suit',            'Clothing',      1, 0, 0, 'swim_suit',     100),
  ('ti-sc-11','tpl-sc-seed','Rain jacket',          'Clothing',      1, 0, 0, 'rain_jacket',   110),
  ('ti-sc-12','tpl-sc-seed','Hiking boots',         'Clothing',      1, 0, 0, 'hiking_boots',  120),
  ('ti-sc-13','tpl-sc-seed','Sneakers',             'Clothing',      1, 0, 0, 'sneakers',      130),
  ('ti-sc-14','tpl-sc-seed','Headlamp / flashlight','Camp',          1, 0, 0, 'headlamp',      140),
  ('ti-sc-15','tpl-sc-seed','Water bottle',         'Hiking Gear',   1, 0, 0, 'water_bottle',  150),
  ('ti-sc-16','tpl-sc-seed','Mess kit',             'Mess Kit',      1, 0, 0, 'mess_kit',      160),
  ('ti-sc-17','tpl-sc-seed','Toiletries',           'Personal',      1, 0, 0, 'toiletries',    170),
  ('ti-sc-18','tpl-sc-seed','Sunscreen',            'Personal',      1, 0, 1, 'sunscreen',     180),
  ('ti-sc-19','tpl-sc-seed','Bug spray',            'Personal',      1, 0, 1, 'bug_spray',     190),
  ('ti-sc-20','tpl-sc-seed','Scout handbook',       'Personal',      1, 0, 0, 'scout_handbook',200),
  ('ti-sc-21','tpl-sc-seed','Merit badge supplies', 'Personal',      1, 0, 0, 'merit_badge',   210)
);

-- ---------- Day Hike ----------
INSERT INTO templates (id, event_type, name, is_active, updated_by)
SELECT 'tpl-dh-seed', 'day_hike', 'Day Hike — Ten Essentials', 1, 'seed@scoutpack'
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE event_type = 'day_hike' AND is_active = 1);

INSERT INTO template_items (id, template_id, name, category, default_qty, is_worn, is_consumable, match_key, sort_order)
SELECT * FROM (VALUES
  ('ti-dh-01','tpl-dh-seed','Day pack',            'Hiking Gear', 1, 0, 0, 'day_pack',       10),
  ('ti-dh-02','tpl-dh-seed','Water bottle',        'Hiking Gear', 2, 0, 0, 'water_bottle',   20),
  ('ti-dh-03','tpl-dh-seed','Map / compass',       'Hiking Gear', 1, 0, 0, 'compass',        30),
  ('ti-dh-04','tpl-dh-seed','Headlamp',            'Hiking Gear', 1, 0, 0, 'headlamp',       40),
  ('ti-dh-05','tpl-dh-seed','First aid kit',       'Personal',    1, 0, 0, 'first_aid_kit',  50),
  ('ti-dh-06','tpl-dh-seed','Fire starter',        'Personal',    1, 0, 0, 'fire_starter',   60),
  ('ti-dh-07','tpl-dh-seed','Pocket knife',        'Personal',    1, 0, 0, 'pocket_knife',   70),
  ('ti-dh-08','tpl-dh-seed','Sun protection',      'Personal',    1, 0, 0, 'sun_protection', 80),
  ('ti-dh-09','tpl-dh-seed','Lunch / snacks',      'Personal',    1, 0, 1, 'food',           90),
  ('ti-dh-10','tpl-dh-seed','Rain jacket',         'Clothing',    1, 0, 0, 'rain_jacket',   100),
  ('ti-dh-11','tpl-dh-seed','Warm layer',          'Clothing',    1, 0, 0, 'warm_layer',    110),
  ('ti-dh-12','tpl-dh-seed','Hiking boots',        'Clothing',    1, 1, 0, 'hiking_boots',  120),
  ('ti-dh-13','tpl-dh-seed','Whistle',             'Personal',    1, 0, 0, 'whistle',       130)
);
