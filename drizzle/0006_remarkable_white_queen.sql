CREATE TABLE `application_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`adapter` text NOT NULL,
	`status` text NOT NULL,
	`fields` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error` text,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `application_runs_application_idx` ON `application_runs` (`application_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`applied_at` integer,
	`resume_variant_id` integer,
	`cover_letter` text,
	`next_followup_at` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resume_variant_id`) REFERENCES `resume_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_job_uq` ON `applications` (`job_id`);--> statement-breakpoint
CREATE INDEX `applications_status_followup_idx` ON `applications` (`status`,`next_followup_at`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`name` text,
	`role` text,
	`email` text,
	`linkedin` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contacts_company_idx` ON `contacts` (`company_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_application_occurred_idx` ON `events` (`application_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `ranking_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`profile_id` integer NOT NULL,
	`outcome` text NOT NULL,
	`features` text NOT NULL,
	`retrieval_score` real NOT NULL,
	`llm_score` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ranking_feedback_profile_idx` ON `ranking_feedback` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `resume_variants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`resume_json` text NOT NULL,
	`cover_letter` text,
	`pdf_path` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `resume_variants_job_idx` ON `resume_variants` (`job_id`,`created_at`);