-- Pre-Formulation Library Seed Data
-- World Standard Pre-Formulation Templates
-- Run this after creating tables via Alembic migrations

-- Note: Assumes tenant 'demo' exists and items table has been populated
-- This script inserts GLOBAL templates (tenant_id NULL) and demo tenant items

-- ========== Insert Demo Tenant Items (Ingredients) ==========
-- These should already exist from seed.py, but ensure they exist

-- ========== Insert Global Pre-Formulations ==========

-- 1. Fish → Tilapia Fry/Starter Floating (0.8mm, Extruded, 40-42% protein)
INSERT INTO pre_formulations (
    tenant_id, code, title, category, species, stage, process_type, float_type, 
    pellet_mm, default_batch_kg, protein_target_min, protein_target_max, 
    is_reference_only, is_active, created_at, updated_at
) VALUES (
    NULL, 'FISH-TILAPIA-FRY-001', 'Tilapia Fry Floating Feed 0.8mm', 
    'Fish', 'Tilapia', 'Fry', 'Extruded', 'Floating', 0.8, 1000.0, 
    40.0, 42.0, 1, 1, datetime('now'), datetime('now')
);

-- Get the pre_formulation_id for lines (SQLite doesn't support RETURNING, so we'll use subqueries)
-- For each template, we'll insert lines referencing item names

