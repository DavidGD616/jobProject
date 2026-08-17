ALTER TABLE `source_polls` ADD `next_poll_at` integer;--> statement-breakpoint
ALTER TABLE `source_polls` ADD `last_status` text;--> statement-breakpoint
CREATE INDEX `source_polls_source_due_idx` ON `source_polls` (`source`,`next_poll_at`);