CREATE TABLE `github_installation` (
	`account_id` integer PRIMARY KEY,
	`installation_id` integer NOT NULL,
	`organization_id` text NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text NOT NULL,
	`repository_selection` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_github_installation_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ledger_entry` (
	`id` text PRIMARY KEY,
	`account_type` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`job_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pool_settings` (
	`organization_id` text PRIMARY KEY,
	`allowed_teams` text DEFAULT '[]' NOT NULL,
	`earnings_destination` text DEFAULT 'organization' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_pool_settings_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY,
	`event` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `github_installation_org_idx` ON `github_installation` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `github_installation_installation_idx` ON `github_installation` (`installation_id`);--> statement-breakpoint
CREATE INDEX `ledger_entry_account_idx` ON `ledger_entry` (`account_type`,`account_id`,`created_at`);