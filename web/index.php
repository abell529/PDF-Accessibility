<?php
function run_cli($in, $out) {
    $root = realpath(__DIR__ . '/..');
    $cmd = sprintf(
        'cd %s && node src/cli.js remediate --in %s --out %s --alt --tags --summaries 2>&1',
        escapeshellarg($root),
        escapeshellarg($in),
        escapeshellarg($out)
    );
    return shell_exec($cmd);
}

$result = '';
$download = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['pdf'])) {
    $uploadDir = __DIR__ . '/uploads/';
    if (!is_dir($uploadDir)) {
        mkdir($uploadDir, 0777, true);
    }
    $inputPath = $uploadDir . basename($_FILES['pdf']['name']);
    if (move_uploaded_file($_FILES['pdf']['tmp_name'], $inputPath)) {
        $outputPath = $uploadDir . 'remediated_' . basename($_FILES['pdf']['name']);
        $result = run_cli($inputPath, $outputPath);
        $download = 'uploads/' . basename($outputPath);
    } else {
        $result = 'Failed to upload file.';
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>PDF Remediation</title>
</head>
<body>
<h1>PDF Remediation</h1>
<?php if ($download): ?>
    <p>Processing complete. <a href="<?= htmlspecialchars($download) ?>">Download remediated PDF</a></p>
    <pre><?= htmlspecialchars($result) ?></pre>
<?php endif; ?>
<form method="post" enctype="multipart/form-data">
    <label>Select PDF file:</label>
    <input type="file" name="pdf" accept="application/pdf" required>
    <button type="submit">Upload & Remediate</button>
</form>
</body>
</html>