-- Lines for Tilapia Fry (40-42% protein)
INSERT INTO pre_formulation_lines (
    tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value,
    phase, is_process_aid, sort_order
)
SELECT 
    NULL,
    (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%' LIMIT 1),
    'PERCENT', 25.0, 'Grinding', 0, 1
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Soybean Meal%' LIMIT 1), 'PERCENT', 35.0, 'Mixing', 0, 2
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Soybean Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Fish Meal%' LIMIT 1), 'PERCENT', 15.0, 'Mixing', 0, 3
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Fish Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Wheat Flour%' LIMIT 1), 'PERCENT', 12.0, 'Mixing', 0, 4
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Wheat Flour%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Rice Bran%' LIMIT 1), 'PERCENT', 8.0, 'Mixing', 0, 5
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Rice Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Vitamin%Premix%' OR name LIKE '%Premix%' LIMIT 1), 'PERCENT', 1.0, 'Mixing', 0, 6
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Premix%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Binder%' OR name LIKE '%CMC%' LIMIT 1), 'PERCENT', 2.0, 'Mixing', 0, 7
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Binder%' OR name LIKE '%CMC%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Fish Oil%' LIMIT 1), 'PERCENT', 2.0, 'Coating', 0, 8
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Fish Oil%');

-- 2. Fish → Tilapia Grower Floating (2.5mm, Extruded, 30-32%)
INSERT INTO pre_formulations (tenant_id, code, title, category, species, stage, process_type, float_type, pellet_mm, default_batch_kg, protein_target_min, protein_target_max, is_reference_only, is_active, created_at, updated_at)
VALUES (NULL, 'FISH-TILAPIA-GROWER-001', 'Tilapia Grower Floating Feed 2.5mm', 'Fish', 'Tilapia', 'Grower', 'Extruded', 'Floating', 2.5, 1000.0, 30.0, 32.0, 1, 1, datetime('now'), datetime('now'));

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%' LIMIT 1), 'PERCENT', 35.0, 'Grinding', 0, 1
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Soybean Meal%' LIMIT 1), 'PERCENT', 28.0, 'Mixing', 0, 2
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Soybean Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Fish Meal%' LIMIT 1), 'PERCENT', 10.0, 'Mixing', 0, 3
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Fish Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Rice Bran%' LIMIT 1), 'PERCENT', 15.0, 'Mixing', 0, 4
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Rice Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Wheat Flour%' LIMIT 1), 'PERCENT', 8.0, 'Mixing', 0, 5
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Wheat Flour%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Premix%' LIMIT 1), 'PERCENT', 1.0, 'Mixing', 0, 6
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Premix%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Binder%' OR name LIKE '%CMC%' LIMIT 1), 'PERCENT', 1.5, 'Mixing', 0, 7
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Binder%' OR name LIKE '%CMC%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Fish Oil%' LIMIT 1), 'PERCENT', 1.5, 'Coating', 0, 8
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Fish Oil%');

-- 3. Fish → Tilapia Finisher Floating (5mm, Extruded, 26-28%)
INSERT INTO pre_formulations (tenant_id, code, title, category, species, stage, process_type, float_type, pellet_mm, default_batch_kg, protein_target_min, protein_target_max, is_reference_only, is_active, created_at, updated_at)
VALUES (NULL, 'FISH-TILAPIA-FINISHER-001', 'Tilapia Finisher Floating Feed 5mm', 'Fish', 'Tilapia', 'Finisher', 'Extruded', 'Floating', 5.0, 1000.0, 26.0, 28.0, 1, 1, datetime('now'), datetime('now'));

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FINISHER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%' LIMIT 1), 'PERCENT', 40.0, 'Grinding', 0, 1
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FINISHER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Soybean Meal%' LIMIT 1), 'PERCENT', 25.0, 'Mixing', 0, 2
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Soybean Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FINISHER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Fish Meal%' LIMIT 1), 'PERCENT', 8.0, 'Mixing', 0, 3
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Fish Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FINISHER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Rice Bran%' LIMIT 1), 'PERCENT', 18.0, 'Mixing', 0, 4
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Rice Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FINISHER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Wheat Flour%' LIMIT 1), 'PERCENT', 6.0, 'Mixing', 0, 5
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Wheat Flour%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FINISHER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Premix%' LIMIT 1), 'PERCENT', 1.0, 'Mixing', 0, 6
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Premix%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FINISHER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Binder%' OR name LIKE '%CMC%' LIMIT 1), 'PERCENT', 1.0, 'Mixing', 0, 7
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Binder%' OR name LIKE '%CMC%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-TILAPIA-FINISHER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Fish Oil%' LIMIT 1), 'PERCENT', 1.0, 'Coating', 0, 8
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Fish Oil%');

-- 4. Fish → Carp/Pangas Sinking (Pellet, 24-26%)
INSERT INTO pre_formulations (tenant_id, code, title, category, species, stage, process_type, float_type, pellet_mm, default_batch_kg, protein_target_min, protein_target_max, is_reference_only, is_active, created_at, updated_at)
VALUES (NULL, 'FISH-CARP-SINKING-001', 'Carp/Pangas Sinking Pellet Feed', 'Fish', 'Carp/Pangas', 'Grower', 'Pellet', 'Sinking', 4.0, 1000.0, 24.0, 26.0, 1, 1, datetime('now'), datetime('now'));

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-CARP-SINKING-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%' LIMIT 1), 'PERCENT', 38.0, 'Grinding', 0, 1
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-CARP-SINKING-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Soybean Meal%' LIMIT 1), 'PERCENT', 22.0, 'Mixing', 0, 2
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Soybean Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-CARP-SINKING-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Fish Meal%' LIMIT 1), 'PERCENT', 6.0, 'Mixing', 0, 3
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Fish Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-CARP-SINKING-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Rice Bran%' LIMIT 1), 'PERCENT', 20.0, 'Mixing', 0, 4
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Rice Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-CARP-SINKING-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Wheat Bran%' LIMIT 1), 'PERCENT', 10.0, 'Mixing', 0, 5
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Wheat Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-CARP-SINKING-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Premix%' LIMIT 1), 'PERCENT', 1.0, 'Mixing', 0, 6
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Premix%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-CARP-SINKING-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Binder%' OR name LIKE '%CMC%' LIMIT 1), 'PERCENT', 2.0, 'Mixing', 0, 7
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Binder%' OR name LIKE '%CMC%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'FISH-CARP-SINKING-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Fish Oil%' LIMIT 1), 'PERCENT', 1.0, 'Mixing', 0, 8
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Fish Oil%');

