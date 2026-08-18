CREATE TABLE `matches` (
	`job_id` integer NOT NULL,
	`profile_id` integer NOT NULL,
	`profile_version` integer NOT NULL,
	`lexical_score` real NOT NULL,
	`feature_score` real NOT NULL,
	`retrieval_score` real NOT NULL,
	`llm_score` integer,
	`reasoning` text,
	`gaps` text NOT NULL,
	`strengths` text NOT NULL,
	`flags` text NOT NULL,
	`provider` text,
	`model` text,
	`cli_version` text,
	`scored_at` integer NOT NULL,
	PRIMARY KEY(`job_id`, `profile_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matches_profile_score_idx` ON `matches` (`profile_id`,`retrieval_score`);--> statement-breakpoint
CREATE INDEX `matches_profile_llm_idx` ON `matches` (`profile_id`,`llm_score`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`resume_json` text NOT NULL,
	`skills` text NOT NULL,
	`title_aliases` text NOT NULL,
	`skill_aliases` text NOT NULL,
	`query_terms` text NOT NULL,
	`preferences` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `profiles_updated_idx` ON `profiles` (`updated_at`);--> statement-breakpoint
CREATE TABLE `triage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`profile_id` integer NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `triage_job_profile_idx` ON `triage` (`job_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `triage_decided_idx` ON `triage` (`decided_at`);