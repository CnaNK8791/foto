-- Таблицы «Орбиты» (с приставкой orbita_, чтобы не мешать другим сайтам в той же базе).
-- Новая установка: phpMyAdmin → база → вкладка «SQL» → вставьте файл и нажмите «Вперёд».
-- Затем выполните lessons.sql (стартовый каталог уроков).

CREATE TABLE IF NOT EXISTS orbita_users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  login VARCHAR(64) NOT NULL,
  pass_hash VARCHAR(255) NOT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_orbita_users_login (login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orbita_plans (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  data MEDIUMTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Каталог уроков и ДЗ, общий для всех. Меняет только администратор (is_admin = 1).
CREATE TABLE IF NOT EXISTS orbita_lessons (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  course VARCHAR(16) NOT NULL,
  kind VARCHAR(8) NOT NULL DEFAULT 'lesson',
  title VARCHAR(500) NOT NULL DEFAULT '',
  date DATE NOT NULL,
  dur SMALLINT UNSIGNED NULL,
  released TINYINT(1) NOT NULL DEFAULT 0,
  dep INT UNSIGNED NULL,
  deadline DATE NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY k_orbita_lessons_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Сделать себя администратором (впишите свой логин):
-- UPDATE orbita_users SET is_admin = 1 WHERE login = 'ваш_логин';
