CREATE TABLE `job` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`machine_id` text NOT NULL,
	`label` text NOT NULL,
	`repository` text NOT NULL,
	`workflow_run_id` integer,
	`github_job_id` integer,
	`job_name` text DEFAULT '' NOT NULL,
	`vcpus` integer NOT NULL,
	`speed_score` real NOT NULL,
	`rate` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`result` text,
	`compute_units` real,
	`amount` integer,
	`tax` integer,
	`earning` integer,
	`payee_type` text,
	`payee_id` text,
	`receipt` text,
	`receipt_signature` text,
	`receipt_key_id` text,
	CONSTRAINT `fk_job_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_job_machine_id_machine_id_fk` FOREIGN KEY (`machine_id`) REFERENCES `machine`(`id`)
);
--> statement-breakpoint
CREATE INDEX `job_org_idx` ON `job` (`organization_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `job_machine_idx` ON `job` (`machine_id`,`started_at`);