-- 5. Poultry → Broiler Starter (Crumble)
INSERT INTO pre_formulations (tenant_id, code, title, category, species, stage, process_type, float_type, pellet_mm, default_batch_kg, protein_target_min, protein_target_max, is_reference_only, is_active, created_at, updated_at)
VALUES (NULL, 'POULTRY-BROILER-STARTER-001', 'Broiler Starter Crumble Feed', 'Poultry', 'Broiler', 'Starter', 'Crumble', NULL, 2.0, 1000.0, 20.0, 22.0, 1, 1, datetime('now'), datetime('now'));

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-STARTER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%' LIMIT 1), 'PERCENT', 45.0, 'Grinding', 0, 1
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-STARTER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Soybean Meal%' LIMIT 1), 'PERCENT', 28.0, 'Mixing', 0, 2
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Soybean Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-STARTER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Rice Bran%' LIMIT 1), 'PERCENT', 12.0, 'Mixing', 0, 3
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Rice Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-STARTER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Wheat Bran%' LIMIT 1), 'PERCENT', 8.0, 'Mixing', 0, 4
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Wheat Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-STARTER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Sunflower Meal%' LIMIT 1), 'PERCENT', 5.0, 'Mixing', 0, 5
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Sunflower Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-STARTER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Premix%' LIMIT 1), 'PERCENT', 0.5, 'Mixing', 0, 6
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Premix%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-STARTER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Limestone%' OR name LIKE '%Calcium%' LIMIT 1), 'PERCENT', 1.5, 'Mixing', 0, 7
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Limestone%' OR name LIKE '%Calcium%');

-- 6. Poultry → Broiler Grower (Pellet)
INSERT INTO pre_formulations (tenant_id, code, title, category, species, stage, process_type, float_type, pellet_mm, default_batch_kg, protein_target_min, protein_target_max, is_reference_only, is_active, created_at, updated_at)
VALUES (NULL, 'POULTRY-BROILER-GROWER-001', 'Broiler Grower Pellet Feed', 'Poultry', 'Broiler', 'Grower', 'Pellet', NULL, 3.5, 1000.0, 18.0, 20.0, 1, 1, datetime('now'), datetime('now'));

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%' LIMIT 1), 'PERCENT', 50.0, 'Grinding', 0, 1
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Soybean Meal%' LIMIT 1), 'PERCENT', 22.0, 'Mixing', 0, 2
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Soybean Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Rice Bran%' LIMIT 1), 'PERCENT', 15.0, 'Mixing', 0, 3
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Rice Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Wheat Bran%' LIMIT 1), 'PERCENT', 10.0, 'Mixing', 0, 4
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Wheat Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Premix%' LIMIT 1), 'PERCENT', 0.5, 'Mixing', 0, 5
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Premix%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-BROILER-GROWER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Limestone%' OR name LIKE '%Calcium%' LIMIT 1), 'PERCENT', 2.5, 'Mixing', 0, 6
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Limestone%' OR name LIKE '%Calcium%');

-- 7. Poultry → Layer Feed (Mash)
INSERT INTO pre_formulations (tenant_id, code, title, category, species, stage, process_type, float_type, pellet_mm, default_batch_kg, protein_target_min, protein_target_max, is_reference_only, is_active, created_at, updated_at)
VALUES (NULL, 'POULTRY-LAYER-001', 'Layer Feed Mash', 'Poultry', 'Layer', 'Laying', 'Mash', NULL, NULL, 1000.0, 16.0, 18.0, 1, 1, datetime('now'), datetime('now'));

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-LAYER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%' LIMIT 1), 'PERCENT', 55.0, 'Grinding', 0, 1
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-LAYER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Soybean Meal%' LIMIT 1), 'PERCENT', 18.0, 'Mixing', 0, 2
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Soybean Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-LAYER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Rice Bran%' LIMIT 1), 'PERCENT', 12.0, 'Mixing', 0, 3
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Rice Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-LAYER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Wheat Bran%' LIMIT 1), 'PERCENT', 10.0, 'Mixing', 0, 4
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Wheat Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-LAYER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Premix%' LIMIT 1), 'PERCENT', 0.5, 'Mixing', 0, 5
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Premix%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'POULTRY-LAYER-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Limestone%' OR name LIKE '%Calcium%' LIMIT 1), 'PERCENT', 4.5, 'Mixing', 0, 6
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Limestone%' OR name LIKE '%Calcium%');

