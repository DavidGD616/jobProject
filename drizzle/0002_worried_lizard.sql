CREATE TABLE `source_polls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`source` text NOT NULL,
	`etag` text,
	`last_fetched_at` integer,
	`last_successful_at` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_polls_company_source_uq` ON `source_polls` (`company_id`,`source`);--> statement-breakpoint
CREATE INDEX `source_polls_source_fetched_idx` ON `source_polls` (`source`,`last_fetched_at`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `missing_since_at` integer;--> statement-breakpoint
CREATE INDEX `jobs_missing_idx` ON `jobs` (`missing_since_at`) WHERE closed_at IS NULL AND missing_since_at IS NOT NULL;