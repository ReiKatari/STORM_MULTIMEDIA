-- ========================================================
-- STORM MULTIMEDIA — Полная схема базы данных MySQL / MariaDB
-- Назначение: Импорт через phpMyAdmin
-- Имя базы данных: stormmultimedia
-- Кодировка: utf8mb4 / utf8mb4_unicode_ci
-- Движок: InnoDB с поддержкой внешних ключей (Foreign Keys)
-- ========================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------------
-- Создание базы данных stormmultimedia
-- --------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `stormmultimedia` 
  DEFAULT CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE `stormmultimedia`;

-- --------------------------------------------------------
-- Таблица 1: users (Пользователи системы и администраторы)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `avatar` LONGTEXT NULL COMMENT 'URL аватарки или Base64 Data URI',
  `role` VARCHAR(50) NOT NULL DEFAULT 'user' COMMENT 'Роль: admin, user, moderator',
  `settings_json` LONGTEXT NULL COMMENT 'Пользовательские настройки интерфейса в JSON',
  `created_at` BIGINT NOT NULL COMMENT 'Временная метка создания (Unix ms)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Таблица 2: sessions (Сессии авторизации пользователей)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `sessions`;
CREATE TABLE IF NOT EXISTS `sessions` (
  `token` VARCHAR(191) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `expires_at` BIGINT NOT NULL,
  PRIMARY KEY (`token`),
  KEY `idx_sessions_user_id` (`user_id`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Таблица 3: bookmarks (Закладки, статусы просмотра и прогресс)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `bookmarks`;
CREATE TABLE IF NOT EXISTS `bookmarks` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `media_id` VARCHAR(191) NOT NULL COMMENT 'Уникальный ID медиа (tmdb_*, kp_*, fanfilm_*, anix_*)',
  `source` VARCHAR(50) NOT NULL COMMENT 'Источник: fanfilm4k, tmdb, kinopoisk, anixart, anilibria, rutube, vkvideo',
  `title` VARCHAR(500) NOT NULL COMMENT 'Название релиза на русском',
  `original_title` VARCHAR(500) NULL COMMENT 'Оригинальное название',
  `poster_url` TEXT NULL COMMENT 'Ссылка на постер',
  `media_type` VARCHAR(50) NOT NULL DEFAULT 'movie' COMMENT 'Тип: movie, series, anime, video',
  `year` VARCHAR(20) NULL COMMENT 'Год выпуска',
  `status` VARCHAR(50) NOT NULL COMMENT 'Статус: watching, plan, completed, hold, dropped, favorite',
  `is_favorite` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Флаг избранного (1 - да, 0 - нет)',
  `episodes_watched` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Количество просмотренных серий',
  `total_episodes` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Всего серий',
  `progress_percent` DOUBLE NOT NULL DEFAULT 0.0 COMMENT 'Процент общего прогресса',
  `last_time_seconds` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Последняя позиция просмотра в секундах',
  `updated_at` BIGINT NOT NULL COMMENT 'Временная метка обновления (Unix ms)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bookmarks_user_media` (`user_id`, `media_id`, `source`),
  KEY `idx_bookmarks_user_status` (`user_id`, `status`),
  KEY `idx_bookmarks_updated` (`updated_at`),
  CONSTRAINT `fk_bookmarks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Таблица 4: custom_lists (Пользовательские подборки и списки)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `custom_lists`;
CREATE TABLE IF NOT EXISTS `custom_lists` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `color` VARCHAR(50) NOT NULL DEFAULT '#00d2ff',
  `is_public` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_custom_lists_user` (`user_id`),
  CONSTRAINT `fk_custom_lists_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Таблица 5: custom_list_items (Элементы пользовательских подборок)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `custom_list_items`;
CREATE TABLE IF NOT EXISTS `custom_list_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `list_id` INT UNSIGNED NOT NULL,
  `media_id` VARCHAR(191) NOT NULL,
  `source` VARCHAR(50) NOT NULL,
  `title` VARCHAR(500) NOT NULL,
  `poster_url` TEXT NULL,
  `media_type` VARCHAR(50) NULL,
  `year` VARCHAR(20) NULL,
  `rating` DOUBLE NOT NULL DEFAULT 0.0,
  `added_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_list_media` (`list_id`, `media_id`, `source`),
  KEY `idx_list_items_list` (`list_id`),
  CONSTRAINT `fk_list_items_list` FOREIGN KEY (`list_id`) REFERENCES `custom_lists` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Таблица 6: watch_history (История просмотров и продолжение воспроизведения)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `watch_history`;
CREATE TABLE IF NOT EXISTS `watch_history` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `media_id` VARCHAR(191) NOT NULL,
  `source` VARCHAR(50) NOT NULL,
  `title` VARCHAR(500) NOT NULL,
  `poster_url` TEXT NULL,
  `media_type` VARCHAR(50) NULL,
  `year` VARCHAR(20) NULL,
  `season` INT UNSIGNED NOT NULL DEFAULT 1,
  `episode` INT UNSIGNED NOT NULL DEFAULT 1,
  `time_seconds` INT UNSIGNED NOT NULL DEFAULT 0,
  `duration_seconds` INT UNSIGNED NOT NULL DEFAULT 0,
  `progress_percent` DOUBLE NOT NULL DEFAULT 0.0,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_history_user_media` (`user_id`, `media_id`, `source`, `season`, `episode`),
  KEY `idx_history_user_updated` (`user_id`, `updated_at` DESC),
  CONSTRAINT `fk_history_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Таблица 7: media_cache (Кэш метаданных кинорелизов)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `media_cache`;
CREATE TABLE IF NOT EXISTS `media_cache` (
  `source` VARCHAR(100) NOT NULL,
  `cache_key` VARCHAR(191) NOT NULL,
  `data_json` LONGTEXT NOT NULL,
  `expires_at` BIGINT NOT NULL,
  PRIMARY KEY (`source`, `cache_key`),
  KEY `idx_media_cache_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Таблица 8: reviews (Рецензии и отзывы пользователей)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `reviews`;
CREATE TABLE IF NOT EXISTS `reviews` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `media_id` VARCHAR(191) NOT NULL,
  `source` VARCHAR(50) NOT NULL,
  `title` VARCHAR(500) NOT NULL,
  `rating` TINYINT UNSIGNED NOT NULL DEFAULT 10,
  `content` TEXT NOT NULL,
  `tone` VARCHAR(50) NOT NULL DEFAULT 'positive',
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_reviews_media` (`media_id`, `source`),
  KEY `idx_reviews_user` (`user_id`),
  CONSTRAINT `fk_reviews_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Таблица 9: review_likes (Оценки полезности отзывов)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `review_likes`;
CREATE TABLE IF NOT EXISTS `review_likes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `review_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `is_like` TINYINT(1) NOT NULL,
  `created_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_review_likes` (`review_id`, `user_id`),
  CONSTRAINT `fk_review_likes_review` FOREIGN KEY (`review_id`) REFERENCES `reviews` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_review_likes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Таблица 10: user_achievements (Игровые достижения и прогресс)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `user_achievements`;
CREATE TABLE IF NOT EXISTS `user_achievements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `achievement_id` VARCHAR(100) NOT NULL,
  `progress` INT UNSIGNED NOT NULL DEFAULT 0,
  `target` INT UNSIGNED NOT NULL DEFAULT 1,
  `unlocked` TINYINT(1) NOT NULL DEFAULT 0,
  `unlocked_at` BIGINT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_achievements` (`user_id`, `achievement_id`),
  KEY `idx_achievements_user` (`user_id`, `unlocked`),
  CONSTRAINT `fk_achievements_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Таблица 11: watch_rooms (Комнаты синхронного совместного просмотра)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `watch_rooms`;
CREATE TABLE IF NOT EXISTS `watch_rooms` (
  `room_id` VARCHAR(100) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `host_id` INT UNSIGNED NULL,
  `host_name` VARCHAR(255) NOT NULL,
  `current_media_json` LONGTEXT NULL,
  `is_playing` TINYINT(1) NOT NULL DEFAULT 0,
  `current_time` DOUBLE NOT NULL DEFAULT 0.0,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`room_id`),
  KEY `idx_watch_rooms_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Начальные данные: Базовые аккаунты пользователей
-- --------------------------------------------------------
INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `avatar`, `role`, `settings_json`, `created_at`) VALUES
(1, 'StormTester', 'tester@storm.local', '70a3170880000ab68e1c2339fd8cfe51:0d823c6fb79cd4877768414bc267660d352318ab0ab6906c6c7a723073835fbdd3b4608581037ac85f92fcca9e338d2559996e2bcc983ec10220a06454943545', 'https://api.dicebear.com/7.x/bottts/svg?seed=StormTester', 'user', '{}', 1789233481990),
(2, 'ReiKatari', 'ReiKatari@outlook.com', '3f1db65c4202b1b32588e2d3870a77d2:f92493fd3f33bdcc8869f0374f391492ee1279cb284d21e7d00533c84e61dd47ec497f096ea3e4a92aa7b7d3a95db0e1d4fef74cdbe64f87934fc0ed52e75cd0', 'data:image/jpeg;base64,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', 'admin', '{"familyProfiles":[{"id":"primary","name":"ReiKatari Киноманы","avatar":"👑","avatarBg":"linear-gradient(135deg, #f59e0b, #d97706)","isKid":false,"ageRating":"18+","hasPin":false,"pin":"","isDefault":true},{"id":"family","name":"Семейный просмотр","avatar":"👨‍👩‍👧","avatarBg":"linear-gradient(135deg, #10b981, #059669)","isKid":false,"ageRating":"18+","hasPin":false,"pin":"","isDefault":false},{"id":"kids","name":"Детский профиль","avatar":"🦄","avatarBg":"linear-gradient(135deg, #ff007f, #a855f7)","isKid":true,"ageRating":"0+","hasPin":true,"pin":"0000","isDefault":false}]}', 1789233981191)
ON DUPLICATE KEY UPDATE
  `username` = VALUES(`username`),
  `password_hash` = VALUES(`password_hash`),
  `avatar` = VALUES(`avatar`),
  `role` = VALUES(`role`);

SET FOREIGN_KEY_CHECKS = 1;
COMMIT;
