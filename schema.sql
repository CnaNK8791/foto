-- Таблицы «Орбиты» (с приставкой orbita_, чтобы не мешать другим сайтам в той же базе). Выполните в phpMyAdmin: выберите базу → вкладка «SQL» → вставьте и нажмите «Вперёд».

CREATE TABLE IF NOT EXISTS orbita_users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  login VARCHAR(64) NOT NULL,
  pass_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_orbita_users_login (login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orbita_plans (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  data MEDIUMTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
