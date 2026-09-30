-- Обновление уже работающей базы «Орбиты» под админку.
-- Выполните один раз в phpMyAdmin (вкладка «SQL»), затем lessons.sql.

ALTER TABLE orbita_users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0;

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
UPDATE orbita_users SET is_admin = 1 WHERE login = 'ваш_логин';
