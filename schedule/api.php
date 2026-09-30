<?php
// API «Орбиты»: вход по логину и паролю, хранение плана каждого пользователя в MySQL.
// Настройки подключения — в config.php (скопируйте config.example.php).
declare(strict_types=1);

session_set_cookie_params([
    'lifetime' => 60 * 60 * 24 * 30,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
]);
session_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

// Всегда отвечаем кодом 200: многие хостинги подменяют ответы 4xx/5xx своей HTML-страницей,
// и страница не смогла бы прочитать ошибку. Сама ошибка лежит в поле "error".
function out(array $payload, int $code = 200): void
{
    http_response_code(200);
    if ($code !== 200) {
        $payload['status'] = $code;
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    out(['error' => 'not_configured'], 503);
}
$cfg = require $configFile;

function db(): PDO
{
    static $pdo = null;
    global $cfg;
    if ($pdo === null) {
        $dsn = $cfg['dsn'] ?? sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $cfg['host'], $cfg['port'] ?? 3306, $cfg['name']);
        $pdo = new PDO($dsn, $cfg['user'] ?? null, $cfg['pass'] ?? null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    return $pdo;
}

$action = $_GET['action'] ?? '';
$isPost = $_SERVER['REQUEST_METHOD'] === 'POST';
$in = [];
if ($isPost) {
    // простая защита от CSRF: обычная HTML-форма не может выставить этот заголовок
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'orbita') {
        out(['error' => 'bad_request'], 400);
    }
    $in = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($in)) {
        $in = [];
    }
}

function requirePost(bool $isPost): void
{
    if (!$isPost) {
        out(['error' => 'method_not_allowed'], 405);
    }
}

function requireUser(): int
{
    $uid = $_SESSION['uid'] ?? null;
    if (!$uid) {
        out(['error' => 'not_logged_in'], 401);
    }
    return (int)$uid;
}

function cleanLogin($login): string
{
    $login = trim((string)$login);
    $len = mb_strlen($login);
    if ($len < 3 || $len > 64 || preg_match('/\s/u', $login)) {
        out(['error' => 'bad_login'], 422);
    }
    return $login;
}

function cleanPassword($pass): string
{
    $pass = (string)$pass;
    if (mb_strlen($pass) < 6 || strlen($pass) > 200) {
        out(['error' => 'bad_password'], 422);
    }
    return $pass;
}

try {
    switch ($action) {
        case 'me':
            $uid = $_SESSION['uid'] ?? null;
            if (!$uid) {
                out(['user' => null]);
            }
            $st = db()->prepare('SELECT login FROM users WHERE id = ?');
            $st->execute([$uid]);
            $u = $st->fetch();
            if (!$u) {
                unset($_SESSION['uid']);
            }
            out(['user' => $u ?: null]);

        case 'register':
            requirePost($isPost);
            $login = cleanLogin($in['login'] ?? '');
            $pass = cleanPassword($in['password'] ?? '');
            $st = db()->prepare('SELECT id FROM users WHERE login = ?');
            $st->execute([$login]);
            if ($st->fetch()) {
                out(['error' => 'login_taken'], 409);
            }
            $st = db()->prepare('INSERT INTO users (login, pass_hash) VALUES (?, ?)');
            $st->execute([$login, password_hash($pass, PASSWORD_DEFAULT)]);
            session_regenerate_id(true);
            $_SESSION['uid'] = (int)db()->lastInsertId();
            out(['user' => ['login' => $login]]);

        case 'login':
            requirePost($isPost);
            $login = trim((string)($in['login'] ?? ''));
            $pass = (string)($in['password'] ?? '');
            $st = db()->prepare('SELECT id, login, pass_hash FROM users WHERE login = ?');
            $st->execute([$login]);
            $u = $st->fetch();
            if (!$u || !password_verify($pass, $u['pass_hash'])) {
                usleep(400000); // замедляем перебор паролей
                out(['error' => 'wrong_credentials'], 401);
            }
            session_regenerate_id(true);
            $_SESSION['uid'] = (int)$u['id'];
            out(['user' => ['login' => $u['login']]]);

        case 'logout':
            requirePost($isPost);
            $_SESSION = [];
            session_destroy();
            out(['ok' => true]);

        case 'load':
            $uid = requireUser();
            $st = db()->prepare('SELECT data, updated_at FROM plans WHERE user_id = ?');
            $st->execute([$uid]);
            $row = $st->fetch();
            out(['data' => $row ? json_decode($row['data'], true) : null, 'updated_at' => $row['updated_at'] ?? null]);

        case 'save':
            requirePost($isPost);
            $uid = requireUser();
            $data = $in['data'] ?? null;
            if (!is_array($data) || !isset($data['items']) || !is_array($data['items'])) {
                out(['error' => 'bad_data'], 422);
            }
            $json = json_encode($data, JSON_UNESCAPED_UNICODE);
            if ($json === false || strlen($json) > 2 * 1024 * 1024) {
                out(['error' => 'too_large'], 413);
            }
            $st = db()->prepare('SELECT 1 FROM plans WHERE user_id = ?');
            $st->execute([$uid]);
            if ($st->fetch()) {
                $st = db()->prepare('UPDATE plans SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?');
                $st->execute([$json, $uid]);
            } else {
                $st = db()->prepare('INSERT INTO plans (user_id, data) VALUES (?, ?)');
                $st->execute([$uid, $json]);
            }
            out(['ok' => true]);

        default:
            out(['error' => 'unknown_action'], 404);
    }
} catch (PDOException $e) {
    error_log('orbita api: ' . $e->getMessage());
    out(['error' => 'db_error'], 500);
}
