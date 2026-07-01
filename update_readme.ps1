# Update README.md with UTF-16 encoding
$filePath = "README.md"
$content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::Unicode)
$newContent = $content -replace 'Lifeline-SOS', 'MedAlert AI' -replace 'Lifeline SOS', 'MedAlert AI'
[System.IO.File]::WriteAllText($filePath, $newContent, [System.Text.Encoding]::Unicode)
Write-Host "Updated README.md successfully"