-- 8. Cattle → Dairy Feed (Pellet)
INSERT INTO pre_formulations (tenant_id, code, title, category, species, stage, process_type, float_type, pellet_mm, default_batch_kg, protein_target_min, protein_target_max, is_reference_only, is_active, created_at, updated_at)
VALUES (NULL, 'CATTLE-DAIRY-001', 'Dairy Cattle Pellet Feed', 'Cattle', 'Dairy', 'Lactating', 'Pellet', NULL, 8.0, 1000.0, 16.0, 18.0, 1, 1, datetime('now'), datetime('now'));

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'CATTLE-DAIRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%' LIMIT 1), 'PERCENT', 40.0, 'Grinding', 0, 1
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'CATTLE-DAIRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Soybean Meal%' LIMIT 1), 'PERCENT', 15.0, 'Mixing', 0, 2
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Soybean Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'CATTLE-DAIRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Rice Bran%' LIMIT 1), 'PERCENT', 20.0, 'Mixing', 0, 3
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Rice Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'CATTLE-DAIRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Wheat Bran%' LIMIT 1), 'PERCENT', 15.0, 'Mixing', 0, 4
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Wheat Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'CATTLE-DAIRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Mustard Oil Cake%' OR name LIKE '%Til Oil Cake%' LIMIT 1), 'PERCENT', 8.0, 'Mixing', 0, 5
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Mustard Oil Cake%' OR name LIKE '%Til Oil Cake%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'CATTLE-DAIRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Premix%' LIMIT 1), 'PERCENT', 0.5, 'Mixing', 0, 6
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Premix%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'CATTLE-DAIRY-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Limestone%' OR name LIKE '%Calcium%' LIMIT 1), 'PERCENT', 1.5, 'Mixing', 0, 7
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Limestone%' OR name LIKE '%Calcium%');

-- 9. Goat/Sheep → Goat/Sheep Feed (Pellet)
INSERT INTO pre_formulations (tenant_id, code, title, category, species, stage, process_type, float_type, pellet_mm, default_batch_kg, protein_target_min, protein_target_max, is_reference_only, is_active, created_at, updated_at)
VALUES (NULL, 'GOAT-SHEEP-001', 'Goat/Sheep Pellet Feed', 'Goat', 'Goat/Sheep', 'Grower', 'Pellet', NULL, 6.0, 1000.0, 14.0, 16.0, 1, 1, datetime('now'), datetime('now'));

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'GOAT-SHEEP-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%' LIMIT 1), 'PERCENT', 35.0, 'Grinding', 0, 1
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Maize%' OR name LIKE '%Yellow Corn%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'GOAT-SHEEP-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Soybean Meal%' LIMIT 1), 'PERCENT', 12.0, 'Mixing', 0, 2
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Soybean Meal%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'GOAT-SHEEP-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Rice Bran%' LIMIT 1), 'PERCENT', 25.0, 'Mixing', 0, 3
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Rice Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'GOAT-SHEEP-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Wheat Bran%' LIMIT 1), 'PERCENT', 20.0, 'Mixing', 0, 4
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Wheat Bran%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'GOAT-SHEEP-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Mustard Oil Cake%' OR name LIKE '%Til Oil Cake%' LIMIT 1), 'PERCENT', 6.0, 'Mixing', 0, 5
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Mustard Oil Cake%' OR name LIKE '%Til Oil Cake%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'GOAT-SHEEP-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Premix%' LIMIT 1), 'PERCENT', 0.5, 'Mixing', 0, 6
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Premix%');

INSERT INTO pre_formulation_lines (tenant_id, pre_formulation_id, ingredient_item_id, inclusion_basis, inclusion_value, phase, is_process_aid, sort_order)
SELECT NULL, (SELECT id FROM pre_formulations WHERE code = 'GOAT-SHEEP-001' AND tenant_id IS NULL),
    (SELECT id FROM items WHERE name LIKE '%Limestone%' OR name LIKE '%Calcium%' LIMIT 1), 'PERCENT', 1.5, 'Mixing', 0, 7
WHERE EXISTS (SELECT 1 FROM items WHERE name LIKE '%Limestone%' OR name LIKE '%Calcium%');





