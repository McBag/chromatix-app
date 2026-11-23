<?php
// Append debug log lines for the Tesla Chromatix fork. POST only.
// Lives outside the web root. Invoked by nginx SCRIPT_FILENAME.

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    exit;
}

$home = getenv('HOME') ?: '/home/autodownloader';
$log = $home . '/logs/chromatix-debug.log';
$maxBytes = 5 * 1024 * 1024;
$keepBytes = 1 * 1024 * 1024;
$limit = 32 * 1024;

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    http_response_code(204);
    exit;
}
if (strlen($raw) > $limit) {
    $raw = substr($raw, 0, $limit) . "\n[truncated]\n";
}
if (substr($raw, -1) !== "\n") {
    $raw .= "\n";
}

$dir = dirname($log);
if (!is_dir($dir)) {
    mkdir($dir, 0750, true);
}

$fh = fopen($log, 'c+');
if ($fh === false) {
    http_response_code(500);
    exit;
}

if (!flock($fh, LOCK_EX)) {
    fclose($fh);
    http_response_code(500);
    exit;
}

fseek($fh, 0, SEEK_END);
$size = ftell($fh);
if ($size !== false && ($size + strlen($raw)) > $maxBytes) {
    $start = $size > $keepBytes ? $size - $keepBytes : 0;
    if ($start > 0) {
        fseek($fh, $start, SEEK_SET);
        $tail = stream_get_contents($fh);
        $nl = ($tail === false) ? false : strpos($tail, "\n");
        if ($nl !== false) {
            $tail = substr($tail, $nl + 1);
        }
    } else {
        fseek($fh, 0, SEEK_SET);
        $tail = stream_get_contents($fh);
    }
    ftruncate($fh, 0);
    rewind($fh);
    if (is_string($tail) && $tail !== '') {
        fwrite($fh, $tail);
        if (substr($tail, -1) !== "\n") {
            fwrite($fh, "\n");
        }
        fwrite($fh, "----- truncated to last {$keepBytes} bytes -----\n");
    }
}

fwrite($fh, $raw);
fflush($fh);
flock($fh, LOCK_UN);
fclose($fh);

http_response_code(204);
exit;
