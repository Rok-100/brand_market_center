
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `wis_local` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `wis_local`;
DROP TABLE IF EXISTS `ai_material_asset_tags`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_material_asset_tags` (
  `asset_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tag_id` bigint unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`asset_id`,`tag_id`),
  KEY `idx_ai_material_asset_tags_tag` (`tag_id`),
  CONSTRAINT `fk_ai_material_asset_tags_asset` FOREIGN KEY (`asset_id`) REFERENCES `ai_material_assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ai_material_asset_tags_tag` FOREIGN KEY (`tag_id`) REFERENCES `ai_material_tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_material_assets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_material_assets` (
  `id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `external_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `product_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'upload',
  `source_doc_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_doc_url` text COLLATE utf8mb4_unicode_ci,
  `source_section` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_rank` int DEFAULT NULL,
  `effective_label` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approval_risk` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_effective` tinyint(1) NOT NULL DEFAULT '0',
  `storage_backend` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'local',
  `storage_path` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` bigint unsigned NOT NULL DEFAULT '0',
  `sha256` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `duration_ms` int unsigned NOT NULL DEFAULT '0',
  `width` int unsigned NOT NULL DEFAULT '0',
  `height` int unsigned NOT NULL DEFAULT '0',
  `fps` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `video_codec` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `audio_codec` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `has_audio` tinyint(1) NOT NULL DEFAULT '0',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ready',
  `ai_status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `ai_summary_json` json DEFAULT NULL,
  `search_text` text COLLATE utf8mb4_unicode_ci,
  `created_by` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_material_assets_external_id` (`external_id`),
  KEY `idx_ai_material_assets_product` (`product_id`),
  KEY `idx_ai_material_assets_effective` (`is_effective`,`status`),
  KEY `idx_ai_material_assets_sha256` (`sha256`),
  KEY `idx_ai_material_assets_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_material_audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_material_audit_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `actor` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail_json` json DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_ai_material_audit_entity` (`entity_type`,`entity_id`),
  KEY `idx_ai_material_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_material_clips`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_material_clips` (
  `id` varchar(96) COLLATE utf8mb4_unicode_ci NOT NULL,
  `asset_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_ms` int unsigned NOT NULL DEFAULT '0',
  `end_ms` int unsigned NOT NULL DEFAULT '0',
  `duration_ms` int unsigned NOT NULL DEFAULT '0',
  `stage` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stage_label` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `visual_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transcript` text COLLATE utf8mb4_unicode_ci,
  `visible_text` text COLLATE utf8mb4_unicode_ci,
  `file_path` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `thumbnail_path` text COLLATE utf8mb4_unicode_ci,
  `has_audio` tinyint(1) NOT NULL DEFAULT '0',
  `has_speech_candidate` tinyint(1) NOT NULL DEFAULT '0',
  `label_source` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `confidence` decimal(6,5) DEFAULT NULL,
  `cut_basis` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `segmentation_version` int NOT NULL DEFAULT '0',
  `approved` tinyint(1) NOT NULL DEFAULT '0',
  `review_required` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_ai_material_clips_asset` (`asset_id`),
  KEY `idx_ai_material_clips_stage` (`stage`),
  KEY `idx_ai_material_clips_visual_type` (`visual_type`),
  CONSTRAINT `fk_ai_material_clips_asset` FOREIGN KEY (`asset_id`) REFERENCES `ai_material_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_material_performance_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_material_performance_daily` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `asset_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `publish_task_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'qianchuan',
  `metric_date` date NOT NULL,
  `impressions` bigint unsigned NOT NULL DEFAULT '0',
  `clicks` bigint unsigned NOT NULL DEFAULT '0',
  `spend` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `attributed_gmv` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `orders` bigint unsigned NOT NULL DEFAULT '0',
  `ctr` decimal(12,8) DEFAULT NULL,
  `cvr` decimal(12,8) DEFAULT NULL,
  `roi` decimal(12,6) DEFAULT NULL,
  `raw_json` json DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_material_performance_daily` (`asset_id`,`platform`,`metric_date`),
  KEY `idx_ai_material_performance_date` (`metric_date`),
  CONSTRAINT `fk_ai_material_performance_asset` FOREIGN KEY (`asset_id`) REFERENCES `ai_material_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_material_publish_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_material_publish_tasks` (
  `id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `asset_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clip_id` varchar(96) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'qianchuan',
  `advertiser_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'waiting_auth',
  `payload_json` json DEFAULT NULL,
  `external_material_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `requested_by` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requested_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `started_at` datetime(3) DEFAULT NULL,
  `finished_at` datetime(3) DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_ai_material_publish_tasks_status` (`platform`,`status`,`requested_at`),
  KEY `idx_ai_material_publish_tasks_asset` (`asset_id`),
  CONSTRAINT `fk_ai_material_publish_tasks_asset` FOREIGN KEY (`asset_id`) REFERENCES `ai_material_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_material_tags`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_material_tags` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'custom',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_material_tags_name_category` (`name`,`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_remake_prompt_recipes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_remake_prompt_recipes` (
  `id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `schema_version` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'one-click-remake-recipe-v2',
  `owner_key` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `product_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `change_type` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `video_type` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_task_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_canvas_url` text COLLATE utf8mb4_unicode_ci,
  `source_model` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cover_url` text COLLATE utf8mb4_unicode_ci,
  `result_video_url` text COLLATE utf8mb4_unicode_ci,
  `snapshot_oss_key` text COLLATE utf8mb4_unicode_ci,
  `snapshot_oss_url` text COLLATE utf8mb4_unicode_ci,
  `snapshot_sha256` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tags_json` json DEFAULT NULL,
  `search_text` mediumtext COLLATE utf8mb4_unicode_ci,
  `recipe_json` json NOT NULL,
  `created_by` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_ai_remake_recipes_owner_created` (`owner_key`,`created_at`),
  KEY `idx_ai_remake_recipes_product` (`owner_key`,`product_id`),
  KEY `idx_ai_remake_recipes_change_type` (`owner_key`,`change_type`),
  KEY `idx_ai_remake_recipes_video_type` (`owner_key`,`video_type`),
  KEY `idx_ai_remake_recipes_model` (`owner_key`,`source_model`),
  KEY `idx_ai_remake_recipes_task` (`owner_key`,`source_task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pinying_document_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pinying_document_history` (
  `scope` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `path_hash` binary(32) NOT NULL,
  `version` bigint NOT NULL,
  `body` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `sha256` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `captured_at` datetime(6) NOT NULL,
  PRIMARY KEY (`scope`,`path_hash`,`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pinying_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pinying_documents` (
  `scope` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `path_hash` binary(32) NOT NULL,
  `logical_path` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `body` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `version` bigint NOT NULL,
  `sha256` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`scope`,`path_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pinying_rpc_receipts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pinying_rpc_receipts` (
  `scope` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `request_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `fingerprint` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `response_json` json NOT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`scope`,`request_id`),
  KEY `expiry` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pinying_storage_schemas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pinying_storage_schemas` (
  `scope` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `source_path` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `schema_json` json NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_anchor_status_audit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_anchor_status_audit` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `job_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `actor` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `action` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `detail` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_anchor_status_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_anchor_status_jobs` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `session_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `room` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `business_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `source` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `content_hash` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `attempts` bigint NOT NULL DEFAULT '0',
  `next_attempt` bigint NOT NULL DEFAULT '0',
  `lease_until` bigint DEFAULT NULL,
  `error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `completed_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  `__unique_0` binary(32) GENERATED ALWAYS AS (if((`content_hash` is null),NULL,unhex(sha2(json_array(`content_hash`),256)))) STORED,
  `__unique_1` binary(32) GENERATED ALWAYS AS (if((`session_key` is null),NULL,unhex(sha2(json_array(`session_key`),256)))) STORED,
  `__unique_2` binary(32) GENERATED ALWAYS AS (if((`asset_key` is null),NULL,unhex(sha2(json_array(`asset_key`),256)))) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_0` (`__unique_0`),
  UNIQUE KEY `i_1` (`__unique_1`),
  UNIQUE KEY `i_2` (`__unique_2`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_anchor_status_meta`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_anchor_status_meta` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`key`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_anchor_status_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_anchor_status_reports` (
  `job_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'pending'),
  `uuid` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `file_message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`job_id`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_anchor_status_review_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_anchor_status_review_tasks` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `job_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `note` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `completed_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  `__unique_0` binary(32) GENERATED ALWAYS AS (if((`job_id` is null),NULL,unhex(sha2(json_array(`job_id`),256)))) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_0` (`__unique_0`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_catalog_audit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_catalog_audit` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `kind` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `previous` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_catalog_catalog_meta`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_catalog_catalog_meta` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`key`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_catalog_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_catalog_events` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`key`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_catalog_resources`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_catalog_resources` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `approved` bigint NOT NULL,
  `deleted` bigint NOT NULL,
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`key`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`type`(191),`deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_admin_grants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_admin_grants` (
  `identifier` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `identifier_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `real_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `department` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `center` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `role` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `active` tinyint(1) NOT NULL,
  `protected` tinyint(1) NOT NULL,
  `granted_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `granted_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `granted_at` datetime(6) NOT NULL,
  `revoked_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `revoked_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `revoked_at` datetime(6) DEFAULT NULL,
  `last_verified_at` datetime(6) DEFAULT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`identifier`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`role`(191)),
  KEY `i_1` (`user_number`(191)),
  KEY `i_2` (`identifier_type`(191)),
  KEY `i_3` (`protected`),
  KEY `i_4` (`active`),
  KEY `i_5` (`real_name`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_adq_deliveries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_adq_deliveries` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `batch_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_id` bigint NOT NULL,
  `created_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `account_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `account_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `adgroup_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `adgroup_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `source_dynamic_creative_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `dynamic_creative_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `platform_asset_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `root_material_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `cover_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `idempotency_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `binding_evidence` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `binding_verified_at` datetime(6) DEFAULT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `request_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `attempt_count` bigint NOT NULL,
  `last_error_category` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `failure_stage` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `error_code` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `error_message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `error_advice` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics_status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics_start_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics_end_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics_synced_at` datetime(6) DEFAULT NULL,
  `metrics_message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `deleted_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `deleted_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`deleted_at`),
  KEY `i_1` (`created_by_number`(191)),
  KEY `i_2` (`adgroup_id`(191)),
  KEY `i_3` (`platform_asset_id`(191)),
  KEY `i_4` (`batch_id`(191)),
  KEY `i_5` (`account_id`(191)),
  KEY `i_6` (`idempotency_key`(191)),
  KEY `i_7` (`dynamic_creative_id`(191)),
  KEY `i_8` (`metrics_status`(191)),
  KEY `i_9` (`status`(191)),
  KEY `i_10` (`root_material_id`(191)),
  KEY `i_11` (`asset_id`),
  CONSTRAINT `f_170f31c4c104b79fc34aa3b4` FOREIGN KEY (`asset_id`) REFERENCES `py_cloud_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_adq_metric_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_adq_metric_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `task_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `account_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `adgroup_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `video_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `stat_date` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `has_data` tinyint(1) NOT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `error_code` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `request_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `synced_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_6` (`task_id`,`stat_date`),
  KEY `i_0` (`video_id`(191)),
  KEY `i_1` (`status`(191)),
  KEY `i_2` (`adgroup_id`(191)),
  KEY `i_3` (`task_id`),
  KEY `i_4` (`stat_date`),
  KEY `i_5` (`account_id`(191)),
  CONSTRAINT `f_b20e4bab76a445cb7e005bb9` FOREIGN KEY (`task_id`) REFERENCES `py_cloud_adq_deliveries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_app_meta`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_app_meta` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`key`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_asset_audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_asset_audit_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `asset_id` bigint NOT NULL,
  `object_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `action` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `detail` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `i_0` (`actor_number`(191)),
  KEY `i_1` (`created_at`),
  KEY `i_2` (`action`(191)),
  KEY `i_3` (`object_key`(191)),
  KEY `i_4` (`asset_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_asset_effective_marks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_asset_effective_marks` (
  `asset_id` bigint NOT NULL AUTO_INCREMENT,
  `marked_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `marked_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`asset_id`),
  KEY `i_0` (`created_at`),
  KEY `i_1` (`marked_by_number`(191)),
  CONSTRAINT `f_d9116079d5fb60d61fd405ae` FOREIGN KEY (`asset_id`) REFERENCES `py_cloud_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_asset_favorites`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_asset_favorites` (
  `user_number` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_id` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`user_number`,`asset_id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `f_724eb7998c176a2fb5227982` (`asset_id`),
  CONSTRAINT `f_724eb7998c176a2fb5227982` FOREIGN KEY (`asset_id`) REFERENCES `py_cloud_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_asset_review_ai_results`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_asset_review_ai_results` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `submission_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `provider` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `task_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `rule_version` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `category_counts` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `findings` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `segments` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `error_message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `retry_count` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `started_at` datetime(6) DEFAULT NULL,
  `completed_at` datetime(6) DEFAULT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_2` (`submission_id`),
  KEY `i_0` (`submission_id`),
  KEY `i_1` (`status`(191)),
  CONSTRAINT `f_0b42afde2690e4ec79f2f1ad` FOREIGN KEY (`submission_id`) REFERENCES `py_cloud_asset_review_submissions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_asset_review_decisions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_asset_review_decisions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `submission_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `role_code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reviewer_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reviewer_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `candidate_reviewers` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `candidate_search` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `note` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `quality_scores` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `quality_total` bigint DEFAULT NULL,
  `quality_grade` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `decided_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_4` (`submission_id`,`role_code`),
  KEY `i_0` (`status`(191)),
  KEY `i_1` (`reviewer_number`(191)),
  KEY `i_2` (`role_code`),
  KEY `i_3` (`submission_id`),
  CONSTRAINT `f_f5b09c86bcb52d0e6940307a` FOREIGN KEY (`submission_id`) REFERENCES `py_cloud_asset_review_submissions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_asset_review_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_asset_review_submissions` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_id` bigint NOT NULL,
  `version` bigint NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `submitted_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `submitted_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `note` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `filename_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `naming_evidence` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `naming_check` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `route_center` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `route_group` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `assignment_mode` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `designated_reviewer_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `designated_reviewer_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `submitted_at` datetime(6) NOT NULL,
  `completed_at` datetime(6) DEFAULT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_9` (`asset_id`,`version`),
  KEY `i_0` (`route_group`(191)),
  KEY `i_1` (`submitted_by_number`(191)),
  KEY `i_2` (`designated_reviewer_number`(191)),
  KEY `i_3` (`asset_id`),
  KEY `i_4` (`route_center`(191)),
  KEY `i_5` (`designated_reviewer_name`(191)),
  KEY `i_6` (`assignment_mode`(191)),
  KEY `i_7` (`submitted_at`),
  KEY `i_8` (`status`(191)),
  CONSTRAINT `f_66126631d40316ae15bc5f13` FOREIGN KEY (`asset_id`) REFERENCES `py_cloud_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_assets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_assets` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `object_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `filename` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `media_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `size` bigint NOT NULL,
  `etag` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `modified_at` datetime(6) NOT NULL,
  `category` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `content_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_scope` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `library_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_subtype` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `folder_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `tags` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `favorite` tinyint(1) NOT NULL,
  `cover_url` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `source` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `account_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `ingest_source` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `uploaded_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `uploaded_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reference_url` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reference_video_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reference_video_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `material_description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `performance_screenshots` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `deleted_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `deleted_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `purged_at` datetime(6) DEFAULT NULL,
  `purge_error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__unique_6` binary(32) GENERATED ALWAYS AS (if((`object_key` is null),NULL,unhex(sha2(json_array(`object_key`),256)))) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_6` (`__unique_6`),
  KEY `i_0` (`asset_subtype`(191)),
  KEY `i_1` (`filename`(191)),
  KEY `i_2` (`library_type`(191)),
  KEY `i_3` (`ingest_source`(191)),
  KEY `i_4` (`status`(191)),
  KEY `i_5` (`purged_at`),
  KEY `i_7` (`category`(191)),
  KEY `i_8` (`asset_scope`(191)),
  KEY `i_9` (`media_type`(191)),
  KEY `i_10` (`folder_name`(191)),
  KEY `i_11` (`content_type`(191)),
  KEY `i_12` (`uploaded_by_number`(191)),
  KEY `i_13` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_assistant_attachments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_assistant_attachments` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `conversation_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `filename` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `mime_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `file_size` bigint NOT NULL,
  `sha256` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `storage_path` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`sha256`(191)),
  KEY `i_1` (`conversation_id`),
  KEY `i_2` (`message_id`(191)),
  KEY `i_3` (`created_at`),
  KEY `i_4` (`owner_number`(191)),
  CONSTRAINT `f_b2705c9ddf5d2eb6b1804009` FOREIGN KEY (`conversation_id`) REFERENCES `py_cloud_assistant_conversations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_assistant_conversation_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_assistant_conversation_messages` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `conversation_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `role` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `content` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message_meta` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`role`(191)),
  KEY `i_1` (`owner_number`(191)),
  KEY `i_2` (`conversation_id`),
  KEY `i_3` (`created_at`),
  CONSTRAINT `f_563f4a32633eed736a55c813` FOREIGN KEY (`conversation_id`) REFERENCES `py_cloud_assistant_conversations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_assistant_conversations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_assistant_conversations` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `last_message_preview` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message_count` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`updated_at`),
  KEY `i_1` (`created_at`),
  KEY `i_2` (`owner_number`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_channels_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_channels_accounts` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `nickname` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `external_account_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `avatar_url` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `auth_file` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `channel_cookies_ciphertext` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `session_cookie_ciphertext` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `cookies_updated_at` datetime(6) DEFAULT NULL,
  `last_verified_at` datetime(6) DEFAULT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `authorized_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`status`(191)),
  KEY `i_1` (`owner_number`(191)),
  KEY `i_2` (`external_account_id`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_channels_deliveries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_channels_deliveries` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `batch_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_id` bigint NOT NULL,
  `created_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `account_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `account_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `tags` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `product_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `product_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `cover_object_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `cover_filename` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `cover_status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `cover_message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `video_annotation` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `annotation_shooting_time` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `annotation_shooting_location` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `annotation_repost_source` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `failure_stage` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `attempt_count` bigint NOT NULL,
  `error_message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `platform_content_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `platform_export_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `platform_export_source` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `platform_export_verified_at` datetime(6) DEFAULT NULL,
  `platform_content_url` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `publish_clicked_at` datetime(6) DEFAULT NULL,
  `publish_client_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `publish_transport` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `platform_check_attempts` bigint NOT NULL,
  `submitted_at` datetime(6) DEFAULT NULL,
  `published_at` datetime(6) DEFAULT NULL,
  `view_count` bigint DEFAULT NULL,
  `like_count` bigint DEFAULT NULL,
  `comment_count` bigint DEFAULT NULL,
  `share_count` bigint DEFAULT NULL,
  `order_count` bigint DEFAULT NULL,
  `gmv_fen` bigint DEFAULT NULL,
  `metrics_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics_message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics_updated_at` datetime(6) DEFAULT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`publish_client_id`(191)),
  KEY `i_1` (`platform_export_id`(191)),
  KEY `i_2` (`batch_id`(191)),
  KEY `i_3` (`account_id`),
  KEY `i_4` (`status`(191)),
  KEY `i_5` (`deleted_at`),
  KEY `i_6` (`publish_clicked_at`),
  KEY `i_7` (`platform_content_id`(191)),
  KEY `i_8` (`created_by_number`(191)),
  KEY `i_9` (`asset_id`),
  CONSTRAINT `f_2242fb68f28dd297c3604814` FOREIGN KEY (`account_id`) REFERENCES `py_cloud_channels_accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `f_5a774bfca7f18cc6f00b8e1b` FOREIGN KEY (`asset_id`) REFERENCES `py_cloud_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_channels_metric_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_channels_metric_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `delivery_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `account_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `data_date` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `view_count` bigint DEFAULT NULL,
  `like_count` bigint DEFAULT NULL,
  `comment_count` bigint DEFAULT NULL,
  `share_count` bigint DEFAULT NULL,
  `order_count` bigint DEFAULT NULL,
  `gmv_fen` bigint DEFAULT NULL,
  `source` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `collected_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_3` (`delivery_id`,`data_date`),
  KEY `i_0` (`data_date`),
  KEY `i_1` (`delivery_id`),
  KEY `i_2` (`account_id`(191)),
  CONSTRAINT `f_e3b1034955e4af10eb627a5d` FOREIGN KEY (`delivery_id`) REFERENCES `py_cloud_channels_deliveries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_channels_promotion_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_channels_promotion_accounts` (
  `account_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `auth_file` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `promote_uniq_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `nickname` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_type` bigint NOT NULL,
  `balance_wecoin` bigint DEFAULT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `authorized_at` datetime(6) DEFAULT NULL,
  `expires_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`account_id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`expires_at`),
  KEY `i_1` (`status`(191)),
  KEY `i_2` (`owner_number`(191)),
  CONSTRAINT `f_f3c9b45e9a5b907d6919d8e6` FOREIGN KEY (`account_id`) REFERENCES `py_cloud_channels_accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_channels_promotion_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_channels_promotion_orders` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `delivery_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `account_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_by_number` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `platform_export_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `promotion_target` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `budget_wecoin` bigint NOT NULL,
  `quoted_wecoin` bigint DEFAULT NULL,
  `duration_hours` bigint NOT NULL,
  `order_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `idempotency_key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `quote_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `request_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `create_attempts` bigint NOT NULL,
  `confirmed_at` datetime(6) DEFAULT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `promotion_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `cost_wecoin` bigint DEFAULT NULL,
  `error_code` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `error_message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `response_summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_7` (`delivery_id`,`created_by_number`,`idempotency_key`),
  KEY `i_0` (`created_at`),
  KEY `i_1` (`status`(191)),
  KEY `i_2` (`account_id`),
  KEY `i_3` (`platform_export_id`(191)),
  KEY `i_4` (`delivery_id`),
  KEY `i_5` (`promotion_id`(191)),
  KEY `i_6` (`created_by_number`),
  CONSTRAINT `f_96ec7f42c42f9d78cec045b4` FOREIGN KEY (`delivery_id`) REFERENCES `py_cloud_channels_deliveries` (`id`) ON DELETE CASCADE,
  CONSTRAINT `f_a7171d11666b48ab2c5571c3` FOREIGN KEY (`account_id`) REFERENCES `py_cloud_channels_accounts` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_channels_promotion_payment_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_channels_promotion_payment_sessions` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `order_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `active_key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin DEFAULT NULL,
  `idempotency_key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `expected_amount` bigint NOT NULL,
  `pc_sdk_info_ciphertext` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `sdk_status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `prepare_attempts` bigint NOT NULL,
  `query_attempts` bigint NOT NULL,
  `response_summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `requested_by` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `expires_at` datetime(6) DEFAULT NULL,
  `completed_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_7` (`idempotency_key`),
  UNIQUE KEY `i_6` (`active_key`),
  KEY `i_0` (`expires_at`),
  KEY `i_1` (`requested_by`(191)),
  KEY `i_2` (`status`(191)),
  KEY `i_3` (`idempotency_key`),
  KEY `i_4` (`created_at`),
  KEY `i_5` (`order_id`),
  CONSTRAINT `f_df7ae15613cb4c2f11c7b808` FOREIGN KEY (`order_id`) REFERENCES `py_cloud_channels_promotion_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_company_audit_callback_receipts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_company_audit_callback_receipts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `job_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `task_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `payload_sha256` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `duplicate_count` bigint NOT NULL,
  `received_at` datetime(6) NOT NULL,
  `last_received_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_1` (`job_id`,`payload_sha256`),
  KEY `i_0` (`job_id`),
  CONSTRAINT `f_2881a7b2a39cd49e43f11f6a` FOREIGN KEY (`job_id`) REFERENCES `py_cloud_company_audit_jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_company_audit_feedback`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_company_audit_feedback` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `job_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `task_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin DEFAULT NULL,
  `verdict` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reason` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `base_result_revision` bigint NOT NULL,
  `basis_hash` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `expected_request_revision` bigint NOT NULL,
  `attempts` bigint NOT NULL,
  `error_code` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `response` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `acknowledged_at` datetime(6) DEFAULT NULL,
  `confirmed_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `i_0` (`job_id`),
  KEY `i_1` (`task_id`),
  CONSTRAINT `f_6a1fac5856d339d3b047697f` FOREIGN KEY (`job_id`) REFERENCES `py_cloud_company_audit_jobs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `f_fbb72950d76b80eaad000766` FOREIGN KEY (`task_id`) REFERENCES `py_cloud_company_audit_remote_tasks` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_company_audit_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_company_audit_jobs` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `submission_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_id` bigint NOT NULL,
  `version` bigint NOT NULL,
  `object_key_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `etag_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `size_snapshot` bigint NOT NULL,
  `category_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `video_url` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `product_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `channel` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `callback_capability` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `task_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin DEFAULT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `pending_feedback_id` bigint DEFAULT NULL,
  `attempts` bigint NOT NULL,
  `error_code` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `next_attempt_at` datetime(6) NOT NULL,
  `lease_token` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `lease_until` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_4` (`callback_capability`),
  UNIQUE KEY `i_5` (`submission_id`),
  KEY `i_0` (`asset_id`),
  KEY `i_1` (`submission_id`),
  KEY `i_2` (`task_id`),
  KEY `i_3` (`next_attempt_at`),
  CONSTRAINT `f_48d9212aa552944a91149f71` FOREIGN KEY (`submission_id`) REFERENCES `py_cloud_asset_review_submissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `f_70a765687f05e1d14cc3186b` FOREIGN KEY (`asset_id`) REFERENCES `py_cloud_assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `f_77bb067d73999ac95763bcb4` FOREIGN KEY (`task_id`) REFERENCES `py_cloud_company_audit_remote_tasks` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_company_audit_remote_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_company_audit_remote_tasks` (
  `task_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `verdict` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `ready` tinyint(1) NOT NULL,
  `raw_result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `requested_revision` bigint NOT NULL,
  `verified_revision` bigint NOT NULL,
  `result_revision` bigint NOT NULL,
  `latest_feedback_id` bigint DEFAULT NULL,
  `latest_feedback_status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `latest_feedback_verdict` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `latest_feedback_has_reason` tinyint(1) NOT NULL,
  `attempts` bigint NOT NULL,
  `error_code` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `next_attempt_at` datetime(6) NOT NULL,
  `lease_token` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `lease_until` datetime(6) DEFAULT NULL,
  `last_verified_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`task_id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`next_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_company_audit_worker_state`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_company_audit_worker_state` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `preferred_kind` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_creative_incentive_directions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_creative_incentive_directions` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `direction_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `material_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `material_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `creator_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `creator_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `department` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `center` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `online_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `originality_status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `originality_note` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `confirmed_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `confirmed_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `confirmed_at` datetime(6) DEFAULT NULL,
  `copy_judgement` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `visual_judgement` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `voice_judgement` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `remix_plan` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reference_url` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metric_status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `latest_gmv_yuan` double DEFAULT NULL,
  `latest_cost_yuan` double DEFAULT NULL,
  `latest_roi` double DEFAULT NULL,
  `source_cutoff_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `source_updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `synced_at` datetime(6) DEFAULT NULL,
  `created_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_11` (`material_id`),
  KEY `i_0` (`material_id`),
  KEY `i_1` (`created_at`),
  KEY `i_2` (`center`(191)),
  KEY `i_3` (`creator_name`(191)),
  KEY `i_4` (`metric_status`(191)),
  KEY `i_5` (`originality_status`(191)),
  KEY `i_6` (`department`(191)),
  KEY `i_7` (`direction_name`(191)),
  KEY `i_8` (`creator_number`(191)),
  KEY `i_9` (`updated_at`),
  KEY `i_10` (`online_date`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_creative_incentive_milestones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_creative_incentive_milestones` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `direction_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `point_number` bigint NOT NULL,
  `threshold_gmv_yuan` bigint NOT NULL,
  `observed_gmv_yuan` double NOT NULL,
  `observed_cost_yuan` double DEFAULT NULL,
  `observed_roi` double DEFAULT NULL,
  `source_cutoff_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `share_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `share_text` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `share_status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `published_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `published_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `published_at` datetime(6) DEFAULT NULL,
  `feishu_message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `delivery_error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_3` (`direction_id`,`point_number`),
  KEY `i_0` (`share_status`(191)),
  KEY `i_1` (`direction_id`),
  KEY `i_2` (`created_at`),
  CONSTRAINT `f_df9b77c34e9f75ba3dc64288` FOREIGN KEY (`direction_id`) REFERENCES `py_cloud_creative_incentive_directions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_jianying_devices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_jianying_devices` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `device_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `token_hash` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `active` tinyint(1) NOT NULL,
  `last_seen_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_0` (`token_hash`),
  KEY `i_1` (`active`),
  KEY `i_2` (`last_seen_at`),
  KEY `i_3` (`owner_number`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_jianying_import_tickets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_jianying_import_tickets` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_id` bigint NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `progress` bigint NOT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `downloaded_bytes` bigint NOT NULL,
  `total_bytes` bigint NOT NULL,
  `speed_bps` bigint NOT NULL,
  `eta_seconds` bigint NOT NULL,
  `helper_version` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `cache_hit` tinyint(1) NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `delivered_at` datetime(6) DEFAULT NULL,
  `completed_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`asset_id`),
  KEY `i_1` (`expires_at`),
  KEY `i_2` (`status`(191)),
  KEY `i_3` (`owner_number`(191)),
  CONSTRAINT `f_7f4fc0a65d002cf63fd17e78` FOREIGN KEY (`asset_id`) REFERENCES `py_cloud_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_jianying_pairings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_jianying_pairings` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `code_hash` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `device_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `claimed_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_0` (`code_hash`),
  KEY `i_1` (`expires_at`),
  KEY `i_2` (`device_id`(191)),
  KEY `i_3` (`owner_number`(191)),
  KEY `i_4` (`status`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_module_access_grants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_module_access_grants` (
  `identifier` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `identifier_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `real_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `department` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `center` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `access_mode` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `modules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`identifier`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`user_number`(191)),
  KEY `i_1` (`real_name`(191)),
  KEY `i_2` (`identifier_type`(191)),
  KEY `i_3` (`access_mode`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_oa_access_audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_oa_access_audit_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `identifier` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `real_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `action` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `detail` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `i_0` (`identifier`(191)),
  KEY `i_1` (`created_at`),
  KEY `i_2` (`action`(191)),
  KEY `i_3` (`real_name`(191)),
  KEY `i_4` (`actor_number`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_oa_access_grants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_oa_access_grants` (
  `identifier` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `identifier_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `real_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `department` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `center` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `active` tinyint(1) NOT NULL,
  `source` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `granted_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `granted_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `granted_at` datetime(6) NOT NULL,
  `revoked_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `revoked_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `revoked_at` datetime(6) DEFAULT NULL,
  `last_verified_at` datetime(6) DEFAULT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`identifier`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`active`),
  KEY `i_1` (`identifier_type`(191)),
  KEY `i_2` (`user_number`(191)),
  KEY `i_3` (`real_name`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_operation_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_operation_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `actor_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `department` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `module` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `action` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `method` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `path` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status_code` bigint NOT NULL,
  `resource_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `resource_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `detail` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `i_0` (`created_at`),
  KEY `i_1` (`resource_id`(191)),
  KEY `i_2` (`actor_name`(191)),
  KEY `i_3` (`actor_number`(191)),
  KEY `i_4` (`action`(191)),
  KEY `i_5` (`module`(191)),
  KEY `i_6` (`result`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_private_assets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_private_assets` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_number` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `filename` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `content_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `category` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `folder_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `sha256` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `size` bigint NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `shared_asset_id` bigint DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_2` (`owner_number`,`sha256`,`size`),
  KEY `i_0` (`status`(191)),
  KEY `i_1` (`owner_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_push_meta`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_push_meta` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`key`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_push_notices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_push_notices` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `task` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'pending'),
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `receive_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `attempts` bigint NOT NULL DEFAULT '0',
  `next_at` double NOT NULL DEFAULT '0',
  `first_at` double DEFAULT NULL,
  `message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `created_at` double NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_push_observed`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_push_observed` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`key`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_push_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_push_preferences` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `owner_number` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `platform` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `account_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `account_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `target_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `target_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `target_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `pinned` tinyint(1) NOT NULL,
  `use_count` bigint NOT NULL,
  `last_used_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_6` (`owner_number`,`platform`,`account_id`,`target_id`),
  KEY `i_0` (`owner_number`),
  KEY `i_1` (`pinned`),
  KEY `i_2` (`account_id`),
  KEY `i_3` (`platform`),
  KEY `i_4` (`target_id`),
  KEY `i_5` (`last_used_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_push_schemes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_push_schemes` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `targets` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `revision` bigint NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`owner_number`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_qianchuan_deliveries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_qianchuan_deliveries` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `batch_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_id` bigint NOT NULL,
  `created_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `advertiser_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `advertiser_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `plan_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `plan_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `plan_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `platform_asset_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `upload_task_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `idempotency_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `delivery_entity_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `delivery_entity_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `binding_evidence` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `binding_verified_at` datetime(6) DEFAULT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `request_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `attempt_count` bigint NOT NULL,
  `last_error_category` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `failure_stage` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `error_code` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `error_message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `error_advice` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `related_ad_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `related_creative_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics_link_status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics_start_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics_end_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics_synced_at` datetime(6) DEFAULT NULL,
  `metrics_message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `deleted_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `deleted_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`asset_id`),
  KEY `i_1` (`plan_id`(191)),
  KEY `i_2` (`upload_task_id`(191)),
  KEY `i_3` (`delivery_entity_id`(191)),
  KEY `i_4` (`metrics_link_status`(191)),
  KEY `i_5` (`advertiser_id`(191)),
  KEY `i_6` (`platform_asset_id`(191)),
  KEY `i_7` (`created_by_number`(191)),
  KEY `i_8` (`deleted_at`),
  KEY `i_9` (`status`(191)),
  KEY `i_10` (`idempotency_key`(191)),
  KEY `i_11` (`batch_id`(191)),
  CONSTRAINT `f_969043b796725f850d0ac645` FOREIGN KEY (`asset_id`) REFERENCES `py_cloud_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_qianchuan_metric_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_qianchuan_metric_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `task_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `advertiser_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `plan_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `video_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `stat_date` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `metrics` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `has_data` tinyint(1) NOT NULL,
  `link_verified` tinyint(1) NOT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `error_code` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `request_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `synced_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_6` (`task_id`,`stat_date`),
  KEY `i_0` (`video_id`(191)),
  KEY `i_1` (`task_id`),
  KEY `i_2` (`advertiser_id`(191)),
  KEY `i_3` (`status`(191)),
  KEY `i_4` (`stat_date`),
  KEY `i_5` (`plan_id`(191)),
  CONSTRAINT `f_7a9d902530cc499a1fcd9e74` FOREIGN KEY (`task_id`) REFERENCES `py_cloud_qianchuan_deliveries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_review_ai_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_review_ai_rules` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `category` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `severity` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `pattern` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `enabled` tinyint(1) NOT NULL,
  `sort_order` bigint NOT NULL,
  `updated_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_3` (`code`),
  KEY `i_0` (`category`(191)),
  KEY `i_1` (`enabled`),
  KEY `i_2` (`severity`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_review_role_assignments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_review_role_assignments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `role_code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `identifier` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `department` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `center` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `group_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `source` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `active` tinyint(1) NOT NULL,
  `created_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_8` (`role_code`,`identifier`),
  KEY `i_0` (`identifier`),
  KEY `i_1` (`user_name`(191)),
  KEY `i_2` (`group_name`(191)),
  KEY `i_3` (`user_number`(191)),
  KEY `i_4` (`active`),
  KEY `i_5` (`role_code`),
  KEY `i_6` (`center`(191)),
  KEY `i_7` (`source`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_review_workflow_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_review_workflow_config` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `enabled` tinyint(1) NOT NULL,
  `naming_enabled` tinyint(1) NOT NULL,
  `ai_redline_enabled` tinyint(1) NOT NULL,
  `required_roles` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_upload_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_upload_sessions` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `sha256` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `file_size` bigint NOT NULL,
  `filename` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `content_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_scope` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `category` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `object_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `multipart_upload_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `part_size` bigint NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `completed_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  `__unique_4` binary(32) GENERATED ALWAYS AS (if((`object_key` is null),NULL,unhex(sha2(json_array(`object_key`),256)))) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_4` (`__unique_4`),
  KEY `i_0` (`owner_number`(191)),
  KEY `i_1` (`status`(191)),
  KEY `i_2` (`expires_at`),
  KEY `i_3` (`asset_scope`(191)),
  KEY `i_5` (`sha256`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_user_notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_user_notifications` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `recipient_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `recipient_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `kind` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `resource_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `resource_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `external_status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `external_attempts` bigint NOT NULL,
  `external_error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `external_attempted_at` datetime(6) DEFAULT NULL,
  `external_sent_at` datetime(6) DEFAULT NULL,
  `read_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `external_message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin DEFAULT (_utf8mb4''),
  PRIMARY KEY (`id`),
  KEY `i_0` (`external_status`(191)),
  KEY `i_1` (`resource_id`(191)),
  KEY `i_2` (`recipient_name`(191)),
  KEY `i_3` (`read_at`),
  KEY `i_4` (`created_at`),
  KEY `i_5` (`recipient_number`(191)),
  KEY `i_6` (`kind`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_video_request_deliveries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_video_request_deliveries` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `request_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_id` bigint NOT NULL,
  `version` bigint NOT NULL,
  `submission_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `note` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `uploaded_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `uploaded_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_5` (`request_id`,`version`),
  KEY `i_0` (`asset_id`),
  KEY `i_1` (`created_at`),
  KEY `i_2` (`request_id`),
  KEY `i_3` (`uploaded_by_number`(191)),
  KEY `i_4` (`submission_id`(191)),
  CONSTRAINT `f_28ddfe565f82ef1a53d5925b` FOREIGN KEY (`request_id`) REFERENCES `py_cloud_video_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `f_82a7cf10bbd88e6d6c9a2721` FOREIGN KEY (`asset_id`) REFERENCES `py_cloud_assets` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_video_request_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_video_request_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `request_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `action` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `detail` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `i_0` (`action`(191)),
  KEY `i_1` (`actor_number`(191)),
  KEY `i_2` (`created_at`),
  KEY `i_3` (`request_id`),
  CONSTRAINT `f_52bb87c983a36953e2737063` FOREIGN KEY (`request_id`) REFERENCES `py_cloud_video_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_video_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_video_requests` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `product` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reference_url` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reference_video_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reference_video_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reference_videos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reference_images` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `requester_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `requester_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `requester_department` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `assignee_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `assignee_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `latest_asset_id` bigint DEFAULT NULL,
  `delivery_version` bigint NOT NULL,
  `latest_feedback` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `return_reason` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `returned_by_number` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `returned_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `returned_at` datetime(6) DEFAULT NULL,
  `assigned_at` datetime(6) DEFAULT NULL,
  `started_at` datetime(6) DEFAULT NULL,
  `delivered_at` datetime(6) DEFAULT NULL,
  `accepted_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`updated_at`),
  KEY `i_1` (`assignee_number`(191)),
  KEY `i_2` (`product`(191)),
  KEY `i_3` (`assignee_name`(191)),
  KEY `i_4` (`status`(191)),
  KEY `i_5` (`created_at`),
  KEY `i_6` (`latest_asset_id`),
  KEY `i_7` (`requester_name`(191)),
  KEY `i_8` (`requester_number`(191)),
  CONSTRAINT `f_8fbe154dce7388405d969105` FOREIGN KEY (`latest_asset_id`) REFERENCES `py_cloud_assets` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_workspace_role_grants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_workspace_role_grants` (
  `identifier` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `role` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `center` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `department` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `version` bigint NOT NULL,
  `updated_by_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`identifier`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_cloud_workstation_returns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_cloud_workstation_returns` (
  `idempotency_key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `object_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `asset_id` bigint DEFAULT NULL,
  `filename` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `file_size` bigint NOT NULL,
  `sha256` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `mime_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `provenance` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `error_message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `completed_at` datetime(6) DEFAULT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  `__unique_0` binary(32) GENERATED ALWAYS AS (if((`object_key` is null),NULL,unhex(sha2(json_array(`object_key`),256)))) STORED,
  PRIMARY KEY (`idempotency_key`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_0` (`__unique_0`),
  KEY `i_1` (`status`(191)),
  KEY `i_2` (`sha256`(191)),
  KEY `i_3` (`asset_id`),
  CONSTRAINT `f_c8ddbf3d213a9ba7e7923d47` FOREIGN KEY (`asset_id`) REFERENCES `py_cloud_assets` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_competitor_scripts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_competitor_scripts` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `brand` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'待补充'),
  `product` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'待补充'),
  `copy` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `source` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'批量导入'),
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `script_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'自产脚本'),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`created_at`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_creative_artist_projects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_creative_artist_projects` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `artist_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `product` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `project_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'实拍艺人'),
  `phase` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'筹备中'),
  `owner` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'待分配'),
  `next_milestone` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `eta` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `risk` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `script_summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `production_summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `launch_summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `prep_summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `project_period` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `owner_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `creator_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `creator_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `actual_fee` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `rights_scope` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `rights_start_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `rights_end_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `rights_file_url` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `value_judgement` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `decision` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'推进'),
  `decision_by` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `decision_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `shoot_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `final_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `launch_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `first_creation_plan` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`artist_name`(191),`project_period`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_creative_drafts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_creative_drafts` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `product` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `script_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `template_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `template_title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `requirements` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `content` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `version` bigint NOT NULL DEFAULT '1',
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'generated'),
  `feedback` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `creator_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `creator_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'历史用户'),
  `uploader_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `uploader_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'历史导入'),
  `author_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'内部同事'),
  `author_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'待补充'),
  `author_user_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `team_lead_reviewer_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `team_lead_reviewer_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `supervisor_reviewer_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `supervisor_reviewer_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `current_reviewer_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `priority` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'普通'),
  `due_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `resume_stage` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'pending_team_lead'),
  `talent_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `video_links` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'[]'),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`status`(191)),
  KEY `i_1` (`status`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_creative_scripts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_creative_scripts` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `script_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `product` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `copy` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'待验证'),
  `source` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'文字导入'),
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `author_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'历史素材'),
  `author_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'待补充'),
  `author_user_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `uploader_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `uploader_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'历史导入'),
  `final_reviewer_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `final_reviewer_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `archived_from_draft_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `talent_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`product`(191)),
  KEY `i_1` (`script_type`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_creative_video_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_creative_video_comments` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `item_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `media_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `version` bigint NOT NULL DEFAULT '1',
  `time_seconds` double NOT NULL DEFAULT '0',
  `comment` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `screenshot_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `author_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `author_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'open'),
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `resolved_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`media_id`(191),`version`,`time_seconds`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_creative_videos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_creative_videos` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `script_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `url` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `duration` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'--:--'),
  `cover_tone` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'forest'),
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`script_id`),
  CONSTRAINT `f_8176a626d00a226cd5b57164` FOREIGN KEY (`script_id`) REFERENCES `py_creative_creative_scripts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_creative_work_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_creative_work_events` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `item_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `action` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `comment` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`item_id`(191),`created_at`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_creative_work_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_creative_work_items` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `review_section` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `script_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `cooperation_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `material_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `author_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `author_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `product` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `feishu_url` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `artist_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `project_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `priority` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'普通'),
  `due_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `note` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `submitter_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `submitter_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'pending_review'),
  `current_step` bigint NOT NULL DEFAULT '1',
  `archived_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `content_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'script'),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`submitter_id`(191),`updated_at`(191)),
  KEY `i_1` (`status`(191),`updated_at`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_creative_work_media`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_creative_work_media` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `item_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `version` bigint NOT NULL DEFAULT '1',
  `storage_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `original_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `mime_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `size_bytes` bigint NOT NULL DEFAULT '0',
  `uploader_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `uploader_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`item_id`(191),`version`,`created_at`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_creative_work_reviewers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_creative_work_reviewers` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `item_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reviewer_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reviewer_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `reviewer_role` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `step_order` bigint NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'waiting'),
  `comment` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `decided_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`reviewer_id`(191),`status`(191)),
  KEY `i_1` (`item_id`(191),`step_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_creator_collaborations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_creator_collaborations` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `creator_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `platform` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `product` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `owner` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `stage` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'待建联'),
  `due_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `note` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `material_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'付费KOC原片'),
  `owner_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `shooting_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `launch_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `abnormal_stage` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `abnormal_note` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `asset_link` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `sequence` bigint NOT NULL DEFAULT '1',
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `finished_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `actual_shooting_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `actual_finished_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `actual_launch_date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `script_link` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `source` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `linked_item_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'[]'),
  `schedule_history` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'[]'),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`launch_date`(191),`owner_id`(191)),
  KEY `i_1` (`stage`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_fando_connections`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_fando_connections` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `recipient_open_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `account_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `token_hash` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `token_encrypted` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'active'),
  `last_seen_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  `__unique_0` binary(32) GENERATED ALWAYS AS (if((`token_hash` is null),NULL,unhex(sha2(json_array(`token_hash`),256)))) STORED,
  `__unique_1` binary(32) GENERATED ALWAYS AS (if((`user_id` is null),NULL,unhex(sha2(json_array(`user_id`),256)))) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_0` (`__unique_0`),
  UNIQUE KEY `i_1` (`__unique_1`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_fando_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_fando_jobs` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `connection_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `job_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `project_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `task_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'queued'),
  `result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `lease_until` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `card_synced` bigint NOT NULL DEFAULT '0',
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  `__unique_0` binary(32) GENERATED ALWAYS AS (if(((`connection_id` is null) or (`task_id` is null) or (`status` not in (_utf8mb4'queued',_utf8mb4'sending',_utf8mb4'delivered',_utf8mb4'running'))),NULL,unhex(sha2(json_array(`connection_id`,`task_id`),256)))) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_0` (`__unique_0`),
  KEY `i_1` (`user_id`(191),`created_at`(191)),
  KEY `i_2` (`connection_id`(191),`status`(191),`created_at`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_notifications` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `draft_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'workflow'),
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `detail` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `is_read` bigint NOT NULL DEFAULT '0',
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`user_id`(191),`is_read`,`created_at`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_r2__mf_multipart_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_r2__mf_multipart_parts` (
  `upload_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `part_number` bigint NOT NULL,
  `blob_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `size` bigint NOT NULL,
  `etag` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `checksum_md5` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `object_key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin DEFAULT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`upload_id`,`part_number`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `f_59612e99067ef09dfafc196b` (`object_key`),
  CONSTRAINT `f_0c8e6346d5b970bf08a55d13` FOREIGN KEY (`upload_id`) REFERENCES `py_creative_r2__mf_multipart_uploads` (`upload_id`),
  CONSTRAINT `f_59612e99067ef09dfafc196b` FOREIGN KEY (`object_key`) REFERENCES `py_creative_r2__mf_objects` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_r2__mf_multipart_uploads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_r2__mf_multipart_uploads` (
  `upload_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `http_metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `custom_metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `state` bigint NOT NULL DEFAULT '0',
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`upload_id`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_r2__mf_objects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_r2__mf_objects` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `blob_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `version` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `size` bigint NOT NULL,
  `etag` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `uploaded` bigint NOT NULL,
  `checksums` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `http_metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `custom_metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`key`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_review_actions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_review_actions` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `draft_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `action` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `stage` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `actor_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `actor_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `comment` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `version` bigint NOT NULL DEFAULT '1',
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`draft_id`(191),`created_at`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_script_alternatives`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_script_alternatives` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `draft_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `content` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `request` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `creator_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `creator_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `adopted` bigint NOT NULL DEFAULT '0',
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`draft_id`(191),`created_at`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_script_notification_chats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_script_notification_chats` (
  `id` varchar(191) COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` longtext COLLATE utf8mb4_0900_bin NOT NULL,
  `chat_id` longtext COLLATE utf8mb4_0900_bin NOT NULL,
  `updated_at` longtext COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_script_notification_payloads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_script_notification_payloads` (
  `notification_id` varchar(191) COLLATE utf8mb4_0900_bin NOT NULL,
  `payload` longtext COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`notification_id`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_script_versions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_script_versions` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `draft_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `version` bigint NOT NULL,
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `content` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `editor_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `editor_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `reason` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  KEY `i_0` (`draft_id`(191),`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_service_notification_receipts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_service_notification_receipts` (
  `notification_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `sent_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`notification_id`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_star_studio_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_star_studio_documents` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `user_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `body` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `revision` bigint NOT NULL DEFAULT '1',
  `updated_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_creative_workspace_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_creative_workspace_users` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `employee_no` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `external_user_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `email` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `department` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `center` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `job_title` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `feishu_user_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `role` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'contributor'),
  `active` bigint NOT NULL DEFAULT '1',
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `last_seen_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (now()),
  `login_registered` bigint NOT NULL DEFAULT '0',
  `preloaded` bigint NOT NULL DEFAULT '0',
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  `__unique_0` binary(32) GENERATED ALWAYS AS (if((`employee_no` is null),NULL,unhex(sha2(json_array(`employee_no`),256)))) STORED,
  `__unique_1` binary(32) GENERATED ALWAYS AS (if((`employee_no` is null),NULL,unhex(sha2(json_array(`employee_no`),256)))) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`),
  UNIQUE KEY `i_0` (`__unique_0`),
  UNIQUE KEY `i_1` (`__unique_1`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_daily_delivery_attempts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_daily_delivery_attempts` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `kind` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `content` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `first_at` double NOT NULL,
  `unknown` bigint NOT NULL DEFAULT '0',
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_daily_delivery_deliveries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_daily_delivery_deliveries` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_daily_schedule_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_daily_schedule_runs` (
  `day` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `last_attempt` double DEFAULT NULL,
  `error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`day`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_intelligence_fixture_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_intelligence_fixture_messages` (
  `uuid` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `run_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `ordinal` bigint NOT NULL,
  `chat_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `text` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'ready'),
  `attempts` bigint NOT NULL DEFAULT '0',
  `first_at` bigint DEFAULT NULL,
  `next_at` bigint NOT NULL DEFAULT '0',
  `lease` bigint DEFAULT NULL,
  `message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `receive_id_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'chat_id'),
  `recipient_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`uuid`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_intelligence_fixture_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_intelligence_fixture_runs` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `test` bigint NOT NULL,
  `state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `lease` bigint DEFAULT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_intelligence_fixture_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_intelligence_fixture_settings` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`key`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_intelligence_intelligence_images`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_intelligence_intelligence_images` (
  `cache_key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `image_key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`cache_key`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_intelligence_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_intelligence_messages` (
  `uuid` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `run_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `ordinal` bigint NOT NULL,
  `chat_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `text` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'ready'),
  `attempts` bigint NOT NULL DEFAULT '0',
  `first_at` bigint DEFAULT NULL,
  `next_at` bigint NOT NULL DEFAULT '0',
  `lease` bigint DEFAULT NULL,
  `message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `receive_id_type` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4'chat_id'),
  `recipient_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT (_utf8mb4''),
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`uuid`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_intelligence_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_intelligence_runs` (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `date` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `test` bigint NOT NULL,
  `state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `lease` bigint DEFAULT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_intelligence_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_intelligence_settings` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`key`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_revenue_cache`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_revenue_cache` (
  `key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `stamp` double NOT NULL,
  `__rowid` bigint NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`key`),
  UNIQUE KEY `__rowid` (`__rowid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `py_review_state`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `py_review_state` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `d_root_project_mid_db_brandmarketing` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `d_root_project_mid_db_brandmarketing`;
DROP TABLE IF EXISTS `platform_order_item_api_field`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `platform_order_item_api_field` (
  `_fixture_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `order_pay_amount` decimal(24,4) DEFAULT NULL,
  `order_status` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `order_time` datetime DEFAULT NULL,
  `pay_time` datetime DEFAULT NULL,
  `platform_order_no` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `shop_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `sku_items` json DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`_fixture_id`),
  KEY `idx_shop_order_time` (`shop_id`),
  KEY `idx_shop_pay_time` (`shop_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='LOCAL_SYNTHETIC SQL-derived test structure';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `qianchuan_account_hourly_cost`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qianchuan_account_hourly_cost` (
  `_fixture_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `advertiser_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `advertiser_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `data_status` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `live_prom_goods_cost_yuan` decimal(24,4) DEFAULT NULL,
  `observed_at` datetime DEFAULT NULL,
  `report_date` date DEFAULT NULL,
  `stat_time` datetime DEFAULT NULL,
  `total_cost_yuan` decimal(24,4) DEFAULT NULL,
  `video_prom_goods_cost_yuan` decimal(24,4) DEFAULT NULL,
  PRIMARY KEY (`_fixture_id`),
  KEY `idx_qc_account_daily_advertiser_date` (`advertiser_id`),
  KEY `idx_qc_account_hourly_time` (`advertiser_id`),
  KEY `uk_qc_account_hourly_cost` (`advertiser_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='LOCAL_SYNTHETIC SQL-derived test structure';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `qianchuan_ad_plan_hourly_delivery_cost_detail`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qianchuan_ad_plan_hourly_delivery_cost_detail` (
  `_fixture_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `ad_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `ad_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `advertiser_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `advertiser_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `internal_product_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `marketing_goal_code` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `observed_at` datetime DEFAULT NULL,
  `plan_net_pay_order_gmv_yuan` decimal(24,4) DEFAULT NULL,
  `plan_total_cost_yuan` decimal(24,4) DEFAULT NULL,
  `record_grain` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `report_date` date DEFAULT NULL,
  `stat_cost` decimal(24,4) DEFAULT NULL,
  `stat_time` datetime DEFAULT NULL,
  `time_granularity` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `total_pay_order_gmv_for_roi2` decimal(24,4) DEFAULT NULL,
  `total_pay_order_gmv_include_coupon_for_roi2` decimal(24,4) DEFAULT NULL,
  PRIMARY KEY (`_fixture_id`),
  KEY `idx_qc_plan_material_daily_ad` (`advertiser_id`),
  KEY `uk_qc_plan_window` (`advertiser_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='LOCAL_SYNTHETIC SQL-derived test structure';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `qianchuan_chengfang_ad_plan_hourly_delivery_cost_detail`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qianchuan_chengfang_ad_plan_hourly_delivery_cost_detail` (
  `_fixture_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `ad_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `ad_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `advertiser_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `advertiser_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `internal_product_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `marketing_goal_code` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `observed_at` datetime DEFAULT NULL,
  `plan_net_pay_order_gmv_yuan` decimal(24,4) DEFAULT NULL,
  `plan_total_cost_yuan` decimal(24,4) DEFAULT NULL,
  `record_grain` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `report_date` date DEFAULT NULL,
  `stat_cost` decimal(24,4) DEFAULT NULL,
  `stat_time` datetime DEFAULT NULL,
  `time_granularity` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `total_pay_order_gmv_for_roi2` decimal(24,4) DEFAULT NULL,
  `total_pay_order_gmv_include_coupon_for_roi2` decimal(24,4) DEFAULT NULL,
  PRIMARY KEY (`_fixture_id`),
  KEY `idx_qc_plan_material_daily_ad` (`advertiser_id`),
  KEY `uk_qc_plan_window` (`advertiser_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='LOCAL_SYNTHETIC SQL-derived test structure';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `qianchuan_chengfang_material_hourly_report`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qianchuan_chengfang_material_hourly_report` (
  `_fixture_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `advertiser_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `business_material_type` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `content_description` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `internal_product_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `marketing_goal` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `material_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `material_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `material_online_time` datetime DEFAULT NULL,
  `observed_at` datetime DEFAULT NULL,
  `platform_material_type` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `platform_product_ids_json` json DEFAULT NULL,
  `report_date` date DEFAULT NULL,
  `stat_cost_for_roi2` decimal(24,4) DEFAULT NULL,
  `stat_time` datetime DEFAULT NULL,
  `total_pay_order_gmv_for_roi2` decimal(24,4) DEFAULT NULL,
  `total_pay_order_gmv_include_coupon_for_roi2` decimal(24,4) DEFAULT NULL,
  PRIMARY KEY (`_fixture_id`),
  KEY `uk_qc_material_hourly` (`advertiser_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='LOCAL_SYNTHETIC SQL-derived test structure';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `qianchuan_material_asset_ledger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qianchuan_material_asset_ledger` (
  `_fixture_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `advertiser_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `business_tags_json` json DEFAULT NULL,
  `content_description` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `filename` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `internal_product_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `material_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `material_source` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `platform_create_time` datetime DEFAULT NULL,
  `platform_material_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `platform_material_type` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `platform_product_names_json` json DEFAULT NULL,
  `platform_products_json` json DEFAULT NULL,
  `platform_tags_json` json DEFAULT NULL,
  `publisher_aweme_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `first_seen_report_date` date DEFAULT NULL,
  PRIMARY KEY (`_fixture_id`),
  KEY `uk_qc_material_asset` (`advertiser_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='LOCAL_SYNTHETIC SQL-derived test structure';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `qianchuan_material_hourly_report`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qianchuan_material_hourly_report` (
  `_fixture_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `advertiser_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `business_material_type` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `content_description` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `internal_product_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `marketing_goal` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `material_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `observed_at` datetime DEFAULT NULL,
  `platform_material_type` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `platform_product_ids_json` json DEFAULT NULL,
  `report_date` date DEFAULT NULL,
  `stat_cost_for_roi2` decimal(24,4) DEFAULT NULL,
  `stat_time` datetime DEFAULT NULL,
  `total_pay_order_gmv_for_roi2` decimal(24,4) DEFAULT NULL,
  `total_pay_order_gmv_include_coupon_for_roi2` decimal(24,4) DEFAULT NULL,
  PRIMARY KEY (`_fixture_id`),
  KEY `uk_qc_material_hourly` (`advertiser_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='LOCAL_SYNTHETIC SQL-derived test structure';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

