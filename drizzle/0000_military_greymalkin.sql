CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`ats_type` text,
	`ats_token` text,
	`careers_url` text,
	`tier` integer DEFAULT 3 NOT NULL,
	`discovered_via` text NOT NULL,
	`discovered_at` integer NOT NULL,
	`last_probe_at` integer,
	`active` integer DEFAULT true NOT NULL,
	`blocked` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_slug_uq` ON `companies` (`slug`);--> statement-breakpoint
CREATE INDEX `companies_ats_active_idx` ON `companies` (`ats_type`,`active`);--> statement-breakpoint
CREATE INDEX `companies_blocked_idx` ON `companies` (`blocked`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`title_norm` text NOT NULL,
	`description` text NOT NULL,
	`description_fts` text,
	`location` text,
	`remote_type` text,
	`salary_min` integer,
	`salary_max` integer,
	`salary_period` text,
	`currency` text,
	`seniority` text,
	`stack` text,
	`extraction_tier` text DEFAULT 'none' NOT NULL,
	`posted_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`closed_at` integer,
	`content_hash` text NOT NULL,
	`canonical_id` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`canonical_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_source_id_uq` ON `jobs` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `jobs_company_posted_idx` ON `jobs` (`company_id`,`posted_at`);--> statement-breakpoint
CREATE INDEX `jobs_content_hash_idx` ON `jobs` (`content_hash`);--> statement-breakpoint
CREATE INDEX `jobs_closed_idx` ON `jobs` (`closed_at`);--> statement-breakpoint
CREATE INDEX `jobs_last_seen_idx` ON `jobs` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `jobs_canonical_idx` ON `jobs` (`canonical_id`);