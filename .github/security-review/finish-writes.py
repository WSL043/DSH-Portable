"""Apply the reviewed source diff, failing closed when the source has drifted."""
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[2]
patch = root / '.github/security-review/remaining-writes.patch'
# Normalize the patch record separator, not any product source content.
text = patch.read_text().replace('\n diff --git ', '\ndiff --git ')
payload = text.encode()
check = subprocess.run(['git', 'apply', '--check', '-'], cwd=root, input=payload, capture_output=True)
if check.returncode == 0:
    subprocess.run(['git', 'apply', '-'], cwd=root, input=payload, check=True)
else:
    subprocess.run(['git', 'apply', '--reverse', '--check', '-'], cwd=root, input=payload, check=True)
