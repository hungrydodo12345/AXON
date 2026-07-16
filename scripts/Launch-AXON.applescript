-- Launch-AXON.applescript
--
-- AppleScript SOURCE for a double-clickable macOS launcher. Plain
-- AppleScript source can't be double-clicked directly — macOS needs
-- it compiled first. One-time setup:
--   1. Open this file in Script Editor (pre-installed on every Mac).
--   2. File > Export... > File Format: "Application" (or "Script" for
--      a .scpt) > Save, keeping it inside the AXON repo's scripts/
--      folder.
--   3. From then on, double-click the exported file to launch AXON.
--
-- It just opens Terminal and runs the equivalent shell launcher
-- (Launch-AXON.command), so all the real setup logic lives in one
-- place.

set scriptPosixPath to POSIX path of (path to me)
set scriptDir to do shell script "dirname " & quoted form of scriptPosixPath
set repoRoot to do shell script "cd " & quoted form of scriptDir & "/.. && pwd"

tell application "Terminal"
	activate
	do script "cd " & quoted form of repoRoot & " && ./scripts/Launch-AXON.command"
end tell
