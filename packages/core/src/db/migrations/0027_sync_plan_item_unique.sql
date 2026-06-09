CREATE UNIQUE INDEX `idx_sync_plan_items_plan_kind_target` ON `sync_plan_items` (`sync_plan_id`,`kind`,`target_id`,`target_key`);
