-- Add product-level group_name and strain_type columns.
--
-- group_name  — merchandising group shown only for Vape / Flowers / Edibles
--               (e.g. Vape → Exhale 1g/2g, ExClub, Montana). NULL = ungrouped.
-- strain_type — Sativa / Indica / Hybrid / Sativa Hybrid / Indica Hybrid,
--               shown only for the same supported categories. NULL = unset.
--
-- Both are free-text/nullable; the dashboard editor constrains the values it
-- writes per category, and the storefront reads them for grouping/labelling.

alter table public.products add column if not exists group_name  text;
alter table public.products add column if not exists strain_type text;
